import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures';

type DealDetailResponse = {
  deal?: { id?: string | null } | null;
  people?: Array<{ id?: string | null }> | null;
  companies?: Array<{ id?: string | null }> | null;
};

async function openDealsTab(page: Page): Promise<void> {
  const dealsTab = page.getByRole('tab', { name: 'Deals' });
  if ((await dealsTab.count()) > 0) {
    await dealsTab.click();
    return;
  }

  await page.getByRole('button', { name: /^Deals$/i }).click();
}

async function removeDealFromCurrentDetail(page: Page, dealTitle: string): Promise<void> {
  const article = page.locator('article').filter({ hasText: dealTitle }).first();
  await expect(article).toBeVisible();
  await article.hover();
  await article.getByRole('button').nth(1).click();

  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: /^Confirm$/ }).click();

  await expect(article).toHaveCount(0);
}

async function readDealDetail(
  request: APIRequestContext,
  token: string,
  dealId: string,
): Promise<DealDetailResponse> {
  const response = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token });
  expect(response.ok(), `Failed to load deal detail ${dealId}: ${response.status()}`).toBeTruthy();
  return (await readJsonSafe<DealDetailResponse>(response)) ?? {};
}

function extractAssociationIds(
  associations: Array<{ id?: string | null }> | null | undefined,
): string[] {
  return (associations ?? [])
    .map((association) => association.id)
    .filter((associationId): associationId is string => typeof associationId === 'string')
    .sort();
}

/**
 * TC-CRM-034: Customer Detail Deal Unlink Keeps Deal Record
 */
test.describe('TC-CRM-034: Customer Detail Deal Unlink Keeps Deal Record', () => {
  test('should unlink a deal from person detail without deleting the deal', async ({ page, request }) => {
    let token: string | null = null;
    let primaryPersonId: string | null = null;
    let secondaryPersonId: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;

    const uniqueSuffix = Date.now();
    const primaryDisplayName = `QA TC-CRM-034 Person Primary ${uniqueSuffix}`;
    const secondaryDisplayName = `QA TC-CRM-034 Person Secondary ${uniqueSuffix}`;
    const companyName = `QA TC-CRM-034 Company ${uniqueSuffix}`;
    const dealTitle = `QA TC-CRM-034 Person Deal ${uniqueSuffix}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      primaryPersonId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM034Primary${uniqueSuffix}`,
        displayName: primaryDisplayName,
      });
      secondaryPersonId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM034Secondary${uniqueSuffix}`,
        displayName: secondaryDisplayName,
      });
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        personIds: [primaryPersonId, secondaryPersonId],
        companyIds: [companyId],
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/people/${primaryPersonId}`);

      await expect(page.getByText(primaryDisplayName, { exact: true }).first()).toBeVisible();
      await openDealsTab(page);
      await removeDealFromCurrentDetail(page, dealTitle);

      const detail = await readDealDetail(request, token, dealId);
      expect(detail.deal?.id).toBe(dealId);
      expect(extractAssociationIds(detail.people)).toEqual([secondaryPersonId]);
      expect(extractAssociationIds(detail.companies)).toEqual([companyId]);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', secondaryPersonId);
      await deleteEntityIfExists(request, token, '/api/customers/people', primaryPersonId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('should unlink a deal from company detail without deleting the deal', async ({ page, request }) => {
    let token: string | null = null;
    let primaryCompanyId: string | null = null;
    let secondaryCompanyId: string | null = null;
    let personId: string | null = null;
    let dealId: string | null = null;

    const uniqueSuffix = Date.now();
    const primaryCompanyName = `QA TC-CRM-034 Company Primary ${uniqueSuffix}`;
    const secondaryCompanyName = `QA TC-CRM-034 Company Secondary ${uniqueSuffix}`;
    const personDisplayName = `QA TC-CRM-034 Company Person ${uniqueSuffix}`;
    const dealTitle = `QA TC-CRM-034 Company Deal ${uniqueSuffix}`;

    try {
      token = await getAuthToken(request);
      primaryCompanyId = await createCompanyFixture(request, token, primaryCompanyName);
      secondaryCompanyId = await createCompanyFixture(request, token, secondaryCompanyName);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM034Company${uniqueSuffix}`,
        displayName: personDisplayName,
      });
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [primaryCompanyId, secondaryCompanyId],
        personIds: [personId],
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies/${primaryCompanyId}`);

      await expect(page.getByText(primaryCompanyName, { exact: true }).first()).toBeVisible();
      await openDealsTab(page);
      await removeDealFromCurrentDetail(page, dealTitle);

      const detail = await readDealDetail(request, token, dealId);
      expect(detail.deal?.id).toBe(dealId);
      expect(extractAssociationIds(detail.companies)).toEqual([secondaryCompanyId]);
      expect(extractAssociationIds(detail.people)).toEqual([personId]);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', secondaryCompanyId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', primaryCompanyId);
    }
  });
});
