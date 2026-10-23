import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { OPTIMISTIC_LOCK_CONFLICT_CODE, OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import { createPostingRulesOrg, deletePostingRulesOrg, type PostingRulesOrg } from './helpers/postingRulesFixtures';

/**
 * TC-PR-002: `updateCostCenter`, `updateDefaultAccountPostingRule` and
 * `updatePostingRulesSettings` reject a stale
 * `x-om-ext-optimistic-lock-expected-updated-at` header with a 409 and leave
 * the row unchanged (spec, Testing Strategy, the optimistic-locking bullet),
 * the same check ledger's TC-GL-002 runs for `FiscalPeriod`.
 */

function staleIsoBefore(updatedAt: string): string {
  return new Date(Date.parse(updatedAt) - 60_000).toISOString();
}

async function readListItem(
  request: APIRequestContext,
  token: string,
  org: PostingRulesOrg,
  path: string,
  id: string,
): Promise<Record<string, unknown>> {
  const res = await apiRequest(request, 'GET', `${path}?id=${encodeURIComponent(id)}`, { token, headers: org.headers });
  expect(res.status(), `GET ${path}?id= should return 200`).toBe(200);
  const body = (await res.json()) as { items: Array<Record<string, unknown>> };
  expect(body.items.length, `GET ${path}?id= should return the row`).toBe(1);
  return body.items[0];
}

async function expectConflict(res: Awaited<ReturnType<typeof apiRequest>>, staleIso: string): Promise<void> {
  expect(res.status(), 'a stale expected-updated-at header should return 409').toBe(409);
  const body = (await res.json()) as { code?: string; expectedUpdatedAt?: string };
  expect(body.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE);
  expect(body.expectedUpdatedAt).toBe(staleIso);
}

test.describe('TC-PR-002: optimistic locking on posting_rules updates', () => {
  let token: string;
  let org: PostingRulesOrg | null = null;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin');
    org = await createPostingRulesOrg(request, token, { label: 'TC-PR-002', periodStart: '2033-01-01', periodEnd: '2033-01-31' });
  });

  test.afterAll(async ({ request }) => {
    await deletePostingRulesOrg(request, token, org);
  });

  test('PATCH /settings with a stale version returns 409 and keeps the clearing account', async ({ request }) => {
    const current = org as PostingRulesOrg;
    const getRes = await apiRequest(request, 'GET', '/api/posting_rules/settings', { token, headers: current.headers });
    expect(getRes.status()).toBe(200);
    const settings = ((await getRes.json()) as { result: { clearingAccountId: string | null; updatedAt: string } }).result;
    expect(settings.clearingAccountId).toBe(current.clearingAccountId);
    const staleIso = staleIsoBefore(settings.updatedAt);

    const res = await apiRequest(request, 'PATCH', '/api/posting_rules/settings', {
      token,
      headers: { ...current.headers, [OPTIMISTIC_LOCK_HEADER_NAME]: staleIso },
      data: { clearingAccountId: null },
    });
    await expectConflict(res, staleIso);

    const afterRes = await apiRequest(request, 'GET', '/api/posting_rules/settings', { token, headers: current.headers });
    const after = ((await afterRes.json()) as { result: { clearingAccountId: string | null } }).result;
    expect(after.clearingAccountId, 'a 409 must not clear the clearing account').toBe(current.clearingAccountId);

    const freshRes = await apiRequest(request, 'PATCH', '/api/posting_rules/settings', {
      token,
      headers: { ...current.headers, [OPTIMISTIC_LOCK_HEADER_NAME]: settings.updatedAt },
      data: { clearingAccountId: current.clearingAccountId },
    });
    expect(freshRes.status(), 'the current version is accepted').toBe(200);
  });

  test('PUT /cost-centers with a stale version returns 409 and keeps the name', async ({ request }) => {
    const current = org as PostingRulesOrg;
    const before = await readListItem(request, token, current, '/api/posting_rules/cost-centers', current.costCenterId);
    const staleIso = staleIsoBefore(before.updatedAt as string);

    const res = await apiRequest(request, 'PUT', '/api/posting_rules/cost-centers', {
      token,
      headers: { ...current.headers, [OPTIMISTIC_LOCK_HEADER_NAME]: staleIso },
      data: { id: current.costCenterId, name: 'QA TC-PR-002 stale rename' },
    });
    await expectConflict(res, staleIso);

    const after = await readListItem(request, token, current, '/api/posting_rules/cost-centers', current.costCenterId);
    expect(after.name, 'a 409 must not rename the cost centre').toBe(before.name);
  });

  test('PUT /default-account-posting-rules with a stale version returns 409 and keeps the default cost centre', async ({ request }) => {
    const current = org as PostingRulesOrg;
    const before = await readListItem(request, token, current, '/api/posting_rules/default-account-posting-rules', current.ruleId);
    const staleIso = staleIsoBefore(before.updatedAt as string);

    const res = await apiRequest(request, 'PUT', '/api/posting_rules/default-account-posting-rules', {
      token,
      headers: { ...current.headers, [OPTIMISTIC_LOCK_HEADER_NAME]: staleIso },
      data: { id: current.ruleId, defaultCostCenterId: null },
    });
    await expectConflict(res, staleIso);

    const after = await readListItem(request, token, current, '/api/posting_rules/default-account-posting-rules', current.ruleId);
    expect(after.defaultCostCenterId, 'a 409 must not change the rule').toBe(current.costCenterId);
  });
});
