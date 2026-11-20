import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPostingRulesOrg, deletePostingRulesOrg, type PostingRulesOrg } from './helpers/postingRulesFixtures';

/**
 * TC-PR-006: the unconfigured-module banner (spec, Backend Pages and the
 * Integration coverage matrix row "Unconfigured-module banner on all three
 * pages"): shown on the settings, cost centre and rule pages while
 * `clearingAccountId` is null, gone once it is saved.
 */

const BANNER_TITLE = 'Cost reclassification is not running yet';
const PAGES = ['/backend/posting_rules/settings', '/backend/cost-centers', '/backend/default-account-posting-rules'];

test.describe('TC-PR-006: unconfigured posting rules banner', () => {
  let token: string;
  let org: PostingRulesOrg | null = null;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin');
    org = await createPostingRulesOrg(request, token, { label: 'TC-PR-006', periodStart: '2036-01-01', periodEnd: '2036-01-31' });
  });

  test.afterAll(async ({ request }) => {
    await deletePostingRulesOrg(request, token, org);
  });

  test('is shown while the clearing account is unset and disappears after it is saved', async ({ page, request }) => {
    test.setTimeout(120_000);
    const current = org as PostingRulesOrg;
    const clearRes = await apiRequest(request, 'PATCH', '/api/posting_rules/settings', { token, headers: current.headers, data: { clearingAccountId: null } });
    expect(clearRes.status(), 'clearing the clearing account should return 200').toBe(200);

    await login(page, 'superadmin');
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    await page.context().addCookies([
      { name: 'om_selected_tenant', value: current.tenantId, url: baseUrl, sameSite: 'Lax' },
      { name: 'om_selected_org', value: current.organizationId, url: baseUrl, sameSite: 'Lax' },
    ]);

    for (const path of PAGES) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(BANNER_TITLE), `${path} shows the banner while unconfigured`).toBeVisible();
    }

    const saveRes = await apiRequest(request, 'PATCH', '/api/posting_rules/settings', { token, headers: current.headers, data: { clearingAccountId: current.clearingAccountId } });
    expect(saveRes.status(), 'saving the clearing account should return 200').toBe(200);

    for (const path of PAGES) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await expect(page.getByText(BANNER_TITLE), `${path} hides the banner once configured`).toHaveCount(0);
    }
  });
});
