import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures';

/**
 * TC-CAT-PRICES-002: Product create form accepts decimal prices.
 *
 * The variant price inputs on `/backend/catalog/products/create` are
 * `type="number"` with `min={0}`. Without an explicit `step`, the browser
 * falls back to `step=1` anchored at `min`, so values such as 19.95 fail
 * native constraint validation (`stepMismatch`) and the form never submits.
 * The variant edit page (plain text input checked against the shared
 * `validateCatalogPriceAmountInput` rule) always accepted decimals; this spec
 * pins the create page to the same behavior and guards the surrounding rules.
 *
 * Self-contained: creates its own regular + sale price kinds (and product
 * fixtures where needed) and deletes everything in `afterAll`.
 */
const PRICE_KINDS_PATH = '/api/catalog/price-kinds';
const PRICES_PATH = '/api/catalog/prices';
const PRODUCT_ID_URL = /\/backend\/catalog\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const DESCRIPTION = 'Decimal price regression product with a description long enough for the SEO helper.';

type PriceKindFixture = { id: string; title: string };
type PriceRow = {
  id: string;
  variant_id?: string | null;
  price_kind_id?: string | null;
  unit_price_net?: number | string | null;
};

function uniqueStamp(): string {
  return `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

async function createPriceKindFixture(
  request: APIRequestContext,
  token: string,
  input: { code: string; title: string; isPromotion?: boolean },
): Promise<PriceKindFixture> {
  const response = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
    token,
    data: {
      code: input.code,
      title: input.title,
      displayMode: 'excluding-tax',
      currencyCode: 'USD',
      isPromotion: input.isPromotion ?? false,
    },
  });
  expect(response.status(), `price-kind fixture ${input.code} should be created`).toBe(201);
  const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'price-kind fixture should return an id');
  return { id, title: input.title };
}

async function listProductPrices(request: APIRequestContext, token: string, productId: string): Promise<PriceRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRICES_PATH}?productId=${encodeURIComponent(productId)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), 'product prices should be readable').toBe(200);
  return (await readJsonSafe<{ items?: PriceRow[] }>(response))?.items ?? [];
}

function netAmountsFor(prices: PriceRow[], priceKindId: string): number[] {
  return prices
    .filter((price) => price.price_kind_id === priceKindId)
    .map((price) => Number(price.unit_price_net))
    .sort((left, right) => left - right);
}

async function openCreateForm(page: Page, title: string): Promise<void> {
  await login(page, 'admin');
  await page.goto('/backend/catalog/products/create', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  const titleInput = page.getByRole('textbox', { name: 'e.g., Summer sneaker' });
  const descriptionInput = page.getByRole('textbox', { name: 'Describe the product...' });
  await expect(async () => {
    await titleInput.fill(title);
    await descriptionInput.fill(DESCRIPTION);
    await expect(titleInput).toHaveValue(title, { timeout: 2_000 });
  }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
}

async function openVariantsStep(page: Page, kinds: PriceKindFixture[]): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: 'Variants' }).click();
    for (const kind of kinds) {
      await expect(page.getByRole('columnheader', { name: new RegExp(`Price ${kind.title}`) })).toBeVisible({
        timeout: 5_000,
      });
    }
  }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
}

async function priceInput(page: Page, kind: PriceKindFixture, rowIndex: number): Promise<Locator> {
  const headers = await page.locator('table thead th').allInnerTexts();
  const columnIndex = headers.findIndex((text) => text.includes(`Price ${kind.title}`));
  expect(columnIndex, `price column for ${kind.title} should exist`).toBeGreaterThanOrEqual(0);
  return page.locator('table tbody tr').nth(rowIndex).locator('td').nth(columnIndex).locator('input');
}

async function fillPrice(input: Locator, value: string): Promise<void> {
  await input.fill(value);
  await expect(input).toHaveValue(value);
  const validity = await input.evaluate((element) => {
    const state = (element as HTMLInputElement).validity;
    return { valid: state.valid, stepMismatch: state.stepMismatch, message: (element as HTMLInputElement).validationMessage };
  });
  expect(validity, `price ${value} should pass native validation`).toEqual({ valid: true, stepMismatch: false, message: '' });
}

async function submitAndReadProductId(page: Page): Promise<string> {
  await page
    .locator('button[type="submit"]')
    .filter({ hasText: /^Create product$/ })
    .first()
    .click();
  await expect(page).toHaveURL(PRODUCT_ID_URL, { timeout: 30_000 });
  const match = PRODUCT_ID_URL.exec(page.url());
  return expectId(match?.[1], 'created product id should be in the URL');
}

test.describe('TC-CAT-PRICES-002: product create form accepts decimal prices', () => {
  test.describe.configure({ timeout: 120_000 });

  let token: string | null = null;
  let regular: PriceKindFixture | null = null;
  let sale: PriceKindFixture | null = null;
  const productIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    const stamp = uniqueStamp();
    token = await getAuthToken(request, 'admin');
    regular = await createPriceKindFixture(request, token, {
      code: `qa_dec_reg_${stamp}`,
      title: `QA Decimal Regular ${stamp}`,
    });
    sale = await createPriceKindFixture(request, token, {
      code: `qa_dec_sale_${stamp}`,
      title: `QA Decimal Sale ${stamp}`,
      isPromotion: true,
    });
  });

  test.afterAll(async ({ request }) => {
    for (const productId of productIds) {
      await deleteCatalogProductIfExists(request, token, productId);
    }
    await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, sale?.id ?? null);
    await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, regular?.id ?? null);
  });

  test('creates a simple product with a decimal regular price', async ({ page, request }) => {
    await openCreateForm(page, `QA Decimal Simple ${uniqueStamp()}`);
    await openVariantsStep(page, [regular!]);
    await fillPrice(await priceInput(page, regular!, 0), '19.95');

    const productId = await submitAndReadProductId(page);
    productIds.push(productId);

    const prices = await listProductPrices(request, token!, productId);
    expect(netAmountsFor(prices, regular!.id)).toEqual([19.95]);
  });

  test('creates a configurable product with decimal regular and sale prices on every variant', async ({ page, request }) => {
    await openCreateForm(page, `QA Decimal Configurable ${uniqueStamp()}`);
    await openVariantsStep(page, [regular!, sale!]);

    const hasVariantsToggle = page.getByLabel('Yes, this is a product with variants');
    await hasVariantsToggle.click();
    await expect(hasVariantsToggle).toBeChecked();
    await page.getByRole('button', { name: 'Add option' }).click();
    await page.getByPlaceholder('e.g., Color').fill('Size');
    const valuesInput = page.getByPlaceholder('Type a value and press Enter');
    await expect(async () => {
      for (const label of ['Small', 'Large']) {
        const chip = page.getByRole('button', { name: `Remove ${label}` });
        if (await chip.count()) continue;
        await valuesInput.fill(label);
        await valuesInput.press('Enter');
        await expect(chip).toBeVisible({ timeout: 5_000 });
      }
      await expect(page.locator('table tbody tr')).toHaveCount(2, { timeout: 5_000 });
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });

    await fillPrice(await priceInput(page, regular!, 0), '39.99');
    await fillPrice(await priceInput(page, sale!, 0), '29.95');
    await fillPrice(await priceInput(page, regular!, 1), '49.5');
    await fillPrice(await priceInput(page, sale!, 1), '0.01');

    const productId = await submitAndReadProductId(page);
    productIds.push(productId);

    const prices = await listProductPrices(request, token!, productId);
    expect(netAmountsFor(prices, regular!.id)).toEqual([39.99, 49.5]);
    expect(netAmountsFor(prices, sale!.id)).toEqual([0.01, 29.95]);
    const variantIds = new Set(prices.map((price) => price.variant_id));
    expect(variantIds.size, 'prices should be spread across both variants').toBe(2);
  });

  test('still accepts whole-number prices', async ({ page, request }) => {
    await openCreateForm(page, `QA Decimal Whole ${uniqueStamp()}`);
    await openVariantsStep(page, [regular!, sale!]);
    await fillPrice(await priceInput(page, regular!, 0), '20');
    await fillPrice(await priceInput(page, sale!, 0), '0');

    const productId = await submitAndReadProductId(page);
    productIds.push(productId);

    const prices = await listProductPrices(request, token!, productId);
    expect(netAmountsFor(prices, regular!.id)).toEqual([20]);
    expect(netAmountsFor(prices, sale!.id)).toEqual([0]);
  });

  test('rejects negative and malformed prices and keeps precise ones exact', async ({ page, request }) => {
    await openCreateForm(page, `QA Decimal Invalid ${uniqueStamp()}`);
    await openVariantsStep(page, [regular!]);
    const input = await priceInput(page, regular!, 0);

    await input.fill('-5');
    await expect(input, 'negative input is discarded by the form').toHaveValue('');
    await input.pressSequentially('abc');
    await expect(input, 'non-numeric input is discarded by the browser').toHaveValue('');

    const underflow = await input.evaluate((element) => {
      const field = element as HTMLInputElement;
      field.value = '-0.5';
      const result = { rangeUnderflow: field.validity.rangeUnderflow, valid: field.validity.valid };
      field.value = '';
      return result;
    });
    expect(underflow, 'min=0 still blocks negative values natively').toEqual({ rangeUnderflow: true, valid: false });

    const productId = await createProductFixture(request, token!, {
      title: `QA Decimal Invalid API ${uniqueStamp()}`,
      sku: `QA-DEC-INV-${Date.now()}`,
    });
    productIds.push(productId);
    for (const unitPriceNet of [-1, 'abc', '1,5']) {
      const response = await apiRequest(request, 'POST', PRICES_PATH, {
        token: token!,
        data: { productId, priceKindId: regular!.id, currencyCode: 'USD', unitPriceNet },
      });
      expect(response.status(), `price ${String(unitPriceNet)} should be rejected`).toBe(400);
    }
    expect(await listProductPrices(request, token!, productId)).toEqual([]);

    const precise = await apiRequest(request, 'POST', PRICES_PATH, {
      token: token!,
      data: { productId, priceKindId: regular!.id, currencyCode: 'USD', unitPriceNet: '1.23456' },
    });
    expect(precise.status(), 'a price with more than 4 decimals is accepted').toBe(201);
    const stored = await listProductPrices(request, token!, productId);
    expect(stored.map((price) => price.unit_price_net), 'the entered price round-trips unchanged').toEqual(['1.23456']);
  });

  test('variant edit page still updates an existing price to a decimal', async ({ page, request }) => {
    const stamp = uniqueStamp();
    const productId = await createProductFixture(request, token!, {
      title: `QA Decimal Variant Edit ${stamp}`,
      sku: `QA-DEC-VE-${Date.now()}`,
    });
    productIds.push(productId);
    const variantId = await createVariantFixture(request, token!, {
      productId,
      name: `QA Decimal Variant ${stamp}`,
      sku: `QA-DEC-VE-V-${Date.now()}`,
      isDefault: true,
    });
    const seeded = await apiRequest(request, 'POST', PRICES_PATH, {
      token: token!,
      data: { productId, variantId, priceKindId: regular!.id, currencyCode: 'USD', unitPriceNet: 10 },
    });
    expect(seeded.ok(), `seed price should be created: ${seeded.status()}`).toBeTruthy();

    await login(page, 'admin');
    await page.goto(`/backend/catalog/products/${productId}/variants/${variantId}`, { waitUntil: 'domcontentloaded' });
    const card = page
      .locator('div')
      .filter({ has: page.getByText(regular!.title, { exact: true }) })
      .filter({ has: page.getByPlaceholder('0.00') })
      .last();
    const input = card.getByPlaceholder('0.00');
    await expect(input).toHaveValue(/^10(\.0+)?$/, { timeout: 20_000 });
    await input.fill('12.34');
    await expect(input).toHaveValue('12.34');
    await page.getByRole('button', { name: 'Save changes' }).last().click();

    await expect
      .poll(async () => netAmountsFor(await listProductPrices(request, token!, productId), regular!.id), {
        timeout: 20_000,
      })
      .toEqual([12.34]);
  });
});
