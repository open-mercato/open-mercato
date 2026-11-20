import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { seedJournalEntryInDb } from '@open-mercato/core/helpers/integration/ledgerFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  RECLASSIFICATION_REFERENCE_TYPE,
  createPostingRulesOrg,
  deletePostingRulesOrg,
  type PostingRulesOrg,
} from './helpers/postingRulesFixtures';

/**
 * TC-PR-004: Invariant 2 — "The clearing account's engine-posted balance is
 * net, not zero. Over the entries this engine posted (those carrying the
 * marker), the clearing account's credit balance equals the sum of
 * normal-side source lines reclassified minus the sum of contra-side source
 * lines mirrored, over the same source set." The check is restricted to the
 * engine's own entries: a manual posting to the clearing account changes the
 * account's total balance but not the engine-posted one.
 */

const NORMAL_SIDE = ['100.0000', '250.5000', '40.2500'];
const CONTRA_SIDE = ['30.0000', '15.2500'];
const EXPECTED_NET = '345.5000';
const MANUAL_CLEARING_CREDIT = '999.0000';

async function clearingBalance(org: PostingRulesOrg, onlyEngineEntries: boolean): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query(
      `select coalesce(sum(l.credit - l.debit), 0)::numeric(19,4)::text as balance
         from journal_entry_lines l
         join journal_entries e on e.id = l.journal_entry_id
        where e.organization_id = $1 and e.tenant_id = $2 and l.account_id = $3
          and ($4::boolean = false or e.reference_type = $5)`,
      [org.organizationId, org.tenantId, org.clearingAccountId, onlyEngineEntries, RECLASSIFICATION_REFERENCE_TYPE],
    );
    return (result.rows[0] as { balance: string }).balance;
  });
}

async function sourceSetNet(org: PostingRulesOrg): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query(
      `select coalesce(sum(l.debit - l.credit), 0)::numeric(19,4)::text as net
         from journal_entry_lines l
         join journal_entries e on e.id = l.journal_entry_id
        where e.organization_id = $1 and e.tenant_id = $2 and l.account_id = $3
          and e.reference_type is distinct from $4`,
      [org.organizationId, org.tenantId, org.sourceAccountId, RECLASSIFICATION_REFERENCE_TYPE],
    );
    return (result.rows[0] as { net: string }).net;
  });
}

test.describe('TC-PR-004: Invariant 2, the clearing account nets over the engine\'s own entries', () => {
  test('after N normal-side and M contra-side reclassifications the engine-posted clearing balance is normal minus contra', async ({ request }) => {
    test.setTimeout(120_000);
    const superadminToken = await getAuthToken(request, 'superadmin');
    let org: PostingRulesOrg | null = null;
    try {
      org = await createPostingRulesOrg(request, superadminToken, { label: 'TC-PR-004', periodStart: '2035-07-01', periodEnd: '2035-07-31' });
      const current = org;
      const seed = (lines: Array<{ accountId: string; debit: string; credit: string }>) =>
        seedJournalEntryInDb({ organizationId: current.organizationId, tenantId: current.tenantId, currencyId: current.currencyId, operationDate: '2035-07-12', lines });

      for (const amount of NORMAL_SIDE) {
        await seed([
          { accountId: current.sourceAccountId, debit: amount, credit: '0' },
          { accountId: current.balancingAccountId, debit: '0', credit: amount },
        ]);
      }
      for (const amount of CONTRA_SIDE) {
        await seed([
          { accountId: current.balancingAccountId, debit: amount, credit: '0' },
          { accountId: current.sourceAccountId, debit: '0', credit: amount },
        ]);
      }
      await seed([
        { accountId: current.balancingAccountId, debit: MANUAL_CLEARING_CREDIT, credit: '0' },
        { accountId: current.clearingAccountId, debit: '0', credit: MANUAL_CLEARING_CREDIT },
      ]);

      const reconcileRes = await apiRequest(request, 'POST', '/api/posting_rules/reconcile', { token: superadminToken, headers: current.headers, data: {} });
      expect(reconcileRes.status()).toBe(200);
      const reconcile = ((await reconcileRes.json()) as { result: { linesReclassified: number; failures: unknown[] } }).result;
      expect(reconcile.failures).toEqual([]);
      expect(reconcile.linesReclassified, 'every normal-side and contra-side source line is reclassified').toBe(NORMAL_SIDE.length + CONTRA_SIDE.length);

      expect(await sourceSetNet(current), 'the source set nets to normal minus contra').toBe(EXPECTED_NET);
      expect(await clearingBalance(current, true), 'engine-posted clearing credit balance = normal minus contra').toBe(EXPECTED_NET);
      expect(await clearingBalance(current, false), 'the account total also carries the manual posting').toBe('1344.5000');

      const secondRes = await apiRequest(request, 'POST', '/api/posting_rules/reconcile', { token: superadminToken, headers: current.headers, data: {} });
      expect(((await secondRes.json()) as { result: { linesReclassified: number } }).result.linesReclassified).toBe(0);
      expect(await clearingBalance(current, true), 'a second sweep leaves the net unchanged').toBe(EXPECTED_NET);
    } finally {
      await deletePostingRulesOrg(request, superadminToken, org);
    }
  });
});
