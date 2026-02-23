import { expect, test } from "@playwright/test";
import {
  apiRequest,
  getAuthToken,
} from "@open-mercato/core/modules/core/__integration__/helpers/api";
import { deleteCatalogProductIfExists } from "@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures";

test.describe("TC-CAT-014: Legacy unit alias compatibility", () => {
  test("should canonicalize qty aliases to pc on product create/read", async ({
    request,
  }) => {
    const stamp = Date.now();
    const sku = `QA-CAT-014-${stamp}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      const created = await apiRequest(
        request,
        "POST",
        "/api/catalog/products",
        {
          token,
          data: {
            title: `QA TC-CAT-014 ${stamp}`,
            sku,
            description:
              "Long enough description for legacy unit alias integration testing. Keeps product validation satisfied.",
            defaultUnit: "qty",
            defaultSalesUnit: "qty",
            defaultSalesUnitQuantity: 1,
          },
        },
      );
      expect(
        created.ok(),
        `Failed to create product with qty alias: ${created.status()}`,
      ).toBeTruthy();
      const createdBody = (await created.json()) as { id?: string };
      productId = typeof createdBody.id === "string" ? createdBody.id : null;
      expect(productId, "Product id is required").toBeTruthy();

      const listed = await apiRequest(
        request,
        "GET",
        `/api/catalog/products?id=${encodeURIComponent(productId as string)}&page=1&pageSize=1`,
        { token },
      );
      expect(
        listed.ok(),
        `Failed to list created product: ${listed.status()}`,
      ).toBeTruthy();
      const listBody = (await listed.json()) as {
        items?: Array<Record<string, unknown>>;
      };
      const row = Array.isArray(listBody.items) ? listBody.items[0] : null;
      expect(row, "Expected created product in list response").toBeTruthy();
      const defaultUnit = (row as Record<string, unknown> | null)?.default_unit
        ?? (row as Record<string, unknown> | null)?.defaultUnit;
      const defaultSalesUnit = (row as Record<string, unknown> | null)?.default_sales_unit
        ?? (row as Record<string, unknown> | null)?.defaultSalesUnit;
      expect(defaultUnit, "Legacy default unit should be canonicalized").toBe(
        "pc",
      );
      expect(
        defaultSalesUnit,
        "Legacy default sales unit should be canonicalized",
      ).toBe("pc");
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
