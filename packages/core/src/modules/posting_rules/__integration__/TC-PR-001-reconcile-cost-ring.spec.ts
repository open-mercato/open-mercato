import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setRoleAclFeatures,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCurrencyFixture,
  generateUniqueCurrencyCode,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { createAccountFixture, createFiscalPeriodFixture, seedJournalEntryInDb } from '@open-mercato/core/helpers/integration/ledgerFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';

/**
 * TC-PR-001: `POST /api/posting_rules/reconcile` — the repair sweeper
 * (`reconcileCostRing`) reclassifying a zespół 4 entry that was posted
 * with no corresponding reclassification, and returning 422/403 for its
 * documented error paths.
 *
 * **Scope, and why this is the only HTTP-reachable slice of this PR's
 * behavior**: the scenario originally proposed for this test was "posted
 * journal entry on a zespół 4 account -> automatic reclassification ->
 * blocked period-close for unreclassified entries". Two real, verified
 * facts about this codebase make most of that unreachable through a live
 * HTTP integration test:
 *
 * 1. `ledger.postJournalEntry` has **no HTTP route** in Phase 1 (see
 *    `ledgerFixtures.ts`'s own doc comment, quoting
 *    `.ai/specs/2026-08-18-general-ledger-core-engine.md`'s API Contracts:
 *    "No POST/PUT/DELETE on this route -- posting only happens through
 *    postJournalEntry/reverseJournalEntry [called programmatically]"). A
 *    journal entry can only be *seeded* directly into Postgres
 *    (`seedJournalEntryInDb`, used below) for this kind of test, which
 *    bypasses `ledger.journal_entry.posted` entirely -- so
 *    `PostingRulesEngineSubscriber` (the automatic, on-post reclassifier)
 *    can never fire in an HTTP-driven integration test. It is covered
 *    instead by this module's own Jest unit suite
 *    (`lib/__tests__/reclassify.test.ts`).
 * 2. `posting_rules.lockFiscalPeriod` (the period-close guard) likewise has
 *    **no HTTP route** -- and, per the spec itself (§ Cross-module
 *    integration, "Known integration gap, not addressed in this
 *    document"), this is a deliberate Phase 1 scope decision, not a bug:
 *    wiring #5663's Fiscal Periods "Lock" button to this guard is
 *    explicitly out of scope here, so nothing in the running app can
 *    reach this guard over HTTP yet.
 *
 * `reconcileCostRing` -- the sweeper that reuses the exact same
 * `findUnreclassifiedEntries`/`reclassifyLine` logic the subscriber and the
 * guard both depend on -- is the one piece of this behavior genuinely
 * reachable through a real route (`POST /api/posting_rules/reconcile`), so
 * that is what this spec exercises end to end against a live app and a
 * real Postgres database.
 *
 * **A second, equally load-bearing verified fact**: `LedgerAccountGroup`
 * ("zespoły 0-8") and `posting_rules`' own sentinel `CostCenter` are both
 * seeded by each module's `setup.ts` `seedDefaults` hook -- but that hook
 * is only ever invoked by the `mercato initialize`/`mercato seed:defaults`
 * CLI commands (`packages/cli/src/mercato.ts`), never automatically when an
 * organization is created through `POST /api/directory/organizations`
 * (confirmed: no subscriber on `directory.organization.created` calls it).
 * A throwaway organization created by this spec therefore starts with
 * *no* `LedgerAccountGroup` rows and *no* seeded sentinel cost centre, the
 * same as every other integration test's throwaway org. Since
 * `LedgerAccountGroup` has no create route (permanently system-seeded
 * reference data -- see `api/account-groups/route.ts`), this spec seeds
 * the two zespół groups it needs directly via SQL (`seedAccountGroupInDb`
 * below), the same "no route exists for this row" rationale
 * `seedJournalEntryInDb` itself documents. The cost centre is not seeded
 * around this gap the same way -- `posting_rules.createCostCenter` is a
 * real route, so this spec creates an explicit `CostCenter` and references
 * it directly from the `DefaultAccountPostingRule`, rather than relying on
 * `reclassifyLine`'s sentinel-cost-centre fallback (which would 422 with
 * "sentinel cost centre missing" against an un-seeded throwaway org).
 */

const randomSlug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  const id = body?.id;
  expect(typeof id === 'string' && id.length > 0).toBeTruthy();
  return id as string;
}

function scopedHeaders(scope: { tenantId: string; organizationId: string }): Record<string, string> {
  return {
    Cookie: [
      `om_selected_tenant=${encodeURIComponent(scope.tenantId)}`,
      `om_selected_org=${encodeURIComponent(scope.organizationId)}`,
    ].join('; '),
  };
}

/**
 * `LedgerAccountGroup` has no create route (system-seeded reference data
 * only, see this file's header comment) and a throwaway integration-test
 * organization never has `ledger`'s `seedDefaults` run against it -- so
 * this seeds the one zespół group this spec needs directly, matching
 * `seedJournalEntryInDb`'s own "no route exists for this row" precedent.
 */
async function seedAccountGroupInDb(input: {
  organizationId: string;
  tenantId: string;
  jurisdiction: string;
  code: string;
  name: string;
}): Promise<string> {
  const id = randomUUID();
  return withClient(async (client) => {
    await client.query(
      `insert into ledger_account_groups
         (id, organization_id, tenant_id, jurisdiction, code, name, created_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [id, input.organizationId, input.tenantId, input.jurisdiction, input.code, input.name],
    );
    return id;
  });
}

/**
 * `createAccountTypeFixture` (ledgerFixtures.ts) does not expose
 * `accountGroupId` in its typed input, so this test calls the route
 * directly for the two account types that must actually be classified as
 * zespół 4 / zespół 5 for `findUnreclassifiedEntries`/`reclassifyLine` to
 * recognize them (see `ledgerAccountTypeCreateSchema`).
 */
async function createAccountTypeWithGroup(
  request: APIRequestContext,
  token: string,
  input: {
    organizationId: string;
    tenantId: string;
    slug: string;
    name: string;
    normalBalance: 'DEBIT' | 'CREDIT';
    accountGroupId: string | null;
    headers: Record<string, string>;
  },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/ledger/account-types', {
    token,
    data: {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      slug: input.slug,
      name: input.name,
      normalBalance: input.normalBalance,
      accountGroupId: input.accountGroupId,
    },
    headers: input.headers,
  });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), `Failed to create account type: ${response.status()} ${JSON.stringify(body)}`).toBe(201);
  return (body?.id as string);
}

async function getJournalEntryLines(
  entryId: string,
): Promise<Array<{ accountId: string; debit: string; credit: string }>> {
  return withClient(async (client) => {
    const result = await client.query(
      `select account_id as "accountId", debit, credit from journal_entry_lines where journal_entry_id = $1`,
      [entryId],
    );
    return result.rows as Array<{ accountId: string; debit: string; credit: string }>;
  });
}

test.describe('TC-PR-001: POST /api/posting_rules/reconcile', () => {
  test('returns 422 when PostingRulesSettings.clearingAccountId is not configured', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-PR-001a Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-PR-001a Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      // This throwaway organization never had posting_rules' own
      // `seedDefaults` run against it (see this file's header comment), so
      // `PostingRulesSettings` doesn't even have a row yet -- exercising
      // the same "not configured" 422 a freshly-installed, never-yet-
      // configured real organization would also hit.
      const res = await apiRequest(request, 'POST', '/api/posting_rules/reconcile', {
        token: superadminToken,
        headers,
        data: {},
      });
      expect(res.status(), 'reconcile without a configured clearing account should return 422').toBe(422);
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });

  test('returns 403 without posting_rules.reconcile.run', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-PR-001b Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-PR-001b Organization ${stamp}`,
        tenantId,
      });

      roleId = await createRoleFixture(request, superadminToken, { name: randomSlug('QA-PR-001b-role'), tenantId });
      await setRoleAclFeatures(request, superadminToken, { roleId, features: [] });
      const email = `qa-pr-001b-${randomUUID().slice(0, 8)}@acme.com`;
      userId = await createUserFixture(request, superadminToken, {
        email,
        password: 'Valid1!Pass',
        organizationId,
        roles: [roleId],
      });
      const restrictedToken = await getAuthToken(request, email, 'Valid1!Pass');

      const res = await apiRequest(request, 'POST', '/api/posting_rules/reconcile', {
        token: restrictedToken,
        data: {},
      });
      expect(res.status(), 'reconcile without posting_rules.reconcile.run should return 403').toBe(403);
    } finally {
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });

  test('reclassifies an unreclassified zespół 4 entry via its DefaultAccountPostingRule, then finds nothing left on a second run', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();

    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let currencyId: string | null = null;
    let headers: Record<string, string> = {};
    let entryId: string | null = null;

    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-PR-001c Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-PR-001c Organization ${stamp}`,
        tenantId,
      });
      const scope = { tenantId, organizationId };
      headers = scopedHeaders(scope);

      currencyId = await createCurrencyFixture(request, superadminToken, {
        code: generateUniqueCurrencyCode(),
        name: 'QA TC-PR-001 Currency',
        organizationId,
        tenantId,
        headers,
      });

      // `ledger.postJournalEntry` (invoked internally by `reconcileCostRing`
      // -> `reclassifyLine` -> `postReclassification` when it posts the
      // reclassification entry) requires a covering, unlocked FiscalPeriod
      // for the operation date it posts against -- `reclassifyLine` reuses
      // the *original* entry's `operationDate` for the reclassification
      // (see `reclassify.ts`'s `postReclassification` call). `seedJournalEntryInDb`
      // bypasses this check entirely (raw SQL insert, no command layer), but
      // the reclassification itself goes through the real `postJournalEntry`
      // command path, so this throwaway org needs an explicit covering
      // period or that post 422s with "No fiscal period covers this
      // operation date."
      await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId, tenantId, startDate: '2031-03-01', endDate: '2031-03-31' },
        { headers },
      );

      // zespół 4 (source, costs by nature) and zespół 5 (target, costs by
      // type of activity) groups -- seeded directly (see this file's header
      // comment on why a throwaway org has none of these yet).
      // Classification is resolved via LedgerAccount ->
      // LedgerAccountType.accountGroupId ->
      // LedgerAccountGroup{jurisdiction: 'PL', code}, see
      // `lib/reclassify.ts`'s `resolveAccountClassification`.
      const zespol4GroupId = await seedAccountGroupInDb({
        organizationId,
        tenantId,
        jurisdiction: 'PL',
        code: '4',
        name: 'QA TC-PR-001 Zespół 4 -- Koszty według rodzaju',
      });
      const zespol5GroupId = await seedAccountGroupInDb({
        organizationId,
        tenantId,
        jurisdiction: 'PL',
        code: '5',
        name: 'QA TC-PR-001 Zespół 5 -- Koszty według typów działalności',
      });

      const zespol4TypeId = await createAccountTypeWithGroup(request, superadminToken, {
        organizationId,
        tenantId,
        slug: randomSlug('qa-pr-001-zesp4-type'),
        name: 'QA TC-PR-001 Zespół 4 Type',
        normalBalance: 'DEBIT',
        accountGroupId: zespol4GroupId,
        headers,
      });
      const zespol5TypeId = await createAccountTypeWithGroup(request, superadminToken, {
        organizationId,
        tenantId,
        slug: randomSlug('qa-pr-001-zesp5-type'),
        name: 'QA TC-PR-001 Zespół 5 Type',
        normalBalance: 'DEBIT',
        accountGroupId: zespol5GroupId,
        headers,
      });
      // A plain, ungrouped account type for the balancing line and the
      // technical clearing account -- neither needs to classify as any
      // zespół for this test.
      const plainTypeId = await createAccountTypeWithGroup(request, superadminToken, {
        organizationId,
        tenantId,
        slug: randomSlug('qa-pr-001-plain-type'),
        name: 'QA TC-PR-001 Plain Type',
        normalBalance: 'CREDIT',
        accountGroupId: null,
        headers,
      });

      const sourceAccountId = await createAccountFixture(
        request,
        superadminToken,
        { organizationId, tenantId, slug: randomSlug('qa-pr-001-source'), accountTypeId: zespol4TypeId },
        { headers },
      );
      const targetAccountId = await createAccountFixture(
        request,
        superadminToken,
        { organizationId, tenantId, slug: randomSlug('qa-pr-001-target'), accountTypeId: zespol5TypeId },
        { headers },
      );
      const clearingAccountId = await createAccountFixture(
        request,
        superadminToken,
        { organizationId, tenantId, slug: randomSlug('qa-pr-001-clearing'), accountTypeId: plainTypeId },
        { headers },
      );
      const balancingAccountId = await createAccountFixture(
        request,
        superadminToken,
        { organizationId, tenantId, slug: randomSlug('qa-pr-001-cash'), accountTypeId: plainTypeId },
        { headers },
      );

      // Configure the clearing account (required).
      const settingsRes = await apiRequest(request, 'PATCH', '/api/posting_rules/settings', {
        token: superadminToken,
        headers,
        data: { clearingAccountId },
      });
      expect(settingsRes.status(), 'PATCH settings should return 200').toBe(200);

      // An explicit CostCenter, referenced directly from the
      // DefaultAccountPostingRule below -- this throwaway org has no
      // seeded sentinel "UNALLOCATED" cost centre to fall back to (see
      // this file's header comment), so `reclassifyLine`'s sentinel-lookup
      // path is deliberately not exercised here.
      const costCenterRes = await apiRequest(request, 'POST', '/api/posting_rules/cost-centers', {
        token: superadminToken,
        headers,
        data: { organizationId, tenantId, code: randomSlug('QA-CC'), name: 'QA TC-PR-001 Cost Centre' },
      });
      expect(costCenterRes.status(), 'POST cost-centers should return 201').toBe(201);
      const costCenterBody = (await costCenterRes.json()) as { id: string };
      const costCenterId = costCenterBody.id;

      // The 4->5 mapping reconcileCostRing/reclassifyLine resolve through.
      const ruleRes = await apiRequest(request, 'POST', '/api/posting_rules/default-account-posting-rules', {
        token: superadminToken,
        headers,
        data: { organizationId, tenantId, sourceAccountId, targetAccountId, defaultCostCenterId: costCenterId },
      });
      expect(ruleRes.status(), 'POST default-account-posting-rules should return 201').toBe(201);

      // `ledger.postJournalEntry` has no HTTP route (see this file's header
      // comment) -- seed the entry directly, matching `ledger`'s own
      // TC-GL-001/003 precedent. A debit on the zespół 4 (source) account
      // is its *normal* side (normalBalance: 'DEBIT'), which is exactly the
      // side `reclassifyLine` treats as "needs a 4->5 reclassification",
      // not a reversal.
      entryId = await seedJournalEntryInDb({
        organizationId,
        tenantId,
        currencyId,
        operationDate: '2031-03-15',
        lines: [
          { accountId: sourceAccountId, debit: '250.0000', credit: '0' },
          { accountId: balancingAccountId, debit: '0', credit: '250.0000' },
        ],
      });

      const reconcileRes = await apiRequest(request, 'POST', '/api/posting_rules/reconcile', {
        token: superadminToken,
        headers,
        data: {},
      });
      expect(reconcileRes.status(), 'reconcile should return 200').toBe(200);
      const reconcileBody = (await reconcileRes.json()) as {
        ok: boolean;
        result: { entriesInspected: number; linesReclassified: number };
      };
      expect(reconcileBody.result.entriesInspected, 'exactly the one seeded entry should be inspected').toBe(1);
      expect(reconcileBody.result.linesReclassified, 'its one zespół 4 line should be reclassified').toBe(1);

      // The reclassification entry references the original by id, per
      // `RECLASSIFICATION_REFERENCE_TYPE`/`referenceId` (see reclassify.ts).
      const listRes = await apiRequest(
        request,
        'GET',
        `/api/ledger/journal-entries?referenceType=${encodeURIComponent('PostingRulesEngineReclassification')}&referenceId=${encodeURIComponent(entryId)}`,
        { token: superadminToken, headers },
      );
      expect(listRes.status(), 'GET journal-entries filtered by referenceType/referenceId should return 200').toBe(200);
      const listBody = (await listRes.json()) as { items: Array<{ id: string }> };
      expect(listBody.items.length, 'exactly one reclassification entry should reference the seeded entry').toBe(1);
      const reclassificationEntryId = listBody.items[0].id;

      // Mirrors the spec's own forward-path shape (see reclassify.ts's
      // `reclassifyLine`, the `isNormalSide` branch): debit the resolved
      // target (zespół 5) account, credit the clearing account, for the
      // same amount as the original line.
      const lines = await getJournalEntryLines(reclassificationEntryId);
      const debitLine = lines.find((line) => line.accountId === targetAccountId);
      const creditLine = lines.find((line) => line.accountId === clearingAccountId);
      expect(debitLine, 'the reclassification should debit the resolved target (zespół 5) account').toBeTruthy();
      expect(Number(debitLine?.debit)).toBeCloseTo(250, 4);
      expect(creditLine, 'the reclassification should credit the configured clearing account').toBeTruthy();
      expect(Number(creditLine?.credit)).toBeCloseTo(250, 4);

      // Idempotent: `findUnreclassifiedEntries` selects purely by absence of
      // a matching reclassification, so a second sweep over the same
      // organization finds nothing left to do.
      const secondReconcileRes = await apiRequest(request, 'POST', '/api/posting_rules/reconcile', {
        token: superadminToken,
        headers,
        data: {},
      });
      expect(secondReconcileRes.status(), 'second reconcile should still return 200').toBe(200);
      const secondBody = (await secondReconcileRes.json()) as {
        result: { entriesInspected: number; linesReclassified: number };
      };
      expect(secondBody.result.linesReclassified, 'the already-reclassified line must not be reclassified twice').toBe(0);
    } finally {
      await deleteCurrenciesEntityIfExists(request, superadminToken, '/api/currencies/currencies', currencyId);
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });
});
