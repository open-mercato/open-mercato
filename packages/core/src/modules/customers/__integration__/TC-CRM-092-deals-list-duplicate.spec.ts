import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createPipelineFixture,
  createPipelineStageFixture,
  createDealFixture,
  deleteEntityIfExists,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-092: Deals list row actions offer "Duplicate", matching the kanban card menu.
 *
 * Opens the row-actions (⋮) menu on a seeded deal in `/backend/customers/deals`, picks
 * "Duplicate", and asserts a "<title> (copy)" deal is created through `POST /api/customers/deals`
 * with the source deal's pipeline, stage, value, probability and owner, starting as `open`.
 *
 * Self-contained: the pipeline, stage and source deal are seeded via API in `beforeAll`; the
 * source deal, every copy created by the test, the stage and the pipeline are removed in `afterAll`.
 */

type DealListItem = {
  id?: string;
  title?: string;
  status?: string | null;
  pipeline_id?: string | null;
  pipeline_stage_id?: string | null;
  value_amount?: number | string | null;
  value_currency?: string | null;
  probability?: number | null;
  owner_user_id?: string | null;
};

const stamp = Date.now();
const dealTitle = `QA TC-CRM-092 Deal ${stamp}`;
const copyTitle = `${dealTitle} (copy)`;

let token: string | null = null;
let ownerUserId: string | null = null;
let pipelineId: string | null = null;
let stageId: string | null = null;
let dealId: string | null = null;

async function findDealsByTitle(request: APIRequestContext, title: string): Promise<DealListItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/customers/deals?search=${encodeURIComponent(title)}&pageSize=50`,
    { token: token! },
  );
  expect(response.status(), `GET /api/customers/deals returned ${response.status()}`).toBe(200);
  const payload = (await readJsonSafe(response)) as { items?: DealListItem[] } | null;
  return (payload?.items ?? []).filter((item) => item.title === title);
}

test.describe('TC-CRM-092: Deals list duplicate row action', () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
    token = await getAuthToken(request, 'admin');
    ownerUserId = getTokenScope(token).userId;
    pipelineId = await createPipelineFixture(request, token, { name: `TC-CRM-092 Pipe ${stamp}` });
    stageId = await createPipelineStageFixture(request, token, {
      pipelineId,
      label: `TC-CRM-092 Stage ${stamp}`,
      order: 0,
    });
    dealId = await createDealFixture(request, token, {
      title: dealTitle,
      pipelineId,
      pipelineStageId: stageId,
      status: 'open',
      valueAmount: 4200,
      valueCurrency: 'USD',
      ownerUserId,
    });
  });

  test.afterAll(async ({ request }: { request: APIRequestContext }) => {
    if (token) {
      const copies = await findDealsByTitle(request, copyTitle).catch(() => []);
      for (const copy of copies) {
        await deleteEntityIfExists(request, token, '/api/customers/deals', copy.id ?? null);
      }
    }
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
    await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
    await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
  });

  test('duplicates a deal from the row-actions menu', async ({ page, request }) => {
    test.slow();

    await login(page, 'admin');
    await page.goto('/backend/customers/deals', { waitUntil: 'domcontentloaded' });

    const searchBox = page.getByPlaceholder(/Search by title/i);
    await expect(searchBox).toBeVisible({ timeout: 30_000 });
    await searchBox.fill(dealTitle);

    const dealRow = page.locator('tr').filter({ hasText: dealTitle }).first();
    await expect(dealRow, 'seeded deal row should appear after searching by title').toBeVisible({ timeout: 30_000 });

    await dealRow.getByRole('button', { name: /Open actions/i }).first().click();
    const duplicateItem = page.getByRole('menuitem', { name: 'Duplicate', exact: true });
    await expect(duplicateItem, 'row-actions menu should offer Duplicate').toBeVisible();

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/customers/deals') && response.request().method() === 'POST',
    );
    await duplicateItem.click();
    expect((await createResponse).ok(), 'duplicate POST /api/customers/deals should succeed').toBe(true);

    await expect(page.getByText('Deal duplicated.').first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('tr').filter({ hasText: copyTitle }).first(),
      'the copy should appear in the refreshed list',
    ).toBeVisible({ timeout: 30_000 });

    const copies = await findDealsByTitle(request, copyTitle);
    expect(copies, 'exactly one copy should be created').toHaveLength(1);
    const [copy] = copies;
    expect(copy.id).not.toBe(dealId);
    expect(copy.status).toBe('open');
    expect(copy.pipeline_id).toBe(pipelineId);
    expect(copy.pipeline_stage_id).toBe(stageId);
    expect(Number(copy.value_amount)).toBe(4200);
    expect(copy.value_currency).toBe('USD');
    expect(copy.owner_user_id).toBe(ownerUserId);
  });
});
