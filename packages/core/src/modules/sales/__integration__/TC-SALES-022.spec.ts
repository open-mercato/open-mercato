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

test.describe("TC-SALES-022: Quote line unit switch recalculates manual price amounts", () => {
  test("should recalculate manual unit prices when API update changes line unit without a new price payload", async ({
    request,
  }) => {
    const stamp = Date.now();
    const priceId = "11111111-1111-4111-8111-111111111111";
    let token: string | null = null;
    let productId: string | null = null;
    let quoteId: string | null = null;
    let lineId: string | null = null;
    let conversionPkgId: string | null = null;
    let conversionBoxId: string | null = null;
    let initialUnitPriceNet = Number.NaN;
    let initialUnitPriceGross = Number.NaN;
    const pkgToBaseFactor = 10; // 1 pkg = 10 base units (pc)
    const boxToBaseFactor = 120; // 1 box = 120 base units (pc)

    try {
      token = await getAuthToken(request);
      const productCreate = await apiRequest(
        request,
        "POST",
        "/api/catalog/products",
        {
          token,
          data: {
            title: `QA TC-SALES-022 ${stamp}`,
            sku: `QA-SALES-022-${stamp}`,
            description:
              "Long enough description for unit conversion tests when updating quote lines.",
            defaultUnit: "pc",
            defaultSalesUnit: "pkg",
            defaultSalesUnitQuantity: 10,
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

      const conversionPkgCreate = await apiRequest(
        request,
        "POST",
        "/api/catalog/product-unit-conversions",
        {
          token,
          data: {
            productId,
            unitCode: "pkg",
            toBaseFactor: pkgToBaseFactor,
            sortOrder: 10,
            isActive: true,
          },
        },
      );
      expect(
        conversionPkgCreate.ok(),
        `Failed to create pkg conversion: ${conversionPkgCreate.status()}`,
      ).toBeTruthy();
      const conversionPkgBody = (await conversionPkgCreate.json()) as {
        id?: string;
      };
      conversionPkgId =
        typeof conversionPkgBody.id === "string" ? conversionPkgBody.id : null;
      expect(conversionPkgId, "pkg conversion id is required").toBeTruthy();

      const conversionBoxCreate = await apiRequest(
        request,
        "POST",
        "/api/catalog/product-unit-conversions",
        {
          token,
          data: {
            productId,
            unitCode: "box",
            toBaseFactor: boxToBaseFactor,
            sortOrder: 20,
            isActive: true,
          },
        },
      );
      expect(
        conversionBoxCreate.ok(),
        `Failed to create box conversion: ${conversionBoxCreate.status()}`,
      ).toBeTruthy();
      const conversionBoxBody = (await conversionBoxCreate.json()) as {
        id?: string;
      };
      conversionBoxId =
        typeof conversionBoxBody.id === "string" ? conversionBoxBody.id : null;
      expect(conversionBoxId, "box conversion id is required").toBeTruthy();

      quoteId = await createSalesQuoteFixture(request, token, "USD");

      const createLine = await apiRequest(request, "POST", "/api/sales/quote-lines", {
        token,
        data: {
          quoteId,
          productId,
          quantity: 1,
          quantityUnit: "pkg",
          currencyCode: "USD",
          name: `QA TC-SALES-022 line ${stamp}`,
          priceId,
          priceMode: "gross",
          unitPriceNet: 150,
          unitPriceGross: 150,
        },
      });
      expect(
        createLine.ok(),
        `Failed to create quote line fixture: ${createLine.status()}`,
      ).toBeTruthy();
      const createLineBody = (await createLine.json()) as { id?: string };
      lineId = typeof createLineBody.id === "string" ? createLineBody.id : null;
      expect(lineId, "Line id is required").toBeTruthy();

      const initialLinesResponse = await apiRequest(
        request,
        "GET",
        `/api/sales/quote-lines?quoteId=${encodeURIComponent(
          quoteId as string,
        )}&page=1&pageSize=20`,
        { token },
      );
      expect(
        initialLinesResponse.ok(),
        `Failed to read initial quote lines: ${initialLinesResponse.status()}`,
      ).toBeTruthy();
      const initialLinesBody = (await initialLinesResponse.json()) as {
        items?: Array<Record<string, unknown>>;
      };
      const initialLine = Array.isArray(initialLinesBody.items)
        ? (initialLinesBody.items.find((entry) => entry.id === lineId) ??
          initialLinesBody.items[0] ??
          null)
        : null;
      expect(initialLine, "Initial quote line should be present").toBeTruthy();
      const initialMetadata =
        (initialLine as Record<string, unknown>).metadata ?? null;
      const initialPriceId =
        initialMetadata && typeof initialMetadata === "object"
          ? ((initialMetadata as Record<string, unknown>).priceId ?? null)
          : null;
      expect(initialPriceId, "Initial line should persist metadata.priceId").toBe(
        priceId,
      );
      initialUnitPriceNet = Number(
        (initialLine as Record<string, unknown>).unit_price_net ?? Number.NaN,
      );
      initialUnitPriceGross = Number(
        (initialLine as Record<string, unknown>).unit_price_gross ?? Number.NaN,
      );

      const updateLine = await apiRequest(request, "PUT", "/api/sales/quote-lines", {
        token,
        data: {
          id: lineId,
          quoteId,
          quantity: 1,
          quantityUnit: "box",
          currencyCode: "USD",
        },
      });
      expect(
        updateLine.ok(),
        `Failed to update quote line unit: ${updateLine.status()}`,
      ).toBeTruthy();

      const quoteLinesResponse = await apiRequest(
        request,
        "GET",
        `/api/sales/quote-lines?quoteId=${encodeURIComponent(
          quoteId as string,
        )}&page=1&pageSize=20`,
        { token },
      );
      expect(
        quoteLinesResponse.ok(),
        `Failed to read quote lines: ${quoteLinesResponse.status()}`,
      ).toBeTruthy();
      const quoteLinesBody = (await quoteLinesResponse.json()) as {
        items?: Array<Record<string, unknown>>;
      };
      const updatedLine = Array.isArray(quoteLinesBody.items)
        ? (quoteLinesBody.items.find((entry) => entry.id === lineId) ??
          quoteLinesBody.items[0] ??
          null)
        : null;
      expect(updatedLine, "Updated quote line should be present").toBeTruthy();

      const quantityUnit = (updatedLine as Record<string, unknown>).quantity_unit;
      const normalizedQuantity = Number(
        (updatedLine as Record<string, unknown>).normalized_quantity ??
          Number.NaN,
      );
      const unitPriceNet = Number(
        (updatedLine as Record<string, unknown>).unit_price_net ?? Number.NaN,
      );
      const unitPriceGross = Number(
        (updatedLine as Record<string, unknown>).unit_price_gross ?? Number.NaN,
      );

      expect(quantityUnit).toBe("box");
      expect(
        Number.isFinite(normalizedQuantity) &&
          Math.abs(normalizedQuantity - boxToBaseFactor) < 0.0001,
        "Normalized quantity should match 1 box in base unit quantity",
      ).toBeTruthy();
      const expectedPriceMultiplier = boxToBaseFactor / pkgToBaseFactor;
      const expectedUnitPriceNet = initialUnitPriceNet * expectedPriceMultiplier;
      const expectedUnitPriceGross =
        initialUnitPriceGross * expectedPriceMultiplier;
      expect(
        Number.isFinite(unitPriceNet) &&
          Math.abs(unitPriceNet - expectedUnitPriceNet) < 0.0001,
        `Net unit price should be recalculated after API unit update (expected=${expectedUnitPriceNet}, actual=${unitPriceNet})`,
      ).toBeTruthy();
      expect(
        Number.isFinite(unitPriceGross) &&
          Math.abs(unitPriceGross - expectedUnitPriceGross) < 0.0001,
        `Gross unit price should be recalculated after API unit update (expected=${expectedUnitPriceGross}, actual=${unitPriceGross})`,
      ).toBeTruthy();
    } finally {
      if (token && conversionPkgId) {
        try {
          await apiRequest(
            request,
            "DELETE",
            `/api/catalog/product-unit-conversions?id=${encodeURIComponent(
              conversionPkgId,
            )}`,
            { token },
          );
        } catch {
          // ignore cleanup failures
        }
      }
      if (token && conversionBoxId) {
        try {
          await apiRequest(
            request,
            "DELETE",
            `/api/catalog/product-unit-conversions?id=${encodeURIComponent(
              conversionBoxId,
            )}`,
            { token },
          );
        } catch {
          // ignore cleanup failures
        }
      }
      await deleteSalesEntityIfExists(request, token, "/api/sales/quotes", quoteId);
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
