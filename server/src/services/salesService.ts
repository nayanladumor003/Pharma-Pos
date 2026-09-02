import mongoose from 'mongoose';
import { Medicine } from '../models/Medicine.model';
import { Sale, SaleDoc } from '../models/Sale.model';
import { StockMovement } from '../models/StockMovement.model';
import { Customer } from '../models/Customer.model';
import { CustomerLedgerEntry } from '../models/CustomerLedgerEntry.model';
import { Settings, SETTINGS_SINGLETON_ID } from '../models/Settings.model';
import { AppError } from '../errors/AppError';
import { atomicDeductBatchStock, selectFefoBatches } from './stockMutation';
import { computeCartTotals, computeLineCharge, paiseToRupees, rupeesToPaise } from './pricingEngine';
import { nextSequence } from '../models/Counter.model';
import { hashPayload } from '../utils/idempotency';
import { auditLog } from '../utils/auditLog';
import { buildPagination, Pagination } from '../utils/response';
import { CreateSaleBody, ListSalesQuery, QuoteSaleBody } from '../validators/sales.validators';

export interface SaleActor {
  employeeId: string;
  name: string;
}

interface ResolvedLineItem {
  medicineId: string;
  medicineName: string;
  genericName: string;
  brand: string;
  dosageForm: string;
  strength: string;
  packSize: string;
  batchId: string;
  batchNumber: string;
  expiryDate: Date;
  availableBatchStock: number;
  quantity: number;
  purchasePrice: number;
  mrp: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  total: number;
  prescriptionRequired: boolean;
}

interface ChargeMeta {
  subtotalPaise: number;
  discountAmountPaise: number;
  taxRatePercent: number;
}

/**
 * Resolves FEFO + server-authoritative pricing for a set of requested lines
 * against CURRENT medicine state. Pure read — no mutation, no session. Used
 * by both /quote (preview) and as the first phase of createSale's logic
 * (createSale re-resolves inside the transaction against a transactionally
 * consistent read, since state can move between quote and checkout).
 */
async function resolveLines(
  requestedLines: { medicineId: string; quantity: number; discountPercent: number }[],
  doctorName: string | undefined,
  requireDoctorForRx: boolean,
  session?: mongoose.ClientSession
): Promise<{ items: ResolvedLineItem[]; chargeMeta: ChargeMeta[] }> {
  const items: ResolvedLineItem[] = [];
  const chargeMeta: ChargeMeta[] = [];

  for (const line of requestedLines) {
    const medicine = session ? await Medicine.findById(line.medicineId).session(session) : await Medicine.findById(line.medicineId);
    if (!medicine) throw AppError.notFound(`Medicine ${line.medicineId}`);
    if (medicine.status !== 'Active') throw AppError.validation(`${medicine.name} is not available for sale`);

    if ((medicine.prescriptionRequired || medicine.isScheduleH) && requireDoctorForRx && !doctorName?.trim()) {
      throw AppError.prescriptionRequired(`${medicine.name} requires a prescription / doctor name before it can be dispensed`);
    }

    const fefoInput = medicine.batches.map((b) => ({ id: b._id.toString(), quantity: b.quantity, expiryDate: b.expiryDate }));
    const fefo = selectFefoBatches(fefoInput, line.quantity);
    if (fefo.shortfall > 0) {
      // selectFefoBatches already excludes expired batches from `fulfilled`.
      // If stock counting expired batches too would have been enough, the
      // real blocker is expiry, not a genuine lack of physical stock — a
      // more specific, more actionable error for the pharmacist.
      const totalIncludingExpired = medicine.batches.reduce((sum, b) => sum + b.quantity, 0);
      if (totalIncludingExpired >= line.quantity) {
        throw AppError.expiredBatch(
          `${medicine.name} has ${totalIncludingExpired} unit(s) in stock, but not enough non-expired stock to fulfil a request for ${line.quantity}`
        );
      }
      throw AppError.insufficientStock(
        `Insufficient stock for ${medicine.name}: requested ${line.quantity}, only ${fefo.fulfilled} available across active batches`
      );
    }

    for (const alloc of fefo.allocations) {
      const batch = medicine.batches.id(alloc.batchId)!;
      const sellingPrice = batch.sellingPrice || medicine.sellingPrice;
      const charge = computeLineCharge({
        quantity: alloc.quantity,
        unitPricePaise: rupeesToPaise(sellingPrice),
        discountPercent: line.discountPercent,
        taxRatePercent: medicine.gstRate
      });

      items.push({
        medicineId: line.medicineId,
        medicineName: medicine.name,
        genericName: medicine.genericName,
        brand: medicine.brand,
        dosageForm: medicine.dosageForm,
        strength: medicine.strength,
        packSize: medicine.packSize,
        batchId: alloc.batchId,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        availableBatchStock: batch.quantity,
        quantity: alloc.quantity,
        purchasePrice: batch.purchasePrice,
        mrp: batch.mrp,
        unitPrice: sellingPrice,
        discountPercent: line.discountPercent,
        discountAmount: paiseToRupees(charge.discountAmountPaise),
        taxRate: medicine.gstRate,
        taxAmount: paiseToRupees(charge.taxAmountPaise),
        subtotal: paiseToRupees(charge.subtotalPaise),
        total: paiseToRupees(charge.totalPaise),
        prescriptionRequired: medicine.prescriptionRequired
      });
      chargeMeta.push({ subtotalPaise: charge.subtotalPaise, discountAmountPaise: charge.discountAmountPaise, taxRatePercent: medicine.gstRate });
    }
  }

  return { items, chargeMeta };
}

export async function quoteSale(input: QuoteSaleBody) {
  const settings = await Settings.findById(SETTINGS_SINGLETON_ID);
  const requireDoctorForRx = settings?.pos?.requireDoctorNameForRx ?? true;

  const { items, chargeMeta } = await resolveLines(input.items, input.doctorName, requireDoctorForRx);
  const totals = computeCartTotals(chargeMeta, input.cartDiscountPercent);

  return {
    items,
    subtotal: paiseToRupees(totals.subtotalPaise),
    discountTotal: paiseToRupees(totals.totalDiscountPaise),
    taxTotal: paiseToRupees(totals.taxTotalPaise),
    roundOff: paiseToRupees(totals.roundOffPaise),
    grandTotal: paiseToRupees(totals.grandTotalPaise)
  };
}

function isDuplicateIdempotencyKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === 11000 &&
    JSON.stringify((err as { keyPattern?: unknown }).keyPattern ?? {}).includes('idempotencyKey')
  );
}

export async function createSale(input: CreateSaleBody, actor: SaleActor): Promise<{ sale: SaleDoc; isReplay: boolean }> {
  const payloadHash = hashPayload(input);

  // Fast path: this exact request already succeeded (common case — a client
  // retry after a dropped response, or a double-click guarded client-side).
  const existing = await Sale.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) {
    if (existing.idempotencyPayloadHash === payloadHash) return { sale: existing, isReplay: true };
    throw AppError.duplicate('This idempotency key was already used with a different request payload');
  }

  const session = await mongoose.startSession();
  try {
    let createdSale!: SaleDoc;

    await session.withTransaction(async () => {
      const [settings, customer] = await Promise.all([
        Settings.findById(SETTINGS_SINGLETON_ID).session(session),
        input.customerId ? Customer.findById(input.customerId).session(session) : Promise.resolve(null)
      ]);
      if (input.customerId && !customer) throw AppError.notFound('Customer');
      if (input.paymentMethod === 'Credit' && !customer) {
        throw AppError.invalidPayment('A registered customer is required for a Credit sale');
      }

      const requireDoctorForRx = settings?.pos?.requireDoctorNameForRx ?? true;

      const { items, chargeMeta } = await resolveLines(input.items, input.doctorName, requireDoctorForRx, session);

      // Deduct stock atomically per resolved (medicine, batch) allocation —
      // enforceNotExpired:true so an expired batch can never be sold, even if
      // FEFO's own filtering somehow raced with an expiry crossing mid-request.
      const movements: { medicineId: string; medicineName: string; batchNumber: string; quantityChange: number; previousStock: number; newStock: number }[] = [];
      for (const item of items) {
        const result = await atomicDeductBatchStock(session, item.medicineId, item.batchId, item.quantity, { enforceNotExpired: true });
        movements.push({
          medicineId: item.medicineId,
          medicineName: item.medicineName,
          batchNumber: item.batchNumber,
          quantityChange: -item.quantity,
          previousStock: result.previousBatchQuantity,
          newStock: result.newBatchQuantity
        });
      }

      const totals = computeCartTotals(chargeMeta, input.cartDiscountPercent);
      const grandTotal = paiseToRupees(totals.grandTotalPaise);

      let amountPaid = input.amountPaid;
      let changeDue = 0;
      let paymentStatusPending = false;

      if (input.paymentMethod === 'Cash') {
        if (amountPaid < grandTotal) {
          throw AppError.invalidPayment(`Amount tendered (₹${amountPaid}) is less than the grand total (₹${grandTotal})`);
        }
        changeDue = Math.round((amountPaid - grandTotal) * 100) / 100;
      } else if (input.paymentMethod === 'UPI' || input.paymentMethod === 'Card' || input.paymentMethod === 'Bank Transfer') {
        if (Math.abs(amountPaid - grandTotal) > 0.01) {
          throw AppError.invalidPayment(`Amount paid must equal the grand total (₹${grandTotal}) for ${input.paymentMethod}`);
        }
        amountPaid = grandTotal;
      } else if (input.paymentMethod === 'Credit') {
        amountPaid = 0;
        paymentStatusPending = true;
      } else {
        // Split
        const splits = input.splitDetails ?? [];
        const splitSum = splits.reduce((s, d) => s + d.amount, 0);
        if (Math.abs(splitSum - grandTotal) > 0.01) {
          throw AppError.invalidPayment(`Split amounts (₹${splitSum}) must add up to the grand total (₹${grandTotal})`);
        }
        const creditPortion = splits.find((d) => d.method === 'Credit');
        if (creditPortion && !customer) {
          throw AppError.invalidPayment('A registered customer is required for the Credit portion of a split payment');
        }
        amountPaid = grandTotal;
      }

      const year = new Date().getFullYear();
      const seq = await nextSequence(`invoice-${year}`, session);
      const invoiceNumber = `INV-${year}-${seq}`;

      const [saleDoc] = await Sale.create(
        [
          {
            invoiceNumber,
            date: new Date(),
            customerId: customer?._id,
            customerName: customer?.name ?? 'Walk-in Customer',
            customerPhone: customer?.phone,
            doctorName: input.doctorName,
            items,
            itemCount: items.length,
            subtotal: paiseToRupees(totals.subtotalPaise),
            discountTotal: paiseToRupees(totals.totalDiscountPaise),
            taxTotal: paiseToRupees(totals.taxTotalPaise),
            roundOff: paiseToRupees(totals.roundOffPaise),
            grandTotal,
            paymentMethod: input.paymentMethod,
            splitDetails: input.paymentMethod === 'Split' ? input.splitDetails : undefined,
            amountPaid,
            changeDue,
            status: 'Completed',
            cashierId: actor.employeeId,
            cashierName: actor.name,
            storeName: settings?.store?.name ?? 'Pharmacy',
            notes: input.notes,
            idempotencyKey: input.idempotencyKey,
            idempotencyPayloadHash: payloadHash
          }
        ],
        { session }
      );

      await StockMovement.create(
        movements.map((m) => ({
          medicineId: m.medicineId,
          medicineName: m.medicineName,
          batchNumber: m.batchNumber,
          type: 'Sale' as const,
          quantityChange: m.quantityChange,
          previousStock: m.previousStock,
          newStock: m.newStock,
          user: actor.name,
          referenceId: invoiceNumber,
          notes: `POS Sale to ${saleDoc.customerName}`
        })),
        { session, ordered: true }
      );

      if (customer) {
        const loyaltyPointsEarned = Math.floor(grandTotal / 100);
        const creditAmount = paymentStatusPending ? grandTotal : input.splitDetails?.find((d) => d.method === 'Credit')?.amount ?? 0;

        if (creditAmount > 0) {
          const updatedCustomer = await Customer.findByIdAndUpdate(
            customer._id,
            {
              $inc: { outstandingBalance: creditAmount, totalPurchases: grandTotal, loyaltyPoints: loyaltyPointsEarned },
              $set: { lastVisit: new Date() }
            },
            { new: true, session }
          );
          await CustomerLedgerEntry.create(
            [
              {
                customerId: customer._id,
                type: 'CreditSale',
                amount: creditAmount,
                balanceAfter: updatedCustomer!.outstandingBalance,
                referenceId: invoiceNumber
              }
            ],
            { session }
          );
        } else {
          await Customer.findByIdAndUpdate(
            customer._id,
            { $inc: { totalPurchases: grandTotal, loyaltyPoints: loyaltyPointsEarned }, $set: { lastVisit: new Date() } },
            { session }
          );
        }
      }

      createdSale = saleDoc;
    });

    auditLog('sale_created', {
      invoiceNumber: createdSale.invoiceNumber,
      cashierId: actor.employeeId,
      customerId: input.customerId,
      grandTotal: createdSale.grandTotal,
      paymentMethod: createdSale.paymentMethod,
      idempotencyKey: input.idempotencyKey
    });

    return { sale: createdSale, isReplay: false };
  } catch (err) {
    if (isDuplicateIdempotencyKeyError(err)) {
      const existingAfterRace = await Sale.findOne({ idempotencyKey: input.idempotencyKey });
      if (existingAfterRace && existingAfterRace.idempotencyPayloadHash === payloadHash) {
        return { sale: existingAfterRace, isReplay: true };
      }
      throw AppError.duplicate('This idempotency key was already used with a different request payload');
    }
    // Meaningful business-rule rejections (stock, expiry, prescription,
    // payment) are worth tracing — a malformed request isn't a "sale event".
    if (err instanceof AppError && err.code !== 'VALIDATION_ERROR') {
      auditLog('sale_failed', { cashierId: actor.employeeId, reason: err.code, idempotencyKey: input.idempotencyKey });
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

export async function listSales(query: ListSalesQuery): Promise<{ items: SaleDoc[]; pagination: Pagination }> {
  const filter: Record<string, unknown> = {};
  if (query.customerId) filter.customerId = query.customerId;
  if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;
  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {})
    };
  }

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    Sale.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
    Sale.countDocuments(filter)
  ]);

  return { items, pagination: buildPagination(query.page, query.limit, total) };
}

export async function getSaleById(id: string): Promise<SaleDoc> {
  const sale = await Sale.findById(id);
  if (!sale) throw AppError.notFound('Sale');
  return sale;
}
