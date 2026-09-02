import mongoose from 'mongoose';
import { Medicine } from '../models/Medicine.model';
import { PurchaseOrder, PurchaseOrderDoc } from '../models/PurchaseOrder.model';
import { StockMovement } from '../models/StockMovement.model';
import { Supplier } from '../models/Supplier.model';
import { SupplierLedgerEntry } from '../models/SupplierLedgerEntry.model';
import { AppError } from '../errors/AppError';
import { atomicAddBatchStock } from './stockMutation';
import { computeLineCharge, paiseToRupees, rupeesToPaise } from './pricingEngine';
import { hashPayload } from '../utils/idempotency';
import { auditLog } from '../utils/auditLog';
import { buildPagination, Pagination } from '../utils/response';
import { CreatePurchaseBody, ListPurchasesQuery } from '../validators/purchase.validators';

export interface PurchaseActor {
  employeeId: string;
  name: string;
}

function isDuplicateIdempotencyKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === 11000 &&
    JSON.stringify((err as { keyPattern?: unknown }).keyPattern ?? {}).includes('idempotencyKey')
  );
}

export async function createPurchaseOrder(
  input: CreatePurchaseBody,
  actor: PurchaseActor
): Promise<{ purchaseOrder: PurchaseOrderDoc; isReplay: boolean }> {
  const payloadHash = hashPayload(input);

  const existing = await PurchaseOrder.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) {
    if (existing.idempotencyPayloadHash === payloadHash) return { purchaseOrder: existing, isReplay: true };
    throw AppError.duplicate('This idempotency key was already used with a different request payload');
  }

  const session = await mongoose.startSession();
  try {
    let created!: PurchaseOrderDoc;

    await session.withTransaction(async () => {
      const supplier = await Supplier.findById(input.supplierId).session(session);
      if (!supplier) throw AppError.notFound('Supplier');

      // Server-authoritative pricing per line — never trust client-computed
      // taxAmount/total (same computeLineCharge engine as sales; purchase
      // lines bill on the invoiced quantity only, bonus/free units are
      // inwarded into stock but are not part of the billable cost basis).
      const computedItems = input.items.map((item) => {
        const charge = computeLineCharge({
          quantity: item.quantity,
          unitPricePaise: rupeesToPaise(item.purchasePrice),
          discountPercent: item.discountPercent,
          taxRatePercent: item.taxRate
        });
        return {
          ...item,
          taxAmount: paiseToRupees(charge.taxAmountPaise),
          total: paiseToRupees(charge.totalPaise),
          _subtotalPaise: charge.subtotalPaise,
          _discountAmountPaise: charge.discountAmountPaise,
          _taxAmountPaise: charge.taxAmountPaise,
          _totalPaise: charge.totalPaise
        };
      });

      const subtotalPaise = computedItems.reduce((s, i) => s + i._subtotalPaise, 0);
      const discountTotalPaise = computedItems.reduce((s, i) => s + i._discountAmountPaise, 0);
      const taxTotalPaise = computedItems.reduce((s, i) => s + i._taxAmountPaise, 0);
      const grandTotalPaise = computedItems.reduce((s, i) => s + i._totalPaise, 0);
      const grandTotal = paiseToRupees(grandTotalPaise);

      // Server derives paymentStatus from the actual paidAmount rather than
      // trusting a client-declared status disconnected from the number.
      const paymentStatus = input.paidAmount <= 0 ? 'Pending' : input.paidAmount >= grandTotal ? 'Paid' : 'Partial';

      const movements: { medicineId: string; medicineName: string; batchNumber: string; quantityChange: number; previousStock: number; newStock: number }[] = [];

      if (input.status === 'Received') {
        for (const item of input.items) {
          const totalQty = item.quantity + item.freeQuantity;
          const medicine = await Medicine.findById(item.medicineId).session(session);
          if (!medicine) throw AppError.notFound(`Medicine ${item.medicineId}`);

          const existingBatch = medicine.batches.find((b) => b.batchNumber === item.batchNumber);

          if (existingBatch) {
            const result = await atomicAddBatchStock(session, item.medicineId, existingBatch._id.toString(), totalQty);
            movements.push({
              medicineId: item.medicineId,
              medicineName: medicine.name,
              batchNumber: item.batchNumber,
              quantityChange: totalQty,
              previousStock: result.previousBatchQuantity,
              newStock: result.newBatchQuantity
            });
          } else {
            const previousStock = medicine.totalStock;
            medicine.batches.push({
              batchNumber: item.batchNumber,
              supplierId: supplier._id,
              supplierName: supplier.name,
              quantity: totalQty,
              purchasePrice: item.purchasePrice,
              mrp: item.mrp,
              sellingPrice: item.sellingPrice,
              mfgDate: item.mfgDate,
              expiryDate: item.expiryDate,
              rackLocation: 'Main Storage'
            });
            await medicine.save({ session });
            movements.push({
              medicineId: item.medicineId,
              medicineName: medicine.name,
              batchNumber: item.batchNumber,
              quantityChange: totalQty,
              previousStock,
              newStock: previousStock + totalQty
            });
          }
        }
      }

      const [purchaseOrder] = await PurchaseOrder.create(
        [
          {
            invoiceNumber: input.invoiceNumber,
            supplierId: supplier._id,
            supplierName: supplier.name,
            orderDate: input.orderDate,
            deliveryDate: input.deliveryDate,
            expectedDeliveryDate: input.expectedDeliveryDate,
            receivedDate: input.status === 'Received' ? new Date() : undefined,
            items: computedItems.map(({ _subtotalPaise, _discountAmountPaise, _taxAmountPaise, _totalPaise, ...rest }) => rest),
            subtotal: paiseToRupees(subtotalPaise),
            taxTotal: paiseToRupees(taxTotalPaise),
            discountTotal: paiseToRupees(discountTotalPaise),
            grandTotal,
            paymentStatus,
            paidAmount: Math.min(input.paidAmount, grandTotal),
            status: input.status,
            notes: input.notes,
            idempotencyKey: input.idempotencyKey,
            idempotencyPayloadHash: payloadHash
          }
        ],
        { session }
      );

      if (movements.length > 0) {
        await StockMovement.create(
          movements.map((m) => ({
            medicineId: m.medicineId,
            medicineName: m.medicineName,
            batchNumber: m.batchNumber,
            type: 'Purchase' as const,
            quantityChange: m.quantityChange,
            previousStock: m.previousStock,
            newStock: m.newStock,
            user: actor.name,
            referenceId: purchaseOrder.invoiceNumber,
            notes: `Inward Purchase from ${supplier.name}`
          })),
          { session, ordered: true }
        );
      }

      if (input.status === 'Received') {
        await Supplier.findByIdAndUpdate(supplier._id, { $inc: { totalPurchases: grandTotal } }, { session });

        const owed = grandTotal - purchaseOrder.paidAmount;
        if (owed > 0) {
          const updatedSupplier = await Supplier.findByIdAndUpdate(
            supplier._id,
            { $inc: { outstandingAmount: owed } },
            { new: true, session }
          );
          await SupplierLedgerEntry.create(
            [
              {
                supplierId: supplier._id,
                type: 'PurchaseCredit',
                amount: owed,
                balanceAfter: updatedSupplier!.outstandingAmount,
                referenceId: purchaseOrder.invoiceNumber
              }
            ],
            { session }
          );
        }
      }

      created = purchaseOrder;
    });

    auditLog('purchase_received', {
      invoiceNumber: created.invoiceNumber,
      supplierId: input.supplierId,
      employeeId: actor.employeeId,
      grandTotal: created.grandTotal,
      status: created.status,
      idempotencyKey: input.idempotencyKey
    });

    return { purchaseOrder: created, isReplay: false };
  } catch (err) {
    if (isDuplicateIdempotencyKeyError(err)) {
      const existingAfterRace = await PurchaseOrder.findOne({ idempotencyKey: input.idempotencyKey });
      if (existingAfterRace && existingAfterRace.idempotencyPayloadHash === payloadHash) {
        return { purchaseOrder: existingAfterRace, isReplay: true };
      }
      throw AppError.duplicate('This idempotency key was already used with a different request payload');
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

export async function listPurchases(query: ListPurchasesQuery): Promise<{ items: PurchaseOrderDoc[]; pagination: Pagination }> {
  const filter: Record<string, unknown> = {};
  if (query.supplierId) filter.supplierId = query.supplierId;
  if (query.status) filter.status = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    PurchaseOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
    PurchaseOrder.countDocuments(filter)
  ]);
  return { items, pagination: buildPagination(query.page, query.limit, total) };
}

export async function getPurchaseById(id: string): Promise<PurchaseOrderDoc> {
  const purchaseOrder = await PurchaseOrder.findById(id);
  if (!purchaseOrder) throw AppError.notFound('Purchase order');
  return purchaseOrder;
}
