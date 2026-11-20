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
      totalNetAmount: "540",
      totalGrossAmount: "664.2",
    });
  });

  it("rescales exact totals without float drift and rounds to the money precision", () => {
    const payload = prepareShippedLineUpdatePayload(
      { quantity: 1 },
      {
        quantity: 3,
        totalNetAmount: "100.000000000000000001",
        totalGrossAmount: "0.3",
      },
    );

    expect(payload).toEqual({
      quantity: 1,
      totalNetAmount: "33.333333333333333334",
      totalGrossAmount: "0.1",
    });
  });

  it("rounds a rescaled fiat total to 4 decimals", () => {
    const payload = prepareShippedLineUpdatePayload(
      { quantity: 2 },
      { quantity: 3, totalNetAmount: "10", totalGrossAmount: "12.3" },
    );

    expect(payload).toEqual({
      quantity: 2,
      totalNetAmount: "6.6667",
      totalGrossAmount: "8.2",
    });
  });

  it("rescales to the configured currency precision", () => {
    const payload = prepareShippedLineUpdatePayload(
      { quantity: 1 },
      { quantity: 3, totalNetAmount: "1", totalGrossAmount: "1.23" },
      { code: "ETH", decimalPlaces: 18 },
    );

    expect(payload).toEqual({
      quantity: 1,
      totalNetAmount: "0.333333333333333333",
      totalGrossAmount: "0.41",
    });
  });

  it("keeps 4 decimals for a fiat currency with fewer digits", () => {
    const payload = prepareShippedLineUpdatePayload(
      { quantity: 2 },
      { quantity: 3, totalNetAmount: "10", totalGrossAmount: "12.3" },
      { code: "USD", decimalPlaces: 2 },
    );

    expect(payload).toEqual({
      quantity: 2,
      totalNetAmount: "6.6667",
      totalGrossAmount: "8.2",
    });
  });

  it("returns an unshipped-line payload unchanged", () => {
    const payload = { quantity: 4, unitPriceGross: 123 };

    expect(prepareShippedLineUpdatePayload(payload, null)).toBe(payload);
  });
});
