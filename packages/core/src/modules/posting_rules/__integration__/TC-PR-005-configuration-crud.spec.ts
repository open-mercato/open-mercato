import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createPostingRulesOrg, deletePostingRulesOrg, randomSlug, type PostingRulesOrg } from './helpers/postingRulesFixtures';

/**
 * TC-PR-005: configuration CRUD over HTTP (spec, Testing Strategy, Integration
 * coverage matrix: cost centres and default account posting rules).
 * Covers create/update/delete, the duplicate `(organization, code)` and
 * `(organization, sourceAccountId)` 409s, the sentinel `UNALLOCATED` cost
 * centre being refused rename/deactivate/delete, and a cost centre still used
 * by a rule being refused delete. A throwaway organization is not seeded with
 * the sentinel, so the test creates a cost centre with the well-known code; the
 * commands protect the sentinel by its code.
 */

const COST_CENTERS = '/api/posting_rules/cost-centers';
const RULES = '/api/posting_rules/default-account-posting-rules';
const SENTINEL_CODE = 'UNALLOCATED';

async function listIds(request: APIRequestContext, token: string, org: PostingRulesOrg, path: string, query = ''): Promise<string[]> {
  const res = await apiRequest(request, 'GET', `${path}${query}`, { token, headers: org.headers });
  expect(res.status(), `GET ${path}${query} should return 200`).toBe(200);
  return ((await res.json()) as { items: Array<{ id: string }> }).items.map((item) => item.id);
}

async function createCostCenter(request: APIRequestContext, token: string, org: PostingRulesOrg, code: string, name: string) {
  return apiRequest(request, 'POST', COST_CENTERS, {
    token,
    headers: org.headers,
    data: { organizationId: org.organizationId, tenantId: org.tenantId, code, name },
  });
}

test.describe('TC-PR-005: posting_rules configuration CRUD', () => {
  let token: string;
  let org: PostingRulesOrg | null = null;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin');
    org = await createPostingRulesOrg(request, token, { label: 'TC-PR-005', periodStart: '2035-01-01', periodEnd: '2035-01-31' });
  });

  test.afterAll(async ({ request }) => {
    await deletePostingRulesOrg(request, token, org);
  });

  test('a cost centre can be created, updated and deleted, and a duplicate code is a 409', async ({ request }) => {
    const current = org as PostingRulesOrg;
    const code = randomSlug('QA-CC5');
    const createRes = await createCostCenter(request, token, current, code, 'QA TC-PR-005 cost centre');
    expect(createRes.status(), 'POST cost-centers should return 201').toBe(201);
    const id = ((await createRes.json()) as { id: string }).id;

    const duplicateRes = await createCostCenter(request, token, current, code, 'QA TC-PR-005 duplicate');
    expect(duplicateRes.status(), 'a duplicate code in the same organization is a 409').toBe(409);
    expect(((await duplicateRes.json()) as { error?: string }).error).toEqual(expect.any(String));

    const updateRes = await apiRequest(request, 'PUT', COST_CENTERS, { token, headers: current.headers, data: { id, name: 'QA TC-PR-005 renamed' } });
    expect(updateRes.status(), 'PUT cost-centers should return 200').toBe(200);

    const renameToTakenRes = await apiRequest(request, 'PUT', COST_CENTERS, {
      token,
      headers: current.headers,
      data: { id: current.costCenterId, code },
    });
    expect(renameToTakenRes.status(), 'renaming to a code already taken is a 409').toBe(409);

    const deleteRes = await apiRequest(request, 'DELETE', `${COST_CENTERS}?id=${id}`, { token, headers: current.headers });
    expect(deleteRes.status(), 'DELETE cost-centers should return 200').toBe(200);
    expect(await listIds(request, token, current, COST_CENTERS, `?id=${id}`)).toEqual([]);

    const reuseRes = await createCostCenter(request, token, current, code, 'QA TC-PR-005 reused code');
    expect(reuseRes.status(), 'a deleted cost centre\'s code can be reused').toBe(201);
    const reusedId = ((await reuseRes.json()) as { id: string }).id;
    await apiRequest(request, 'DELETE', `${COST_CENTERS}?id=${reusedId}`, { token, headers: current.headers });
  });

  test('the sentinel UNALLOCATED cost centre cannot be renamed, deactivated or deleted', async ({ request }) => {
    const current = org as PostingRulesOrg;
    const createRes = await createCostCenter(request, token, current, SENTINEL_CODE, 'Unallocated');
    expect(createRes.status(), 'the sentinel can be created in a fresh organization').toBe(201);
    const sentinelId = ((await createRes.json()) as { id: string }).id;

    const renameRes = await apiRequest(request, 'PUT', COST_CENTERS, { token, headers: current.headers, data: { id: sentinelId, code: 'RENAMED' } });
    expect(renameRes.status(), 'changing the sentinel code is a 409').toBe(409);
    const deactivateRes = await apiRequest(request, 'PUT', COST_CENTERS, { token, headers: current.headers, data: { id: sentinelId, isActive: false } });
    expect(deactivateRes.status(), 'deactivating the sentinel is a 409').toBe(409);
    const deleteRes = await apiRequest(request, 'DELETE', `${COST_CENTERS}?id=${sentinelId}`, { token, headers: current.headers });
    expect(deleteRes.status(), 'deleting the sentinel is a 409').toBe(409);

    const nameOnlyRes = await apiRequest(request, 'PUT', COST_CENTERS, { token, headers: current.headers, data: { id: sentinelId, name: 'Unallocated costs' } });
    expect(nameOnlyRes.status(), 'the sentinel display name may change').toBe(200);
    expect(await listIds(request, token, current, COST_CENTERS, `?id=${sentinelId}`)).toEqual([sentinelId]);
  });

  test('a cost centre used by a rule cannot be deleted', async ({ request }) => {
    const current = org as PostingRulesOrg;
    const deleteRes = await apiRequest(request, 'DELETE', `${COST_CENTERS}?id=${current.costCenterId}`, { token, headers: current.headers });
    expect(deleteRes.status(), 'the rule\'s default cost centre is still in use').toBe(409);
    expect(await listIds(request, token, current, COST_CENTERS, `?id=${current.costCenterId}`)).toEqual([current.costCenterId]);
  });

  test('a second rule for the same source account is a 409, and a rule can be updated and deleted', async ({ request }) => {
    const current = org as PostingRulesOrg;
    const duplicateRes = await apiRequest(request, 'POST', RULES, {
      token,
      headers: current.headers,
      data: { organizationId: current.organizationId, tenantId: current.tenantId, sourceAccountId: current.sourceAccountId, targetAccountId: current.targetAccountId },
    });
    expect(duplicateRes.status(), 'one rule per source account').toBe(409);

    const updateRes = await apiRequest(request, 'PUT', RULES, { token, headers: current.headers, data: { id: current.ruleId, defaultCostCenterId: null } });
    expect(updateRes.status(), 'PUT default-account-posting-rules should return 200').toBe(200);

    const deleteRes = await apiRequest(request, 'DELETE', `${RULES}?id=${current.ruleId}`, { token, headers: current.headers });
    expect(deleteRes.status(), 'DELETE default-account-posting-rules should return 200').toBe(200);
    expect(await listIds(request, token, current, RULES, `?id=${current.ruleId}`)).toEqual([]);

    const recreateRes = await apiRequest(request, 'POST', RULES, {
      token,
      headers: current.headers,
      data: { organizationId: current.organizationId, tenantId: current.tenantId, sourceAccountId: current.sourceAccountId, targetAccountId: current.targetAccountId, defaultCostCenterId: current.costCenterId },
    });
    expect(recreateRes.status(), 'the source account is free again after delete').toBe(201);
    current.ruleId = ((await recreateRes.json()) as { id: string }).id;
  });
});
