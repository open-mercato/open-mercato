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
import { createAccountTypeFixture, createAccountFixture } from '@open-mercato/core/helpers/integration/ledgerFixtures';
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-GL-004: `POST /api/ledger/accounts/import-default-chart-of-accounts` —
 * 200 (happy path), 409 (non-empty chart of accounts), 403 (missing
 * `ledger.accounts.manage`) — plus the button's UI path (hidden for
 * view-only, table refresh on success).
 *
 * Added retroactively per PR #6137 review, M2 — the original spec/
 * implementation shipped with command-level unit tests only, no
 * integration coverage for this new API path or the backend-page button
 * (`.ai/specs/2026-09-15-default-chart-of-accounts.md`, Testing Strategy
 * > Integration Coverage).
 *
 * Each test creates its own throwaway tenant/organization (per `AGENTS.md`'s
 * integration-test isolation rule — self-contained fixtures, no reliance on
 * seeded/demo data) and cleans up in `finally`. A fresh organization already
 * has its PL `LedgerAccountGroup` rows (zespoły 0-8) seeded by GL core
 * engine's own `onTenantCreated` subscriber (#5663) — this command only
 * ever reads those, never creates them, so no extra setup is needed before
 * calling it.
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

const IMPORT_PATH = '/api/ledger/accounts/import-default-chart-of-accounts';

test.describe('TC-GL-004: import-default-chart-of-accounts 200/409/403 + button UI path', () => {
  test('happy path: 200 with the full template row counts', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-004a Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-004a Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      const res = await apiRequest(request, 'POST', IMPORT_PATH, { token: superadminToken, headers });
      expect(res.status(), 'import against a fresh, empty organization should return 200').toBe(200);
      const body = (await res.json()) as { ok: boolean; createdAccountTypeCount: number; createdAccountCount: number };
      expect(body).toMatchObject({ ok: true, createdAccountTypeCount: 40, createdAccountCount: 44 });
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
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-004b Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-004b Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      const accountTypeId = await createAccountTypeFixture(
        request,
        superadminToken,
        {
          organizationId,
          tenantId,
          slug: randomSlug('qa-gl-004b-type'),
          name: 'QA pre-existing type',
          normalBalance: 'DEBIT',
        },
        { headers },
      );
      await createAccountFixture(
        request,
        superadminToken,
        { organizationId, tenantId, slug: randomSlug('qa-gl-004b-account'), accountTypeId },
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

  test('403 without ledger.accounts.manage', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-004c Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-004c Organization ${stamp}`,
        tenantId,
      });

      // A role scoped to this organization/tenant with only the view
      // feature — matching Backend Pages' own "hidden entirely for a
      // viewer who only has ledger.accounts.view" claim, checked here at
      // the API layer the button itself calls into.
      roleId = await createRoleFixture(request, superadminToken, { name: randomSlug('QA-GL-004c-role'), tenantId });
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
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-004d Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-004d Organization ${stamp}`,
        tenantId,
      });

      const viewOnlyEmail = `qa-gl-004d-view-${randomUUID().slice(0, 8)}@acme.com`;
      const viewOnlyPassword = 'Valid1!Pass';
      viewOnlyRoleId = await createRoleFixture(request, superadminToken, { name: randomSlug('QA-GL-004d-view'), tenantId });
      await setRoleAclFeatures(request, superadminToken, { roleId: viewOnlyRoleId, features: ['ledger.accounts.view'] });
      viewOnlyUserId = await createUserFixture(request, superadminToken, {
        email: viewOnlyEmail,
        password: viewOnlyPassword,
        organizationId,
        roles: [viewOnlyRoleId],
      });

      const managerEmail = `qa-gl-004d-manage-${randomUUID().slice(0, 8)}@acme.com`;
      const managerPassword = 'Valid1!Pass';
      managerRoleId = await createRoleFixture(request, superadminToken, { name: randomSlug('QA-GL-004d-manage'), tenantId });
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
      await page.goto('/backend/accounts', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /chart of accounts/i })).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole('button', { name: /import default chart of accounts/i }),
      ).toHaveCount(0);

      // Manager: the button is present; confirming it imports the template
      // and the table refreshes to show the imported rows.
      await loginAsUser(page, managerEmail, managerPassword);
      await page.goto('/backend/accounts', { waitUntil: 'domcontentloaded' });
      const importButton = page.getByRole('button', { name: /import default chart of accounts/i });
      await expect(importButton).toBeVisible({ timeout: 10_000 });
      await importButton.click();

      const dialog = page.getByRole('dialog', { name: /import the default chart of accounts/i });
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByRole('button', { name: /^confirm$/i }).click();

      // The success flash names the row counts; the table then shows an
      // imported row's slug (e.g. "100-1" — Zespół 1, first template row).
      await expect(page.getByText(/imported 40 account types and 44 accounts/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('100-1', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
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
