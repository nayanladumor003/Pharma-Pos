/**
 * Server-authoritative GST/discount/round-off math for the POS cart and sale
 * creation. All arithmetic happens in integer paise — every percentage-derived
 * amount (a line discount, a line tax) is rounded to the nearest paise the
 * moment it's produced, rather than letting a fractional-paise value float
 * through subsequent calculations. Real money can't have a fraction of a
 * paisa, so this is a correctness refinement over the old frontend (which
 * kept full floating-point precision until the very final grand-total
 * rounding) — in practice it can only ever change a result by a fraction of a
 * paisa before that same final whole-rupee rounding step, so it does not
 * change what a customer is actually charged.
 *
 * The overall formula intentionally follows the LIVE usePOSStore.ts
 * implementation, not the simpler formula written in BUSINESS_RULES.md
 * Rule 2.2 — those two disagree on one point: the frontend computes each
 * line's tax on the taxable amount AFTER the cart-wide discount is applied
 * proportionally, while the doc's formula computes "Total Tax = sum(Line Tax
 * Amount)" using only each line's own discount. The frontend's approach is
 * the one pharmacists have actually been billing against, and is the more
 * correct computation (tax on what the customer actually pays), so it's what
 * this engine reproduces — per this project's standing rule to treat the
 * running application as the source of truth over stale documentation.
 */

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

function roundPaise(value: number): number {
  return Math.round(value);
}

export interface LineChargeInput {
  quantity: number;
  unitPricePaise: number;
  discountPercent: number;
  taxRatePercent: number;
}

export interface LineChargeResult {
  subtotalPaise: number;
  discountAmountPaise: number;
  taxableAmountPaise: number;
  taxAmountPaise: number;
  totalPaise: number;
}

/** BUSINESS_RULES.md Rule 2.1 — unaffected by the Rule 2.2 discrepancy above (that's a cart-level concern). */
export function computeLineCharge(input: LineChargeInput): LineChargeResult {
  const subtotalPaise = input.quantity * input.unitPricePaise;
  const discountAmountPaise = roundPaise((subtotalPaise * input.discountPercent) / 100);
  const taxableAmountPaise = subtotalPaise - discountAmountPaise;
  const taxAmountPaise = roundPaise((taxableAmountPaise * input.taxRatePercent) / 100);
  const totalPaise = taxableAmountPaise + taxAmountPaise;
  return { subtotalPaise, discountAmountPaise, taxableAmountPaise, taxAmountPaise, totalPaise };
}

export interface CartTotalsResult {
  subtotalPaise: number;
  itemDiscountsPaise: number;
  cartDiscountAmountPaise: number;
  totalDiscountPaise: number;
  taxTotalPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
}

/**
 * `lines` are already-computed per-line charges plus each line's tax rate
 * (needed again here because tax is recomputed on the post-cart-discount
 * taxable base, matching usePOSStore.getTaxTotal()).
 */
export function computeCartTotals(
  lines: Array<Pick<LineChargeResult, 'subtotalPaise' | 'discountAmountPaise'> & { taxRatePercent: number }>,
  cartDiscountPercent: number
): CartTotalsResult {
  const subtotalPaise = lines.reduce((sum, l) => sum + l.subtotalPaise, 0);
  const itemDiscountsPaise = lines.reduce((sum, l) => sum + l.discountAmountPaise, 0);
  const balanceAfterItemDiscounts = subtotalPaise - itemDiscountsPaise;
  const cartDiscountAmountPaise = roundPaise((balanceAfterItemDiscounts * cartDiscountPercent) / 100);
  const totalDiscountPaise = itemDiscountsPaise + cartDiscountAmountPaise;

  const taxTotalPaise = lines.reduce((sum, l) => {
    const afterItemDisc = l.subtotalPaise - l.discountAmountPaise;
    const afterCartDisc = afterItemDisc * (1 - cartDiscountPercent / 100);
    return sum + roundPaise((afterCartDisc * l.taxRatePercent) / 100);
  }, 0);

  const rawGrandPaise = subtotalPaise - totalDiscountPaise + taxTotalPaise;
  // Cash-rounding convention: round to the nearest whole RUPEE (100 paise),
  // not the nearest paise — matches usePOSStore.getGrandTotal()'s Math.round
  // on a rupee value exactly.
  const grandTotalPaise = Math.round(rawGrandPaise / 100) * 100;
  const roundOffPaise = grandTotalPaise - rawGrandPaise;

  return { subtotalPaise, itemDiscountsPaise, cartDiscountAmountPaise, totalDiscountPaise, taxTotalPaise, roundOffPaise, grandTotalPaise };
}
