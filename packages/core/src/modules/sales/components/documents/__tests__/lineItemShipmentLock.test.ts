import { prepareShippedLineUpdatePayload } from "../lineItemShipmentLock";

describe("prepareShippedLineUpdatePayload", () => {
  const currentLine = {
    quantity: 4,
    totalNetAmount: 360,
    totalGrossAmount: 442.8,
  };

  it("omits immutable pricing and catalog fields from a name-only shipped-line edit", () => {
    const payload = prepareShippedLineUpdatePayload(
      {
        orderId: "order-1",
        quantity: 4,
        currencyCode: "USD",
        name: "Renamed line",
        productId: "product-1",
        productVariantId: "variant-1",
        quantityUnit: "pcs",
        priceId: "price-1",
        priceMode: "gross",
        unitPriceNet: 100,
        unitPriceGross: 123,
        taxRateId: "tax-rate-1",
        taxRate: 23,
        totalNetAmount: 400,
        totalGrossAmount: 492,
        metadata: { priceId: "price-1" },
      },
      currentLine,
    );

    expect(payload).toEqual({
      orderId: "order-1",
      quantity: 4,
      currencyCode: "USD",
      name: "Renamed line",
    });
  });

  it("scales stored totals proportionally when the shipped-line quantity changes", () => {
    const payload = prepareShippedLineUpdatePayload(
      {
        quantity: 6,
        unitPriceNet: 100,
        unitPriceGross: 123,
        totalNetAmount: 600,
        totalGrossAmount: 738,
      },
      currentLine,
    );

    expect(payload).toEqual({
      quantity: 6,
      totalNetAmount: 540,
      totalGrossAmount: 664.2,
    });
  });

  it("returns an unshipped-line payload unchanged", () => {
    const payload = { quantity: 4, unitPriceGross: 123 };

    expect(prepareShippedLineUpdatePayload(payload, null)).toBe(payload);
  });
});
