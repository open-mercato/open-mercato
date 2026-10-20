import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';

/**
 * TC-CAT-042: Product create moves uploaded media to the new product.
 * Source: https://github.com/open-mercato/open-mercato/issues/7672
 *
 * Verifies:
 * - media uploaded on the create form is transferred from the draft record to the created product
 * - a failed transfer no longer reports plain success: the user gets a warning naming how many files were left behind
 *
 * Batching itself (more than 100 media items) is covered by the unit tests of
 * `transferAttachmentsInChunks` and `transferDraftMedia`.
 */
export const integrationMeta = { dependsOnModules: ['catalog', 'attachments'] };

const PRODUCT_ENTITY_ID = 'catalog:catalog_product';
const PRODUCT_ID_URL = /\/backend\/catalog\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const DESCRIPTION = 'Media transfer regression product with a description long enough for the SEO helper.';
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

type AttachmentRow = { id: string };

function uniqueStamp(): string {
  return `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
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

async function uploadMedia(page: Page, count: number): Promise<string[]> {
  const uploadedIds: string[] = [];
  const uploads = page.waitForResponse(
    async (response) => {
      if (!response.url().includes('/api/attachments') || response.request().method() !== 'POST') return false;
      if (response.url().includes('/transfer')) return false;
      const body = (await response.json().catch(() => null)) as { item?: { id?: string } } | null;
      if (body?.item?.id) uploadedIds.push(body.item.id);
      return uploadedIds.length >= count;
    },
    { timeout: 30_000 },
  );
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(
    Array.from({ length: count }, (_, index) => ({
      name: `qa-media-${index}.png`,
      mimeType: 'image/png',
      buffer: PIXEL_PNG,
    })),
  );
  await uploads;
  return uploadedIds;
}

async function submitAndReadProductId(page: Page): Promise<string> {
  await page
    .locator('button[type="submit"]')
    .filter({ hasText: /^Create product$/ })
    .first()
    .click();
  await expect(page).toHaveURL(PRODUCT_ID_URL, { timeout: 30_000 });
  return expectId(PRODUCT_ID_URL.exec(page.url())?.[1], 'created product id should be in the URL');
}

async function listProductAttachmentIds(request: APIRequestContext, token: string, productId: string): Promise<string[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/attachments?entityId=${encodeURIComponent(PRODUCT_ENTITY_ID)}&recordId=${encodeURIComponent(productId)}`,
    { token },
  );
  expect(response.status(), 'product attachments should be readable').toBe(200);
  return ((await readJsonSafe<{ items?: AttachmentRow[] }>(response))?.items ?? []).map((item) => item.id).sort();
}

test.describe('TC-CAT-042: product create transfers uploaded media', () => {
  test.describe.configure({ timeout: 120_000 });

  let token: string | null = null;
  const productIds: string[] = [];
  const attachmentIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
  });

  test.afterAll(async ({ request }) => {
    for (const attachmentId of attachmentIds) {
      await apiRequest(request, 'DELETE', `/api/attachments?id=${encodeURIComponent(attachmentId)}`, { token: token! }).catch(
        () => undefined,
      );
    }
    for (const productId of productIds) {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });

  test('attaches uploaded media to the created product', async ({ page, request }) => {
    await openCreateForm(page, `QA Media Transfer ${uniqueStamp()}`);
    const uploaded = await uploadMedia(page, 2);
    attachmentIds.push(...uploaded);

    const productId = await submitAndReadProductId(page);
    productIds.push(productId);

    expect(await listProductAttachmentIds(request, token!, productId)).toEqual([...uploaded].sort());
  });

  test('warns when uploaded media could not be attached', async ({ page, request }) => {
    await openCreateForm(page, `QA Media Transfer Failure ${uniqueStamp()}`);
    const uploaded = await uploadMedia(page, 2);
    attachmentIds.push(...uploaded);
    await page.route('**/api/attachments/transfer', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Transfer failed' }) }),
    );

    const productId = await submitAndReadProductId(page);
    productIds.push(productId);

    await expect(page.getByText('Product created, but 2 of 2 media files could not be attached.')).toBeVisible();
    expect(await listProductAttachmentIds(request, token!, productId)).toEqual([]);
  });
});
