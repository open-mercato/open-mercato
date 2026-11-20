import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { createPostingRulesOrg, deletePostingRulesOrg, randomSlug, type PostingRulesOrg } from './helpers/postingRulesFixtures';

/**
 * TC-PR-008: permissions on the configuration surface (spec, API Contracts
 * and Backend Pages; integration coverage matrix, permissions rows). A user
 * whose role grants no ledger or posting_rules feature gets 403 on every
 * method of the cost centre and default account posting rule routes and on
 * GET/PATCH settings, nothing changes, and the three configuration pages
 * answer Access Denied.
 */

const COST_CENTERS = '/api/posting_rules/cost-centers';
const RULES = '/api/posting_rules/default-account-posting-rules';
const SETTINGS = '/api/posting_rules/settings';
const PAGES = ['/backend/posting_rules/settings', '/backend/cost-centers', '/backend/default-account-posting-rules'];
const PASSWORD = 'Valid1!Pass';

async function loginAsUser(page: Page, email: string, password: string): Promise<void> {
  const form = new URLSearchParams();
  form.set('email', email);
  form.set('password', password);
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(response.ok(), `login should succeed for ${email}`).toBeTruthy();
}

async function readCostCenterName(request: APIRequestContext, token: string, org: PostingRulesOrg): Promise<string> {
  const res = await apiRequest(request, 'GET', `${COST_CENTERS}?id=${org.costCenterId}`, { token, headers: org.headers });
  expect(res.status(), 'GET cost-centers as superadmin should return 200').toBe(200);
  const items = ((await res.json()) as { items: Array<{ id: string; name: string }> }).items;
  expect(items, 'the cost centre still exists').toHaveLength(1);
  return items[0].name;
}

test.describe('TC-PR-008: posting_rules configuration requires its features', () => {
  let superadminToken: string;
  let org: PostingRulesOrg | null = null;
  let roleId: string | null = null;
  let userId: string | null = null;
  let email = '';

  test.beforeAll(async ({ request }) => {
    superadminToken = await getAuthToken(request, 'superadmin');
    org = await createPostingRulesOrg(request, superadminToken, { label: 'TC-PR-008', periodStart: '2037-01-01', periodEnd: '2037-01-31' });
    roleId = await createRoleFixture(request, superadminToken, { name: randomSlug('QA-PR-008-role'), tenantId: org.tenantId });
    await setRoleAclFeatures(request, superadminToken, { roleId, features: [] });
    email = `qa-pr-008-${randomUUID().slice(0, 8)}@acme.com`;
    userId = await createUserFixture(request, superadminToken, {
      email,
      password: PASSWORD,
      organizationId: org.organizationId,
      roles: [roleId],
    });
  });

  test.afterAll(async ({ request }) => {
    await deleteUserIfExists(request, superadminToken, userId);
    await deleteRoleIfExists(request, superadminToken, roleId);
    await deletePostingRulesOrg(request, superadminToken, org);
  });

  test('every configuration route answers 403 without the features, and nothing changes', async ({ request }) => {
    const current = org as PostingRulesOrg;
    const token = await getAuthToken(request, email, PASSWORD);
    const nameBefore = await readCostCenterName(request, superadminToken, current);

    const calls: Array<{ label: string; run: () => ReturnType<typeof apiRequest> }> = [
      { label: 'GET cost-centers', run: () => apiRequest(request, 'GET', COST_CENTERS, { token }) },
      {
        label: 'POST cost-centers',
        run: () => apiRequest(request, 'POST', COST_CENTERS, {
          token,
          data: { organizationId: current.organizationId, tenantId: current.tenantId, code: randomSlug('QA-CC8'), name: 'QA TC-PR-008' },
        }),
      },
      { label: 'PUT cost-centers', run: () => apiRequest(request, 'PUT', COST_CENTERS, { token, data: { id: current.costCenterId, name: 'QA TC-PR-008 renamed' } }) },
      { label: 'DELETE cost-centers', run: () => apiRequest(request, 'DELETE', `${COST_CENTERS}?id=${current.costCenterId}`, { token }) },
      { label: 'GET default-account-posting-rules', run: () => apiRequest(request, 'GET', RULES, { token }) },
      {
        label: 'POST default-account-posting-rules',
        run: () => apiRequest(request, 'POST', RULES, {
          token,
          data: {
            organizationId: current.organizationId,
            tenantId: current.tenantId,
            sourceAccountId: current.sourceAccountId,
            targetAccountId: current.targetAccountId,
          },
        }),
      },
      { label: 'PUT default-account-posting-rules', run: () => apiRequest(request, 'PUT', RULES, { token, data: { id: current.ruleId, defaultCostCenterId: null } }) },
      { label: 'DELETE default-account-posting-rules', run: () => apiRequest(request, 'DELETE', `${RULES}?id=${current.ruleId}`, { token }) },
      { label: 'GET settings', run: () => apiRequest(request, 'GET', SETTINGS, { token }) },
      { label: 'PATCH settings', run: () => apiRequest(request, 'PATCH', SETTINGS, { token, data: { clearingAccountId: null } }) },
    ];

    for (const call of calls) {
      const res = await call.run();
      expect(res.status(), `${call.label} without posting_rules features should return 403`).toBe(403);
    }

    expect(await readCostCenterName(request, superadminToken, current), 'the cost centre was not renamed').toBe(nameBefore);
    const ruleRes = await apiRequest(request, 'GET', `${RULES}?id=${current.ruleId}`, { token: superadminToken, headers: current.headers });
    expect(ruleRes.status()).toBe(200);
    const rules = ((await ruleRes.json()) as { items: Array<{ id: string; defaultCostCenterId: string | null }> }).items;
    expect(rules, 'the rule still exists').toHaveLength(1);
    expect(rules[0].defaultCostCenterId, 'the rule keeps its default cost centre').toBe(current.costCenterId);
    const settingsRes = await apiRequest(request, 'GET', SETTINGS, { token: superadminToken, headers: current.headers });
    expect(settingsRes.status()).toBe(200);
    const settings = ((await settingsRes.json()) as { result: { clearingAccountId: string | null } }).result;
    expect(settings.clearingAccountId, 'the clearing account is unchanged').toBe(current.clearingAccountId);
  });

  test('the three configuration pages answer Access Denied without the features', async ({ page }) => {
    test.slow();
    await loginAsUser(page, email, PASSWORD);
    for (const path of PAGES) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Access Denied').first(), `${path} is denied`).toBeVisible({ timeout: 30_000 });
    }
  });
});
