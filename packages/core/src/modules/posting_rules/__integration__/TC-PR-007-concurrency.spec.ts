import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { createPostingRulesOrg, deletePostingRulesOrg, randomSlug, type PostingRulesOrg } from './helpers/postingRulesFixtures';

/**
 * TC-PR-007: check-then-act races in the configuration commands, on a real
 * database with two connections (spec, Risks; financial-command checklist
 * item 9). A second connection plays the in-flight writer and keeps its
 * transaction open while the real API route runs; the test asserts that the
 * route waits on the row lock or the unique index and then answers with the
 * committed state, never 200 on stale data and never 500.
 */

const COST_CENTERS = '/api/posting_rules/cost-centers';
const RULES = '/api/posting_rules/default-account-posting-rules';
const WAIT_MS = 1_500;

type Pending = { response: Promise<APIResponse>; isSettled: () => boolean };

function startRequest(run: () => Promise<APIResponse>): Pending {
  let settled = false;
  const response = run();
  response.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  return { response, isSettled: () => settled };
}

async function createCostCenter(request: APIRequestContext, token: string, org: PostingRulesOrg, label: string): Promise<string> {
  const res = await apiRequest(request, 'POST', COST_CENTERS, {
    token,
    headers: org.headers,
    data: { organizationId: org.organizationId, tenantId: org.tenantId, code: randomSlug('QA-CC7'), name: `QA TC-PR-007 ${label}` },
  });
  expect(res.status(), 'POST cost-centers should return 201').toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function deleteRule(request: APIRequestContext, token: string, org: PostingRulesOrg, ruleId: string): Promise<void> {
  const res = await apiRequest(request, 'DELETE', `${RULES}?id=${ruleId}`, { token, headers: org.headers });
  expect(res.status(), 'DELETE default-account-posting-rules should return 200').toBe(200);
}

async function countRulesForSource(org: PostingRulesOrg): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query(
      'select count(*)::int as count from posting_rules_default_account_posting_rules where organization_id = $1 and tenant_id = $2 and source_account_id = $3',
      [org.organizationId, org.tenantId, org.sourceAccountId],
    );
    return (result.rows[0] as { count: number }).count;
  });
}

test.describe('TC-PR-007: configuration races on a real database (two connections)', () => {
  let token: string;
  let org: PostingRulesOrg | null = null;

  test.beforeEach(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin');
    org = await createPostingRulesOrg(request, token, { label: 'TC-PR-007', periodStart: '2035-01-01', periodEnd: '2035-01-31' });
  });

  test.afterEach(async ({ request }) => {
    await deletePostingRulesOrg(request, token, org);
    org = null;
  });

  test('deleting a cost centre waits for an in-flight rule that references it, then is refused with 409', async ({ request }) => {
    test.slow();
    const current = org as PostingRulesOrg;
    const costCenterId = await createCostCenter(request, token, current, 'referenced in flight');

    let pending: Pending | null = null;
    await withClient(async (client) => {
      await client.query('begin');
      try {
        await client.query(
          'select id from posting_rules_cost_centers where id = $1 and organization_id = $2 and tenant_id = $3 and deleted_at is null for share',
          [costCenterId, current.organizationId, current.tenantId],
        );
        pending = startRequest(() => apiRequest(request, 'DELETE', `${COST_CENTERS}?id=${costCenterId}`, { token, headers: current.headers }));
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        expect((pending as Pending).isSettled(), 'the delete waits while the rule write holds the cost centre').toBe(false);
        await client.query(
          'update posting_rules_default_account_posting_rules set default_cost_center_id = $1, updated_at = now() where id = $2',
          [costCenterId, current.ruleId],
        );
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });

    const deleteRes = await (pending as unknown as Pending).response;
    expect(deleteRes.status(), 'the rule won the race, so the delete is refused (409, not 200 or 500)').toBe(409);
    const body = (await deleteRes.json()) as { error?: string };
    expect(body.error).toMatch(/still uses it/i);

    const stillLive = await withClient(async (client) => {
      const result = await client.query('select deleted_at from posting_rules_cost_centers where id = $1', [costCenterId]);
      return (result.rows[0] as { deleted_at: Date | null }).deleted_at;
    });
    expect(stillLive, 'the cost centre was not soft-deleted').toBeNull();
  });

  test('creating a rule waits for an in-flight delete of its cost centre, then is refused with 409', async ({ request }) => {
    test.slow();
    const current = org as PostingRulesOrg;
    await deleteRule(request, token, current, current.ruleId);
    const costCenterId = await createCostCenter(request, token, current, 'deleted in flight');

    let pending: Pending | null = null;
    await withClient(async (client) => {
      await client.query('begin');
      try {
        await client.query(
          'select id from posting_rules_cost_centers where id = $1 and organization_id = $2 and tenant_id = $3 and deleted_at is null for update',
          [costCenterId, current.organizationId, current.tenantId],
        );
        pending = startRequest(() =>
          apiRequest(request, 'POST', RULES, {
            token,
            headers: current.headers,
            data: {
              organizationId: current.organizationId,
              tenantId: current.tenantId,
              sourceAccountId: current.sourceAccountId,
              targetAccountId: current.targetAccountId,
              defaultCostCenterId: costCenterId,
            },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        expect((pending as Pending).isSettled(), 'the rule create waits while the delete holds the cost centre').toBe(false);
        await client.query('update posting_rules_cost_centers set deleted_at = now(), updated_at = now() where id = $1', [costCenterId]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });

    const createRes = await (pending as unknown as Pending).response;
    expect(createRes.status(), 'the delete won the race, so the rule is refused (409, not 201 or 500)').toBe(409);
    const body = (await createRes.json()) as { error?: string };
    expect(body.error).toMatch(/cost centre does not exist/i);
    expect(await countRulesForSource(current), 'no rule points at the deleted cost centre').toBe(0);
  });

  test('a concurrent duplicate rule for the same source account is a 409, not a 500', async ({ request }) => {
    test.slow();
    const current = org as PostingRulesOrg;
    await deleteRule(request, token, current, current.ruleId);

    let pending: Pending | null = null;
    await withClient(async (client) => {
      await client.query('begin');
      try {
        await client.query(
          'insert into posting_rules_default_account_posting_rules (organization_id, tenant_id, source_account_id, target_account_id, default_cost_center_id, created_at, updated_at) values ($1, $2, $3, $4, $5, now(), now())',
          [current.organizationId, current.tenantId, current.sourceAccountId, current.targetAccountId, current.costCenterId],
        );
        pending = startRequest(() =>
          apiRequest(request, 'POST', RULES, {
            token,
            headers: current.headers,
            data: {
              organizationId: current.organizationId,
              tenantId: current.tenantId,
              sourceAccountId: current.sourceAccountId,
              targetAccountId: current.targetAccountId,
              defaultCostCenterId: current.costCenterId,
            },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        expect((pending as Pending).isSettled(), 'the second insert waits on the unique index while the first is uncommitted').toBe(false);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });

    const createRes = await (pending as unknown as Pending).response;
    expect(createRes.status(), 'the concurrent duplicate is answered with 409, not 500').toBe(409);
    const body = (await createRes.json()) as { error?: string };
    expect(body.error).toEqual(expect.any(String));
    expect(await countRulesForSource(current), 'exactly one rule exists for the source account').toBe(1);
  });
});
