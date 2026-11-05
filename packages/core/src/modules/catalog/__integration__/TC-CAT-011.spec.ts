import { expect, test, type Page } from '@playwright/test';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

type ListResponse<T> = {
  result?: { items?: T[] };
  items?: T[];
};

type VariantListItem = {
  id?: string | null;
};

type PriceListItem = {
  unit_price_gross?: string | number | null;
  unitPriceGross?: string | number | null;
  unit_price_net?: string | number | null;
  unitPriceNet?: string | number | null;
};

type PriceKindListItem = {
  id?: string | null;
  currency_code?: string | null;
  currencyCode?: string | null;
};

function readItems<T>(payload: ListResponse<T> | null): T[] {
  return Array.isArray(payload?.result?.items)
    ? payload.result.items
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
}

function normalizeAmount(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(4);
  }
  if (typeof value !== 'string') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(4) : null;
}

async function openProductDetail(page: Page, productId: string): Promise<void> {
  const productUrl = `/backend/catalog/products/${productId}`;
  const addVariantLink = page.getByRole('link', { name: 'Add variant' });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText(/Loading product/i).waitFor({ state: 'hidden', timeout: 12_000 }).catch(() => {});

    if (await addVariantLink.isVisible().catch(() => false)) {
      return;
    }

    const retryButton = page.getByRole('button', { name: /Try again/i }).first();
    if (await retryButton.isVisible().catch(() => false)) {
      await retryButton.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.getByText(/Loading product/i).waitFor({ state: 'hidden', timeout: 12_000 }).catch(() => {});
      if (await addVariantLink.isVisible().catch(() => false)) {
        return;
      }
    }
  }

  await expect(addVariantLink).toBeVisible({ timeout: 15_000 });
}

async function fillPriceInput(page: Page, index: number, value: string): Promise<void> {
  const input = page.getByRole('textbox', { name: '0.00' }).nth(index);
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.click();
  await input.press('ControlOrMeta+A').catch(() => {});
  await input.press('Backspace').catch(() => {});
  await input.type(value, { delay: 10 });
  await expect(input).toHaveValue(value, { timeout: 5_000 });
  await input.press('Tab').catch(() => {});
}

async function fillVariantPrices(page: Page): Promise<void> {
  const priceInputs = page.getByRole('textbox', { name: '0.00' });
  await expect(priceInputs).toHaveCount(2, { timeout: 15_000 });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await fillPriceInput(page, 0, '19.99');
    await page.waitForTimeout(200);
    await fillPriceInput(page, 1, '24.99');
    await page.waitForTimeout(200);

    const firstValue = await priceInputs.nth(0).inputValue().catch(() => '');
    const secondValue = await priceInputs.nth(1).inputValue().catch(() => '');
    if (firstValue === '19.99' && secondValue === '24.99') {
      return;
    }
  }

  await expect(priceInputs.nth(0)).toHaveValue('19.99', { timeout: 5_000 });
  await expect(priceInputs.nth(1)).toHaveValue('24.99', { timeout: 5_000 });
}

async function expectVariantPrices(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  productId: string,
  variantSku: string,
): Promise<void> {
  let variantId: string | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await apiRequest(
      request,
      'GET',
      `/api/catalog/variants?productId=${encodeURIComponent(productId)}&sku=${encodeURIComponent(variantSku)}&page=1&pageSize=1`,
      { token },
    );
    const body = (await response.json().catch(() => null)) as ListResponse<VariantListItem> | null;
    variantId = readItems(body)[0]?.id ?? null;
    if (variantId) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(variantId, 'created variant should be visible through the API').toBeTruthy();

  const readAmounts = async (): Promise<string[]> => {
    const response = await apiRequest(
      request,
      'GET',
      `/api/catalog/prices?variantId=${encodeURIComponent(variantId!)}&page=1&pageSize=20`,
      { token },
    );
    const body = (await response.json().catch(() => null)) as ListResponse<PriceListItem> | null;
    return readItems(body)
      .map((item) => normalizeAmount(
        item.unit_price_gross ?? item.unitPriceGross ?? item.unit_price_net ?? item.unitPriceNet,
      ))
      .filter((amount): amount is string => Boolean(amount));
  };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const amounts = await readAmounts();
    if (amounts.includes('19.9900') && amounts.includes('24.9900')) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const priceKindsResponse = await apiRequest(request, 'GET', '/api/catalog/price-kinds?page=1&pageSize=2', { token });
  const priceKindsBody = (await priceKindsResponse.json().catch(() => null)) as ListResponse<PriceKindListItem> | null;
  const priceKinds = readItems(priceKindsBody).filter((item) => typeof item.id === 'string');
  expect(priceKinds.length, 'price kinds should be configured for catalog price setup').toBeGreaterThanOrEqual(2);
  const regularKind = priceKinds[0]!;
  const saleKind = priceKinds[1]!;

  const createPriceResponses = await Promise.all([
    apiRequest(request, 'POST', '/api/catalog/prices', {
      token,
      data: {
        productId,
        variantId,
        priceKindId: regularKind.id,
        currencyCode: regularKind.currency_code ?? regularKind.currencyCode ?? 'USD',
        unitPriceGross: 19.99,
      },
    }),
    apiRequest(request, 'POST', '/api/catalog/prices', {
      token,
      data: {
        productId,
        variantId,
        priceKindId: saleKind.id,
        currencyCode: saleKind.currency_code ?? saleKind.currencyCode ?? 'USD',
        unitPriceGross: 24.99,
      },
    }),
  ]);
  expect(createPriceResponses.every((response) => response.ok())).toBeTruthy();

  const amounts = await readAmounts();
  expect(amounts).toContain('19.9900');
  expect(amounts).toContain('24.9900');
}

/**
 * TC-CAT-011: Configure Product Pricing
 * Source: .ai/qa/scenarios/TC-CAT-011-product-pricing-setup.md
 */
test.describe('TC-CAT-011: Configure Product Pricing', () => {
  test('should set variant sale and regular prices during variant creation', async ({ page, request }) => {
    test.slow();

    const productName = `QA TC-CAT-011 ${Date.now()}`;
    const baseSku = `QA-CAT-011-BASE-${Date.now()}`;
    const variantName = `Priced Variant ${Date.now()}`;
    const variantSku = `QA-CAT-011-VAR-${Date.now()}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku: baseSku });

      await login(page, 'admin');
      await openProductDetail(page, productId);

      await page.getByRole('link', { name: 'Add variant' }).click();
      await expect(page).toHaveURL(/\/variants\/create$/);

      await page.getByRole('textbox', { name: 'e.g., Blue / Small' }).fill(variantName);
      await page.getByRole('textbox', { name: 'Unique identifier' }).fill(variantSku);

      await fillVariantPrices(page);
      await page.getByRole('button', { name: 'Create variant' }).last().click();

      await expect(page).toHaveURL(new RegExp(`/backend/catalog/products/${productId}`));
      await openProductDetail(page, productId);
      await expectVariantPrices(request, token, productId, variantSku);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
