import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiRequest,
  getAuthToken,
} from "@open-mercato/core/modules/core/__integration__/helpers/api";
import { deleteCatalogProductIfExists } from "@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures";

type PriceKindFixture = {
  id: string;
  currencyCode: string;
  created: boolean;
};

type VariantFixtureInput = {
  request: APIRequestContext;
  token: string;
  productId: string;
  name: string;
  sku: string;
};

type PriceFixtureInput = {
  request: APIRequestContext;
  token: string;
  productId: string;
  variantId: string;
  priceKindId: string;
  currencyCode: string;
  minQuantity: number;
  unitPriceGross: number;
};

async function ensurePriceKindFixture(
  request: APIRequestContext,
  token: string,
): Promise<PriceKindFixture> {
  const list = await apiRequest(
    request,
    "GET",
    "/api/catalog/price-kinds?page=1&pageSize=50",
    { token },
  );
  expect(list.ok(), `Failed to list price kinds: ${list.status()}`).toBeTruthy();

  const listBody = (await list.json()) as { items?: Array<Record<string, unknown>> };
  const first = Array.isArray(listBody.items) ? listBody.items[0] : null;
  const firstId = typeof first?.id === "string" ? first.id : null;
  const firstCurrency =
    typeof first?.currency_code === "string"
      ? first.currency_code
      : typeof first?.currencyCode === "string"
        ? first.currencyCode
        : "USD";

  if (firstId) {
    return {
      id: firstId,
      currencyCode: firstCurrency,
      created: false,
    };
  }

  const stamp = Date.now();
  const create = await apiRequest(request, "POST", "/api/catalog/price-kinds", {
    token,
    data: {
      title: `QA TC-CAT-015 Kind ${stamp}`,
      code: `qa_tc_cat_015_${stamp}`,
      displayMode: "including-tax",
      currencyCode: "USD",
    },
  });
  expect(
    create.ok(),
    `Failed to create price kind fixture: ${create.status()}`,
  ).toBeTruthy();

  const createBody = (await create.json()) as {
    id?: string;
    result?: { id?: string };
  };
  const id =
    typeof createBody.id === "string" ? createBody.id : createBody.result?.id;
  expect(typeof id === "string" && id.length > 0).toBeTruthy();

  return {
    id: id as string,
    currencyCode: "USD",
    created: true,
  };
}

async function createProductFixture(
  request: APIRequestContext,
  token: string,
  title: string,
  sku: string,
): Promise<string> {
  const created = await apiRequest(request, "POST", "/api/catalog/products", {
    token,
    data: {
      title,
      sku,
      description:
        "Long enough description for catalog price integration testing. Keeps product create validation satisfied.",
    },
  });
  expect(
    created.ok(),
    `Failed to create product fixture: ${created.status()}`,
  ).toBeTruthy();

  const body = (await created.json()) as { id?: string };
  expect(typeof body.id === "string" && body.id.length > 0).toBeTruthy();
  return body.id as string;
}

async function createVariantFixture(input: VariantFixtureInput): Promise<string> {
  const response = await apiRequest(input.request, "POST", "/api/catalog/variants", {
    token: input.token,
    data: {
      productId: input.productId,
      name: input.name,
      sku: input.sku,
      isDefault: false,
      isActive: true,
    },
  });
  expect(
    response.ok(),
    `Failed to create variant fixture: ${response.status()}`,
  ).toBeTruthy();

  const body = (await response.json()) as { id?: string };
  expect(typeof body.id === "string" && body.id.length > 0).toBeTruthy();
  return body.id as string;
}

async function createPriceFixture(input: PriceFixtureInput): Promise<string> {
  const response = await apiRequest(input.request, "POST", "/api/catalog/prices", {
    token: input.token,
    data: {
      productId: input.productId,
      variantId: input.variantId,
      priceKindId: input.priceKindId,
      currencyCode: input.currencyCode,
      minQuantity: input.minQuantity,
      unitPriceGross: input.unitPriceGross,
    },
  });
  expect(
    response.ok(),
    `Failed to create price fixture: ${response.status()}`,
  ).toBeTruthy();

  const body = (await response.json()) as { id?: string };
  expect(typeof body.id === "string" && body.id.length > 0).toBeTruthy();
  return body.id as string;
}

async function deleteCatalogPriceIfExists(
  request: APIRequestContext,
  token: string | null,
  priceId: string | null,
): Promise<void> {
  if (!token || !priceId) return;
  try {
    await apiRequest(
      request,
      "DELETE",
      `/api/catalog/prices?id=${encodeURIComponent(priceId)}`,
      { token },
    );
  } catch {
    return;
  }
}

async function readPriceRow(
  request: APIRequestContext,
  token: string,
  variantId: string,
  priceId: string,
): Promise<Record<string, unknown> | null> {
  const response = await apiRequest(
    request,
    "GET",
    `/api/catalog/prices?variantId=${encodeURIComponent(variantId)}&page=1&pageSize=50`,
    { token },
  );
  expect(
    response.ok(),
    `Failed to list prices for variant ${variantId}: ${response.status()}`,
  ).toBeTruthy();

  const body = (await response.json()) as { items?: Array<Record<string, unknown>> };
  const items = Array.isArray(body.items) ? body.items : [];
  return (
    items.find((item) => typeof item.id === "string" && item.id === priceId) ??
    null
  );
}

test.describe("TC-CAT-015: Catalog price update error handling", () => {
  test("should validate edge-case amounts before PUT /api/catalog/prices reaches the database", async ({
    request,
  }) => {
    const stamp = Date.now();
    const title = `QA TC-CAT-015 ${stamp}`;
    const sku = `QA-CAT-015-${stamp}`;
    const variantSku = `QA-CAT-015-VAR-${stamp}`;
    let token: string | null = null;
    let productId: string | null = null;
    let variantId: string | null = null;
    let createdPriceKindId: string | null = null;
    const createdPriceIds: string[] = [];

    try {
      token = await getAuthToken(request);
      const priceKind = await ensurePriceKindFixture(request, token);
      if (priceKind.created) createdPriceKindId = priceKind.id;

      productId = await createProductFixture(request, token, title, sku);
      variantId = await createVariantFixture({
        request,
        token,
        productId,
        name: `QA Variant ${stamp}`,
        sku: variantSku,
      });

      const cases = [
        {
          label: "issue oversized integer",
          updateValue: 9999999999778,
          expectedStatus: 400,
        },
        {
          label: "issue localized decimal string",
          updateValue: "99,9999",
          expectedStatus: 400,
        },
        {
          label: "issue zero value",
          updateValue: 0,
          expectedStatus: 200,
          expectedStoredGross: 0,
        },
        {
          label: "largest 12-digit integer still inside precision",
          updateValue: 999999999999,
          expectedStatus: 200,
          expectedStoredGross: 999999999999,
        },
        {
          label: "first integer above numeric(16,4) precision",
          updateValue: 1000000000000,
          expectedStatus: 400,
        },
        {
          label: "value with more than four decimal places",
          updateValue: "12.34567",
          expectedStatus: 400,
        },
      ] as const;

      for (const [index, testCase] of cases.entries()) {
        const priceId = await createPriceFixture({
          request,
          token,
          productId,
          variantId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: index + 1,
          unitPriceGross: 10 + index,
        });
        createdPriceIds.push(priceId);

        const response = await apiRequest(request, "PUT", "/api/catalog/prices", {
          token,
          data: {
            id: priceId,
            productId,
            variantId,
            priceKindId: priceKind.id,
            currencyCode: priceKind.currencyCode,
            unitPriceGross: testCase.updateValue,
          },
        });

        expect(
          response.status(),
          `${testCase.label} should return the expected validation status`,
        ).toBe(testCase.expectedStatus);

        if (testCase.expectedStatus >= 400) {
          const errorBody = (await response.json()) as {
            error?: string;
            message?: string;
            details?: unknown;
          };
          expect(errorBody.error).toBe("Invalid input");
          continue;
        }

        const row = await readPriceRow(request, token, variantId, priceId);
        expect(row, `${testCase.label} should still exist after update`).toBeTruthy();
        const gross = Number(
          row?.unit_price_gross ?? row?.unitPriceGross ?? Number.NaN,
        );
        expect(
          Number.isFinite(gross),
          `${testCase.label} should persist a numeric gross amount`,
        ).toBeTruthy();
        if ('expectedStoredGross' in testCase) {
          expect(gross).toBe(testCase.expectedStoredGross);
        }
      }
    } finally {
      for (const priceId of createdPriceIds) {
        await deleteCatalogPriceIfExists(request, token, priceId);
      }
      if (token && createdPriceKindId) {
        try {
          await apiRequest(
            request,
            "DELETE",
            `/api/catalog/price-kinds?id=${encodeURIComponent(createdPriceKindId)}`,
            { token },
          );
        } catch {
          // ignore cleanup failures
        }
      }
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
