import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { seedJournalEntryInDb } from '@open-mercato/core/helpers/integration/ledgerFixtures';
import {
  countReclassificationsOf,
  createPostingRulesOrg,
  deletePostingRulesOrg,
  getJournalEntryLines,
  randomSlug,
  type PostingRulesOrg,
} from './helpers/postingRulesFixtures';

/**
 * TC-PR-003: tenant/organization isolation (spec, Testing Strategy:
 * "`CostCenter`/`DefaultAccountPostingRule`/`PostingRulesSettings` reads and
 * writes never cross tenant/organization boundaries", and Risks, "the
 * subscriber/sweeper always operate within the source entry's own
 * tenant/organization"). Organization A owns a cost centre, a rule, settings
 * and an unreclassified zespół 4 line. Two non-superadmin users with every
 * posting_rules feature try to read and change A's data: one in another
 * tenant (B), one in another organization of A's own tenant (A2, role limited
 * to A2). Neither may see or change anything of A's, and neither one's
 * reconcile sweep may touch A's line.
 */

type Actor = { label: string; token: string; org: PostingRulesOrg };

async function createActor(
  request: APIRequestContext,
  superadminToken: string,
  org: PostingRulesOrg,
  cleanup: { roles: string[]; users: string[] },
): Promise<string> {
  const roleId = await createRoleFixture(request, superadminToken, { name: randomSlug('QA-PR-003-role'), tenantId: org.tenantId });
  cleanup.roles.push(roleId);
  await setRoleAclFeatures(request, superadminToken, { roleId, features: ['posting_rules.*'], organizations: [org.organizationId] });
  const email = `qa-pr-003-${randomUUID().slice(0, 8)}@acme.com`;
  const userId = await createUserFixture(request, superadminToken, { email, password: 'Valid1!Pass', organizationId: org.organizationId, roles: [roleId] });
  cleanup.users.push(userId);
  return getAuthToken(request, email, 'Valid1!Pass');
}

async function listIds(request: APIRequestContext, token: string, path: string, query = ''): Promise<string[]> {
  const res = await apiRequest(request, 'GET', `${path}${query}`, { token });
  expect(res.status(), `GET ${path}${query}`).toBe(200);
  return ((await res.json()) as { items: Array<{ id: string }> }).items.map((item) => item.id);
}

async function readAsOwner(request: APIRequestContext, token: string, owner: PostingRulesOrg, path: string, id: string) {
  const res = await apiRequest(request, 'GET', `${path}?id=${encodeURIComponent(id)}`, { token, headers: owner.headers });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: Array<Record<string, unknown>> }).items;
}

test.describe('TC-PR-003: posting_rules tenant and organization isolation', () => {
  test('another tenant and another organization can neither read nor write organization A\'s posting rules data', async ({ request }) => {
    test.setTimeout(120_000);
    const superadminToken = await getAuthToken(request, 'superadmin');
    const cleanup = { roles: [] as string[], users: [] as string[] };
    let orgA: PostingRulesOrg | null = null;
    let orgA2: PostingRulesOrg | null = null;
    let orgB: PostingRulesOrg | null = null;

    try {
      orgA = await createPostingRulesOrg(request, superadminToken, { label: 'TC-PR-003 A', periodStart: '2034-05-01', periodEnd: '2034-05-31' });
      orgA2 = await createPostingRulesOrg(request, superadminToken, { label: 'TC-PR-003 A2', tenantId: orgA.tenantId, periodStart: '2034-05-01', periodEnd: '2034-05-31' });
      orgB = await createPostingRulesOrg(request, superadminToken, { label: 'TC-PR-003 B', periodStart: '2034-05-01', periodEnd: '2034-05-31' });
      const owner = orgA;

      const entryId = await seedJournalEntryInDb({
        organizationId: owner.organizationId,
        tenantId: owner.tenantId,
        currencyId: owner.currencyId,
        operationDate: '2034-05-10',
        lines: [
          { accountId: owner.sourceAccountId, debit: '75.0000', credit: '0' },
          { accountId: owner.balancingAccountId, debit: '0', credit: '75.0000' },
        ],
      });
      const sourceLineId = (await getJournalEntryLines(entryId)).find((line) => line.accountId === owner.sourceAccountId)?.id as string;

      const actors: Actor[] = [
        { label: 'other tenant', token: await createActor(request, superadminToken, orgB, cleanup), org: orgB },
        { label: 'other organization, same tenant', token: await createActor(request, superadminToken, orgA2, cleanup), org: orgA2 },
      ];

      for (const actor of actors) {
        const says = (what: string) => `${actor.label}: ${what}`;

        expect(await listIds(request, actor.token, '/api/posting_rules/cost-centers'), says('cost-centre list')).not.toContain(owner.costCenterId);
        expect(await listIds(request, actor.token, '/api/posting_rules/cost-centers', `?id=${owner.costCenterId}`), says('cost centre by id')).toEqual([]);
        expect(await listIds(request, actor.token, '/api/posting_rules/default-account-posting-rules'), says('rule list')).not.toContain(owner.ruleId);
        expect(await listIds(request, actor.token, '/api/posting_rules/default-account-posting-rules', `?id=${owner.ruleId}`), says('rule by id')).toEqual([]);
        expect(await listIds(request, actor.token, '/api/posting_rules/cost-centers'), says('own cost centre is visible')).toContain(actor.org.costCenterId);

        const renameRes = await apiRequest(request, 'PUT', '/api/posting_rules/cost-centers', { token: actor.token, data: { id: owner.costCenterId, name: 'QA TC-PR-003 hijacked' } });
        expect([403, 404], says(`PUT A's cost centre answered ${renameRes.status()}`)).toContain(renameRes.status());
        const deleteCostCenterRes = await apiRequest(request, 'DELETE', `/api/posting_rules/cost-centers?id=${owner.costCenterId}`, { token: actor.token });
        expect([403, 404], says(`DELETE A's cost centre answered ${deleteCostCenterRes.status()}`)).toContain(deleteCostCenterRes.status());

        const ruleUpdateRes = await apiRequest(request, 'PUT', '/api/posting_rules/default-account-posting-rules', { token: actor.token, data: { id: owner.ruleId, defaultCostCenterId: null } });
        expect([403, 404], says(`PUT A's rule answered ${ruleUpdateRes.status()}`)).toContain(ruleUpdateRes.status());
        const ruleDeleteRes = await apiRequest(request, 'DELETE', `/api/posting_rules/default-account-posting-rules?id=${owner.ruleId}`, { token: actor.token });
        expect([403, 404], says(`DELETE A's rule answered ${ruleDeleteRes.status()}`)).toContain(ruleDeleteRes.status());

        const settingsRes = await apiRequest(request, 'GET', '/api/posting_rules/settings', { token: actor.token });
        expect(settingsRes.status()).toBe(200);
        const settings = ((await settingsRes.json()) as { result: { clearingAccountId: string | null } }).result;
        expect(settings.clearingAccountId, says('settings are the actor\'s own')).toBe(actor.org.clearingAccountId);

        const foreignAccountSettingsRes = await apiRequest(request, 'PATCH', '/api/posting_rules/settings', { token: actor.token, data: { clearingAccountId: owner.clearingAccountId } });
        expect(foreignAccountSettingsRes.status(), says('A\'s account cannot become the actor\'s clearing account')).toBe(409);
        const foreignRuleRes = await apiRequest(request, 'POST', '/api/posting_rules/default-account-posting-rules', {
          token: actor.token,
          data: { organizationId: actor.org.organizationId, tenantId: actor.org.tenantId, sourceAccountId: owner.sourceAccountId, targetAccountId: actor.org.targetAccountId },
        });
        expect(foreignRuleRes.status(), says('A\'s account cannot be the source of the actor\'s rule')).toBe(409);

        const reconcileRes = await apiRequest(request, 'POST', '/api/posting_rules/reconcile', { token: actor.token, data: {} });
        expect(reconcileRes.status(), says('own reconcile')).toBe(200);
        const reconcile = ((await reconcileRes.json()) as { result: { entriesInspected: number; linesReclassified: number } }).result;
        expect(reconcile.entriesInspected, says('own reconcile sees none of A\'s entries')).toBe(0);
        expect(await countReclassificationsOf([sourceLineId]), says('A\'s line is untouched')).toBe(0);
      }

      const ownerCostCenter = await readAsOwner(request, superadminToken, owner, '/api/posting_rules/cost-centers', owner.costCenterId);
      expect(ownerCostCenter.map((row) => row.name)).toEqual(['QA TC-PR-003 A Cost Centre']);
      const ownerRule = await readAsOwner(request, superadminToken, owner, '/api/posting_rules/default-account-posting-rules', owner.ruleId);
      expect(ownerRule.map((row) => row.defaultCostCenterId)).toEqual([owner.costCenterId]);
      const ownerSettingsRes = await apiRequest(request, 'GET', '/api/posting_rules/settings', { token: superadminToken, headers: owner.headers });
      expect(((await ownerSettingsRes.json()) as { result: { clearingAccountId: string } }).result.clearingAccountId).toBe(owner.clearingAccountId);

      const ownerReconcileRes = await apiRequest(request, 'POST', '/api/posting_rules/reconcile', { token: superadminToken, headers: owner.headers, data: {} });
      expect(ownerReconcileRes.status()).toBe(200);
      expect(((await ownerReconcileRes.json()) as { result: { linesReclassified: number } }).result.linesReclassified, 'A\'s own sweep reclassifies its line').toBe(1);
      expect(await countReclassificationsOf([sourceLineId])).toBe(1);
    } finally {
      for (const userId of cleanup.users) await deleteUserIfExists(request, superadminToken, userId);
      for (const roleId of cleanup.roles) await deleteRoleIfExists(request, superadminToken, roleId);
      await deletePostingRulesOrg(request, superadminToken, orgA2, { deleteTenant: false });
      await deletePostingRulesOrg(request, superadminToken, orgA);
      await deletePostingRulesOrg(request, superadminToken, orgB);
    }
  });
});
