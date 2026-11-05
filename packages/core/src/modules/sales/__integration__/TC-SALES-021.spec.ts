import { expect, test } from "@playwright/test";
import {
  apiRequest,
  getAuthToken,
} from "@open-mercato/core/modules/core/__integration__/helpers/api";
import { deleteCatalogProductIfExists } from "@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures";
import {
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from "@open-mercato/core/modules/core/__integration__/helpers/salesFixtures";

test.describe("TC-SALES-021: Legacy qty alias in quote lines", () => {
  test("should accept qty input and persist canonical unit in quote lines", async ({
    request,
  }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let productId: string | null = null;
    let quoteId: string | null = null;

    try {
      token = await getAuthToken(request);

      const productCreate = await apiRequest(
        request,
        "POST",
        "/api/catalog/products",
        {
          token,
          data: {
            title: `QA TC-SALES-021 ${stamp}`,
            sku: `QA-SALES-021-${stamp}`,
            description:
              "Long enough description for legacy qty alias tests in quote line normalization.",
            defaultUnit: "qty",
            defaultSalesUnit: "qty",
            defaultSalesUnitQuantity: 1,
          },
        },
      );
      expect(
        productCreate.ok(),
        `Failed to create product fixture: ${productCreate.status()}`,
      ).toBeTruthy();
      const productCreateBody = (await productCreate.json()) as { id?: string };
      productId =
        typeof productCreateBody.id === "string" ? productCreateBody.id : null;
      expect(productId, "Product id is required").toBeTruthy();

      quoteId = await createSalesQuoteFixture(request, token, "USD");

      const lineCreate = await apiRequest(
        request,
        "POST",
        "/api/sales/quote-lines",
        {
          token,
          data: {
            quoteId,
            productId,
            quantity: 3,
            quantityUnit: "qty",
            currencyCode: "USD",
            name: `QA legacy qty line ${stamp}`,
            unitPriceNet: 10,
            unitPriceGross: 12,
          },
        },
      );
      expect(
        lineCreate.ok(),
        `Failed to create quote line: ${lineCreate.status()}`,
      ).toBeTruthy();

      const linesResponse = await apiRequest(
        request,
        "GET",
        `/api/sales/quote-lines?quoteId=${encodeURIComponent(quoteId)}&page=1&pageSize=20`,
        { token },
      );
      expect(
        linesResponse.ok(),
        `Failed to read quote lines: ${linesResponse.status()}`,
      ).toBeTruthy();
      const linesBody = (await linesResponse.json()) as {
        items?: Array<Record<string, unknown>>;
      };
      const first = Array.isArray(linesBody.items) ? linesBody.items[0] : null;
      expect(first, "Expected one quote line").toBeTruthy();
      const quantityUnit = (first as Record<string, unknown> | null)?.quantity_unit
        ?? (first as Record<string, unknown> | null)?.quantityUnit;
      const normalizedUnit = (first as Record<string, unknown> | null)?.normalized_unit
        ?? (first as Record<string, unknown> | null)?.normalizedUnit;
      const normalizedQuantity = Number(
        (((first as Record<string, unknown> | null)?.normalized_quantity
          ?? (first as Record<string, unknown> | null)?.normalizedQuantity) as
          | string
          | number
          | undefined) ?? Number.NaN,
      );

      expect(quantityUnit, "Quantity unit should be canonicalized").toBe("pc");
      expect(normalizedUnit, "Normalized unit should be canonicalized").toBe(
        "pc",
      );
      expect(
        Number.isFinite(normalizedQuantity) &&
          Math.abs(normalizedQuantity - 3) < 0.0001,
        "Normalized quantity should equal entered quantity for base-unit entry",
      ).toBeTruthy();
    } finally {
      await deleteSalesEntityIfExists(
        request,
        token,
        "/api/sales/quotes",
        quoteId,
      );
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
