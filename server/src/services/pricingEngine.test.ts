import { describe, expect, it } from 'vitest';
import { computeCartTotals, computeLineCharge, paiseToRupees, rupeesToPaise } from './pricingEngine';

describe('rupeesToPaise / paiseToRupees', () => {
  it('round-trips exactly for clean decimal prices', () => {
    expect(rupeesToPaise(110.5)).toBe(11050);
    expect(paiseToRupees(11050)).toBe(110.5);
  });

  it('rounds a third decimal place to the nearest paisa (round-half-up)', () => {
    expect(rupeesToPaise(19.995)).toBe(2000);
  });
});

describe('computeLineCharge', () => {
  it('computes a simple line with no discount', () => {
    const r = computeLineCharge({ quantity: 2, unitPricePaise: 11000, discountPercent: 0, taxRatePercent: 12 });
    expect(r.subtotalPaise).toBe(22000);
    expect(r.discountAmountPaise).toBe(0);
    expect(r.taxableAmountPaise).toBe(22000);
    expect(r.taxAmountPaise).toBe(2640); // 12% of 220
    expect(r.totalPaise).toBe(24640);
  });

  it('applies a percentage discount before tax', () => {
    const r = computeLineCharge({ quantity: 1, unitPricePaise: 10000, discountPercent: 10, taxRatePercent: 18 });
    expect(r.discountAmountPaise).toBe(1000); // 10% of 100
    expect(r.taxableAmountPaise).toBe(9000);
    expect(r.taxAmountPaise).toBe(1620); // 18% of 90
    expect(r.totalPaise).toBe(10620);
  });

  it('handles the maximum allowed discount (100%) — fully discounted, zero tax', () => {
    const r = computeLineCharge({ quantity: 3, unitPricePaise: 5000, discountPercent: 100, taxRatePercent: 12 });
    expect(r.subtotalPaise).toBe(15000);
    expect(r.discountAmountPaise).toBe(15000);
    expect(r.taxableAmountPaise).toBe(0);
    expect(r.taxAmountPaise).toBe(0);
    expect(r.totalPaise).toBe(0);
  });

  it('handles decimal (non-round-rupee) prices correctly at the paise level', () => {
    // ₹33.33 x 3 units, 5% discount, 5% GST — exercises non-trivial rounding at every step.
    const unitPricePaise = rupeesToPaise(33.33);
    const r = computeLineCharge({ quantity: 3, unitPricePaise, discountPercent: 5, taxRatePercent: 5 });
    expect(r.subtotalPaise).toBe(9999); // 33.33 * 3 = 99.99
    expect(r.discountAmountPaise).toBe(500); // 5% of 99.99 = 4.9995 -> rounds to 5.00
    expect(r.taxableAmountPaise).toBe(9499);
    expect(r.taxAmountPaise).toBe(475); // 5% of 94.99 = 4.7495 -> rounds to 4.75
    expect(r.totalPaise).toBe(9974);
  });

  it('rounds tax correctly for an 18% rate on an odd taxable amount', () => {
    const r = computeLineCharge({ quantity: 1, unitPricePaise: rupeesToPaise(17), discountPercent: 0, taxRatePercent: 18 });
    expect(r.taxAmountPaise).toBe(306); // 18% of 17.00 = 3.06 exactly
  });
});

describe('computeCartTotals', () => {
  it('sums multiple line items with a single GST rate and no cart discount', () => {
    const l1 = computeLineCharge({ quantity: 2, unitPricePaise: 11000, discountPercent: 0, taxRatePercent: 12 });
    const l2 = computeLineCharge({ quantity: 1, unitPricePaise: 5000, discountPercent: 0, taxRatePercent: 12 });
    const totals = computeCartTotals(
      [
        { subtotalPaise: l1.subtotalPaise, discountAmountPaise: l1.discountAmountPaise, taxRatePercent: 12 },
        { subtotalPaise: l2.subtotalPaise, discountAmountPaise: l2.discountAmountPaise, taxRatePercent: 12 }
      ],
      0
    );
    expect(totals.subtotalPaise).toBe(27000);
    expect(totals.taxTotalPaise).toBe(3240); // 12% of 270
    // Raw total is 270 + 32.40 = 302.40 -> rounds DOWN to the nearest whole
    // rupee (302), so round-off is -40 paise, not 0.
    expect(totals.roundOffPaise).toBe(-40);
    expect(totals.grandTotalPaise).toBe(30200);
  });

  it('handles multiple different GST rates in the same cart (5%, 12%, 18%)', () => {
    const l5 = computeLineCharge({ quantity: 1, unitPricePaise: rupeesToPaise(100), discountPercent: 0, taxRatePercent: 5 });
    const l12 = computeLineCharge({ quantity: 1, unitPricePaise: rupeesToPaise(100), discountPercent: 0, taxRatePercent: 12 });
    const l18 = computeLineCharge({ quantity: 1, unitPricePaise: rupeesToPaise(100), discountPercent: 0, taxRatePercent: 18 });
    const totals = computeCartTotals(
      [
        { subtotalPaise: l5.subtotalPaise, discountAmountPaise: l5.discountAmountPaise, taxRatePercent: 5 },
        { subtotalPaise: l12.subtotalPaise, discountAmountPaise: l12.discountAmountPaise, taxRatePercent: 12 },
        { subtotalPaise: l18.subtotalPaise, discountAmountPaise: l18.discountAmountPaise, taxRatePercent: 18 }
      ],
      0
    );
    expect(totals.subtotalPaise).toBe(30000);
    expect(totals.taxTotalPaise).toBe(500 + 1200 + 1800); // 5+12+18 rupees of tax
  });

  it('applies a cart-wide discount that reduces the taxable base for every line (matches usePOSStore.getTaxTotal)', () => {
    const l1 = computeLineCharge({ quantity: 1, unitPricePaise: rupeesToPaise(1000), discountPercent: 0, taxRatePercent: 12 });
    const totals = computeCartTotals([{ subtotalPaise: l1.subtotalPaise, discountAmountPaise: 0, taxRatePercent: 12 }], 10);

    // afterCartDisc = 1000 * 0.9 = 900; tax = 12% of 900 = 108 (NOT 12% of 1000 = 120)
    expect(totals.taxTotalPaise).toBe(rupeesToPaise(108));
    expect(totals.cartDiscountAmountPaise).toBe(rupeesToPaise(100));
  });

  it('produces a whole-rupee grand total with a matching round-off figure', () => {
    // subtotal 99.99, no discount, 5% tax -> raw = 99.99 + 5.00 (4.9995 rounds to 5.00) = 104.99
    const l = computeLineCharge({ quantity: 1, unitPricePaise: rupeesToPaise(99.99), discountPercent: 0, taxRatePercent: 5 });
    const totals = computeCartTotals([{ subtotalPaise: l.subtotalPaise, discountAmountPaise: 0, taxRatePercent: 5 }], 0);

    const rawPaise = totals.subtotalPaise - totals.totalDiscountPaise + totals.taxTotalPaise;
    expect(totals.grandTotalPaise).toBe(Math.round(rawPaise / 100) * 100);
    expect(totals.roundOffPaise).toBe(totals.grandTotalPaise - rawPaise);
    expect(totals.grandTotalPaise % 100).toBe(0); // always a whole rupee
  });

  it('zero discount and zero-rated tax leave the grand total equal to the subtotal', () => {
    const l = computeLineCharge({ quantity: 4, unitPricePaise: rupeesToPaise(25), discountPercent: 0, taxRatePercent: 0 });
    const totals = computeCartTotals([{ subtotalPaise: l.subtotalPaise, discountAmountPaise: 0, taxRatePercent: 0 }], 0);
    expect(totals.grandTotalPaise).toBe(rupeesToPaise(100));
    expect(totals.taxTotalPaise).toBe(0);
    expect(totals.roundOffPaise).toBe(0);
  });
});
