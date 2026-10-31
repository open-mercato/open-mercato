import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-7496: the company v2 Deals tab renders a deal's pipeline stage through the
 * `pipeline-stages` dictionary, so a stored value shows its configured label instead of the raw key.
 *
 * Self-contained: a pipeline-stage dictionary entry whose label deliberately differs from its stored
 * value, a company, and a deal storing that raw value are created via API, and all three are removed
 * in `finally` (deal → dictionary entry → company).
 */

const stamp = Date.now();
const stageValue = `qa_tc_crm_7496_stage_${stamp}`;
const stageLabel = `QA TC-CRM-7496 Readable Stage ${stamp}`;
const dealTitle = `QA TC-CRM-7496 Deal ${stamp}`;

async function createPipelineStageEntry(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/dictionaries/pipeline-stages', {
    token,
    data: { value: stageValue, label: stageLabel },
  });
  const payload = await readJsonSafe<{ id?: string }>(response);
  expect(response.ok(), `Failed to create pipeline-stage dictionary entry: ${response.status()}`).toBeTruthy();
  expect(payload?.id, 'dictionary entry id should be returned').toBeTruthy();
  return payload!.id as string;
}

async function createDealWithRawStage(
  request: APIRequestContext,
  token: string,
  companyId: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/deals', {
    token,
    data: { title: dealTitle, companyIds: [companyId], pipelineStage: stageValue, status: 'open' },
  });
  const payload = await readJsonSafe<{ id?: string }>(response);
  expect(response.ok(), `Failed to create deal: ${response.status()}`).toBeTruthy();
  expect(payload?.id, 'deal id should be returned').toBeTruthy();
  return payload!.id as string;
}

test.describe('TC-CRM-7496: company Deals tab shows readable pipeline-stage labels', () => {
  test('renders the dictionary label instead of the stored stage value', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let dictionaryEntryId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      dictionaryEntryId = await createPipelineStageEntry(request, token);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-7496 Co ${stamp}`);
      dealId = await createDealWithRawStage(request, token, companyId);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' });

      const dealsTab = page.getByRole('tab', { name: /^Deals/ });
      await expect(dealsTab).toBeVisible({ timeout: 30_000 });
      await dealsTab.click();

      const dealCard = page.locator('article').filter({ hasText: dealTitle }).first();
      await expect(dealCard, 'linked deal card should render on the Deals tab').toBeVisible({ timeout: 30_000 });

      const stageValueCell = dealCard
        .locator('div')
        .filter({ has: page.locator('dt', { hasText: 'Pipeline stage' }) })
        .locator('dd');
      await expect(stageValueCell, 'stage should resolve to its dictionary label').toHaveText(stageLabel, {
        timeout: 30_000,
      });
      await expect(dealCard.getByText(stageValue, { exact: true })).toHaveCount(0);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      if (token && dictionaryEntryId) {
        await apiRequest(request, 'DELETE', `/api/customers/dictionaries/pipeline-stages/${dictionaryEntryId}`, {
          token,
        }).catch(() => undefined);
      }
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
