import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
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
import {
  createAccountTypeFixture,
  createAccountFixture,
  createFiscalPeriodFixture,
  seedJournalEntryInDb,
} from '@open-mercato/core/helpers/integration/ledgerFixtures';
import {
  createCurrencyFixture,
  deleteCurrenciesEntityIfExists,
  generateUniqueCurrencyCode,
} from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-GL-007: `POST /api/ledger/accounts/import-default-chart-of-accounts` —
 * 200 (happy path on a Directory-created organization, which also provisions
 * the PL groups, OQ-R1), 409 (non-empty and types-only chart, R3), 403
 * (missing `ledger.accounts.manage`), 422 with "All organizations" selected,
 * the undo-versus-post lock (OQ-R2) — plus the button's UI path (hidden for
 * view-only and for a types-only chart, table refresh on success, not offered
 * once the chart has accounts) and search over the imported accounts (PR
 * #6439 review). Numbered 007: TC-GL-006 is the posting lock protocol spec.
 *
 * Added retroactively per PR #6137 review, M2 — the original spec/
 * implementation shipped with command-level unit tests only, no
 * integration coverage for this new API path or the backend-page button
 * (`.ai/specs/2026-09-15-default-chart-of-accounts.md`, Testing Strategy
 * > Integration Coverage).
 *
 * Each test creates its own throwaway tenant/organization (per `AGENTS.md`'s
 * integration-test isolation rule — self-contained fixtures, no reliance on
 * seeded/demo data) and cleans up in `finally`. An organization created
 * through Directory (`POST /api/directory/organizations`) after initial setup
 * has no PL `LedgerAccountGroup` rows: only `setup.ts`'s `seedDefaults` seeds
 * them, and nothing runs it for a new organization. The import provisions the
 * missing groups itself (spec decision OQ-R1), so no extra setup is needed
 * before calling it — the happy path below is the required test for that.
 */

const randomNumber = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

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

const IMPORT_PATH = '/api/ledger/accounts/import-default-chart-of-accounts';
const ACTIONS_PATH = '/api/audit_logs/audit-logs/actions';
const UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo';
const WAIT_MS = 1500;

type ScopedFixture = { token: string; tenantId: string; organizationId: string; headers: Record<string, string> };

/** The undo token of this organization's most recent import (resource kind of the command's `buildLog`). */
async function findImportUndoToken(request: APIRequestContext, fx: ScopedFixture): Promise<string> {
  const res = await apiRequest(
    request,
    'GET',
    `${ACTIONS_PATH}?resourceKind=${encodeURIComponent('ledger.chart_of_accounts_import')}&pageSize=10`,
    { token: fx.token, headers: fx.headers },
  );
  expect(res.status(), 'GET audit-log actions should return 200').toBe(200);
  const body = (await res.json()) as {
    items?: Array<{ commandId: string; executionState: string; undoToken: string | null }>;
  };
  const entry = (body.items ?? []).find(
    (item) => item.commandId === 'ledger.importDefaultChartOfAccounts' && item.executionState === 'done' && item.undoToken,
  );
  expect(entry?.undoToken, 'the import left an undoable action-log entry').toBeTruthy();
  return entry!.undoToken as string;
}

async function findAccountIdByNumber(request: APIRequestContext, fx: ScopedFixture, number: string): Promise<string> {
  const res = await apiRequest(request, 'GET', `/api/ledger/accounts?search=${encodeURIComponent(number)}&pageSize=50`, {
    token: fx.token,
    headers: fx.headers,
  });
  const body = (await res.json()) as { items: Array<{ id: string; number: string }> };
  const account = body.items.find((item) => item.number === number);
  expect(account, `imported account ${number} exists`).toBeTruthy();
  return account!.id;
}

test.describe('TC-GL-007: import-default-chart-of-accounts 200/409/403, groups provisioning, undo lock, types-only chart, button UI path, search', () => {
  test('happy path on an organization created through Directory: provisions the PL groups and returns 200 with the full template row counts (OQ-R1)', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-007a Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-007a Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      // Created through Directory after setup: no PL groups exist yet (OQ-R1).
      const groupsBefore = await apiRequest(request, 'GET', '/api/ledger/account-groups?jurisdiction=PL&pageSize=50', {
        token: superadminToken,
        headers,
      });
      expect(groupsBefore.status()).toBe(200);
      const groupsBeforeBody = (await groupsBefore.json()) as { items: Array<{ code: string }> };
      expect(groupsBeforeBody.items, 'a Directory-created organization has no PL account groups').toHaveLength(0);

      const res = await apiRequest(request, 'POST', IMPORT_PATH, { token: superadminToken, headers });
      expect(res.status(), 'import against a fresh, empty organization should return 200').toBe(200);
      const body = (await res.json()) as { ok: boolean; createdAccountTypeCount: number; createdAccountCount: number };
      expect(body).toMatchObject({ ok: true, createdAccountTypeCount: 42, createdAccountCount: 46 });

      // The import provisioned zespoły 0-8 for this organization.
      const groupsAfter = await apiRequest(request, 'GET', '/api/ledger/account-groups?jurisdiction=PL&pageSize=50', {
        token: superadminToken,
        headers,
      });
      const groupsAfterBody = (await groupsAfter.json()) as { items: Array<{ code: string }> };
      expect(groupsAfterBody.items.map((group) => group.code).sort()).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });

  test('409 against a non-empty chart of accounts, with the refusal message in the body', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-007b Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-007b Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      const accountTypeId = await createAccountTypeFixture(
        request,
        superadminToken,
        {
          organizationId,
          tenantId,
          number: randomNumber('qa-gl-004b-type'),
          name: 'QA pre-existing type',
          normalBalance: 'DEBIT',
        },
        { headers },
      );
      await createAccountFixture(
        request,
        superadminToken,
        { organizationId, tenantId, number: randomNumber('qa-gl-004b-account'), accountTypeId },
        { headers },
      );

      const res = await apiRequest(request, 'POST', IMPORT_PATH, { token: superadminToken, headers });
      expect(res.status(), 'import against a non-empty chart of accounts should return 409').toBe(409);
      const body = (await res.json()) as { error?: string };
      expect(typeof body.error, 'the 409 body should carry the refusal message').toBe('string');
      expect(body.error).toMatch(/non-empty chart of accounts/i);
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });

  test('types-only chart: 409 from the route and no import button on the accounts page (R3)', async ({ page, request }) => {
    test.slow();
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let managerRoleId: string | null = null;
    let managerUserId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-007g Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-007g Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      // One account type and no account: a normal state while building a
      // chart by hand.
      await createAccountTypeFixture(
        request,
        superadminToken,
        { organizationId, tenantId, number: randomNumber('qa-gl-007g-type'), name: 'QA types-only', normalBalance: 'DEBIT' },
        { headers },
      );

      const res = await apiRequest(request, 'POST', IMPORT_PATH, { token: superadminToken, headers });
      expect(res.status(), 'import against a types-only chart should return 409').toBe(409);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/non-empty chart of accounts/i);

      const managerEmail = `qa-gl-007g-manage-${randomUUID().slice(0, 8)}@acme.com`;
      const managerPassword = 'Valid1!Pass';
      managerRoleId = await createRoleFixture(request, superadminToken, { name: randomNumber('QA-GL-007g-manage'), tenantId });
      await setRoleAclFeatures(request, superadminToken, {
        roleId: managerRoleId,
        features: ['ledger.accounts.view', 'ledger.accounts.manage'],
      });
      managerUserId = await createUserFixture(request, superadminToken, {
        email: managerEmail,
        password: managerPassword,
        organizationId,
        roles: [managerRoleId],
      });

      await loginAsUser(page, managerEmail, managerPassword);
      await page.goto('/backend/ledger/accounts', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /chart of accounts/i })).toBeVisible({ timeout: 10_000 });
      // The manager may create accounts (the "New account" action renders), but
      // the import is not offered while an account type exists.
      await expect(page.getByRole('link', { name: /new account/i }).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: /import default chart of accounts/i })).toHaveCount(0);
    } finally {
      await deleteUserIfExists(request, superadminToken, managerUserId);
      await deleteRoleIfExists(request, superadminToken, managerRoleId);
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });

  test('imported accounts are found by search, by number and by description (PR #6439 review)', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-007e Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-007e Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      const importRes = await apiRequest(request, 'POST', IMPORT_PATH, { token: superadminToken, headers });
      expect(importRes.status(), 'import against a fresh, empty organization should return 200').toBe(200);

      const search = async (term: string) => {
        const res = await apiRequest(request, 'GET', `/api/ledger/accounts?search=${encodeURIComponent(term)}&pageSize=50`, {
          token: superadminToken,
          headers,
        });
        expect(res.status(), `GET /api/ledger/accounts?search=${term} should return 200`).toBe(200);
        const body = (await res.json()) as { items: Array<{ number: string; description: string | null }> };
        return body.items;
      };

      // By number: the zespół 5 accounts added in the same review.
      const byNumber = await search('500-1');
      expect(byNumber.map((item) => item.number)).toContain('500-1');

      // By description (the account's name): "Koszty działalności podstawowej".
      const byDescription = await search('działalności podstawowej');
      expect(byDescription.map((item) => item.number)).toContain('500-1');
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });

  test('undo waits for an in-flight post to an imported account and is refused once it commits (OQ-R2)', async ({ request }) => {
    // The two-connection harness of TC-GL-006 (posting lock protocol): a
    // second connection plays a posting in flight (`for share` on the
    // accounts, lines inserted, transaction open) while the undo goes through
    // the real API route. Jest and BDD run on an in-memory fake with no locks,
    // so this is the only place the undo's lock is exercised for real.
    //   - Without the lock, the undo checks "posted lines" against a snapshot
    //     without the in-flight lines, then soft-deletes accounts that end up
    //     with posted lines (200).
    //   - With the lock (types, then accounts, `for update`, id order), the
    //     undo waits for the posting, then sees its committed lines: 409, and
    //     nothing is deleted.
    test.slow();
    const token = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let currencyId: string | null = null;
    let headers: Record<string, string> = {};
    try {
      tenantId = await createTenant(request, token, `QA TC-GL-007f Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, token, {
        name: `QA TC-GL-007f Organization ${stamp}`,
        tenantId,
      });
      headers = scopedHeaders({ tenantId, organizationId });
      const fx: ScopedFixture = { token, tenantId, organizationId, headers };
      currencyId = await createCurrencyFixture(request, token, {
        code: generateUniqueCurrencyCode(),
        name: 'QA TC-GL-007f Currency',
        organizationId,
        tenantId,
        headers,
      });
      await createFiscalPeriodFixture(
        request,
        token,
        { organizationId, tenantId, startDate: '2035-01-01', endDate: '2035-12-31' },
        { headers },
      );

      const importRes = await apiRequest(request, 'POST', IMPORT_PATH, { token, headers });
      expect(importRes.status(), 'import should return 200').toBe(200);
      const undoToken = await findImportUndoToken(request, fx);
      const cashId = await findAccountIdByNumber(request, fx, '100-1');
      const bankId = await findAccountIdByNumber(request, fx, '130-1');

      let pending: ReturnType<typeof apiRequest> | null = null;
      let settled = false;
      await seedJournalEntryInDb(
        {
          organizationId,
          tenantId,
          currencyId,
          operationDate: '2035-03-10',
          lines: [
            { accountId: cashId, debit: '50.0000', credit: '0' },
            { accountId: bankId, debit: '0', credit: '50.0000' },
          ],
        },
        {
          lockAccountIds: [cashId, bankId],
          whileOpen: async () => {
            pending = apiRequest(request, 'POST', UNDO_PATH, { token, headers, data: { undoToken } });
            pending.then(
              () => { settled = true; },
              () => { settled = true; },
            );
            await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
            expect(settled, 'the undo is blocked while the post is uncommitted').toBe(false);
          },
        },
      );
      const undoRes = await (pending as unknown as ReturnType<typeof apiRequest>);
      expect(undoRes.status(), 'the post won the race, so the undo is refused (409)').toBe(409);
      const undoBody = (await undoRes.json()) as { error?: string };
      expect(undoBody.error).toMatch(/posted journal entries/i);

      const after = await apiRequest(request, 'GET', '/api/ledger/accounts?pageSize=1', { token, headers });
      const afterBody = (await after.json()) as { total: number };
      expect(afterBody.total, 'nothing was soft-deleted').toBe(46);
    } finally {
      if (currencyId) {
        await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId, { headers }).catch(() => undefined);
      }
      await deleteOrganizationIfExists(request, token, organizationId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId);
    }
  });

  test('422 with "All organizations" selected: nothing is imported into any organization', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-007h Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-007h Organization ${stamp}`,
        tenantId,
      });
      const allOrganizationsHeaders = {
        Cookie: `om_selected_tenant=${encodeURIComponent(tenantId)}; om_selected_org=__all__`,
      };

      const res = await apiRequest(request, 'POST', IMPORT_PATH, { token: superadminToken, headers: allOrganizationsHeaders });
      expect(res.status(), 'import without a single selected organization should return 422').toBe(422);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/select a single organization/i);

      // The organization of this tenant stayed empty.
      const accounts = await apiRequest(request, 'GET', '/api/ledger/accounts?pageSize=1', {
        token: superadminToken,
        headers: scopedHeaders({ tenantId, organizationId }),
      });
      const accountsBody = (await accounts.json()) as { total: number };
      expect(accountsBody.total).toBe(0);
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });

  test('403 without ledger.accounts.manage', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-007c Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-007c Organization ${stamp}`,
        tenantId,
      });

      // A role scoped to this organization/tenant with only the view
      // feature — matching Backend Pages' own "hidden entirely for a
      // viewer who only has ledger.accounts.view" claim, checked here at
      // the API layer the button itself calls into.
      roleId = await createRoleFixture(request, superadminToken, { name: randomNumber('QA-GL-004c-role'), tenantId });
      await setRoleAclFeatures(request, superadminToken, { roleId, features: ['ledger.accounts.view'] });
      const email = `qa-gl-004c-${randomUUID().slice(0, 8)}@acme.com`;
      const password = 'Valid1!Pass';
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
      });
      const restrictedToken = await getAuthToken(request, email, password);

      const res = await apiRequest(request, 'POST', IMPORT_PATH, { token: restrictedToken });
      expect(res.status(), 'import without ledger.accounts.manage should return 403').toBe(403);
    } finally {
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });

  test('button UI path: hidden for view-only, refreshes the table on success', async ({ page, request }) => {
    test.slow();
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let viewOnlyRoleId: string | null = null;
    let viewOnlyUserId: string | null = null;
    let managerRoleId: string | null = null;
    let managerUserId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-007d Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-007d Organization ${stamp}`,
        tenantId,
      });

      const viewOnlyEmail = `qa-gl-004d-view-${randomUUID().slice(0, 8)}@acme.com`;
      const viewOnlyPassword = 'Valid1!Pass';
      viewOnlyRoleId = await createRoleFixture(request, superadminToken, { name: randomNumber('QA-GL-004d-view'), tenantId });
      await setRoleAclFeatures(request, superadminToken, { roleId: viewOnlyRoleId, features: ['ledger.accounts.view'] });
      viewOnlyUserId = await createUserFixture(request, superadminToken, {
        email: viewOnlyEmail,
        password: viewOnlyPassword,
        organizationId,
        roles: [viewOnlyRoleId],
      });

      const managerEmail = `qa-gl-004d-manage-${randomUUID().slice(0, 8)}@acme.com`;
      const managerPassword = 'Valid1!Pass';
      managerRoleId = await createRoleFixture(request, superadminToken, { name: randomNumber('QA-GL-004d-manage'), tenantId });
      await setRoleAclFeatures(request, superadminToken, {
        roleId: managerRoleId,
        features: ['ledger.accounts.view', 'ledger.accounts.manage'],
      });
      managerUserId = await createUserFixture(request, superadminToken, {
        email: managerEmail,
        password: managerPassword,
        organizationId,
        roles: [managerRoleId],
      });

      // View-only: the button is absent entirely (Backend Pages: "hidden
      // entirely for a viewer who only has ledger.accounts.view" — not
      // merely disabled).
      await loginAsUser(page, viewOnlyEmail, viewOnlyPassword);
      await page.goto('/backend/ledger/accounts', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /chart of accounts/i })).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole('button', { name: /import default chart of accounts/i }),
      ).toHaveCount(0);

      // Manager: the button is present; confirming it imports the template
      // and the table refreshes to show the imported rows.
      await loginAsUser(page, managerEmail, managerPassword);
      await page.goto('/backend/ledger/accounts', { waitUntil: 'domcontentloaded' });
      const importButton = page.getByRole('button', { name: /import default chart of accounts/i });
      await expect(importButton).toBeVisible({ timeout: 10_000 });
      await importButton.click();

      const dialog = page.getByRole('alertdialog', { name: /import the default chart of accounts/i });
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByRole('button', { name: /^confirm$/i }).click();

      // The success flash names the row counts; the table then shows an
      // imported row's number (e.g. "100-1" — Zespół 1, first template row).
      await expect(page.getByText(/imported 42 account types and 46 accounts/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('100-1', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

      // The chart now has accounts, so the import action is no longer offered
      // (it would only end in a 409) — right after the refresh and after a
      // full reload.
      await expect(page.getByRole('button', { name: /import default chart of accounts/i })).toHaveCount(0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('100-1', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: /import default chart of accounts/i })).toHaveCount(0);
    } finally {
      await deleteUserIfExists(request, superadminToken, managerUserId);
      await deleteRoleIfExists(request, superadminToken, managerRoleId);
      await deleteUserIfExists(request, superadminToken, viewOnlyUserId);
      await deleteRoleIfExists(request, superadminToken, viewOnlyRoleId);
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });
});

/**
 * Logs a Playwright `page` in as an arbitrary email/password — this
 * module's shared `login()` helper
 * (`@open-mercato/core/modules/core/__integration__/helpers/auth`) only
 * supports its three fixed `DEFAULT_CREDENTIALS` roles, not a dynamically
 * created fixture user, so this mirrors that helper's own core successful
 * path (API login via `page.request`, which shares the browser context's
 * cookie jar, so the session cookie the login response sets is picked up
 * automatically) for the one scenario it doesn't cover.
 */
async function loginAsUser(page: Page, email: string, password: string): Promise<void> {
  const form = new URLSearchParams();
  form.set('email', email);
  form.set('password', password);
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(response.ok(), `login should succeed for ${email}`).toBeTruthy();
  await page.goto('/backend', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/backend(?:\/.*)?$/, { timeout: 8_000 }).catch(() => undefined);
}
