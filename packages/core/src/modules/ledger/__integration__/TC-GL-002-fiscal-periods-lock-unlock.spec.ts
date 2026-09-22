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
import { OPTIMISTIC_LOCK_HEADER_NAME, OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import { createFiscalPeriodFixture, getFiscalPeriod } from '@open-mercato/core/helpers/integration/ledgerFixtures';

/**
 * TC-GL-002: `POST /api/ledger/fiscal-periods/:id/lock` / `.../unlock` —
 * 200 (success), 409 (optimistic-lock conflict), 403 (missing
 * `ledger.periods.manage`) (OM-14).
 *
 * Scope per the OM-14 ticket and the spec's own Testing Strategy ("the
 * fiscal-periods lock/unlock routes return 200 / 409 (stale updated_at) / 403
 * (missing ledger.periods.manage) as specified in API Contracts") — see
 * `.ai/specs/2026-08-18-general-ledger-core-engine.md`.
 *
 * Each test creates its own fiscal period (`FiscalPeriod` ships no DELETE
 * route in Phase 1 — see the spec's Design decisions — so rows are left
 * behind, scoped to a throwaway organization that is deleted in `finally`)
 * inside a disposable tenant/organization, per `AGENTS.md`'s integration-test
 * isolation rule (self-contained fixtures, no reliance on seeded data).
 */

const randomSlug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  const body = (await response.json().catch(() => null)) as { id?: string } | null;
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

function staleIsoBefore(updatedAt: string): string {
  return new Date(Date.parse(updatedAt) - 60_000).toISOString();
}

test.describe('TC-GL-002: fiscal-periods lock/unlock 200/409/403', () => {
  test('lock then unlock succeed (200) and flip isLocked', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let periodId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-002a Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-002a Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      periodId = await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId, tenantId, startDate: '2032-01-01', endDate: '2032-01-31' },
        { headers },
      );

      const lockRes = await apiRequest(request, 'POST', `/api/ledger/fiscal-periods/${periodId}/lock`, {
        token: superadminToken,
        headers,
      });
      expect(lockRes.status(), 'lock with a fresh period should return 200').toBe(200);
      const lockBody = (await lockRes.json()) as { id: string; isLocked: boolean; updatedAt: string };
      expect(lockBody.isLocked).toBe(true);

      const unlockRes = await apiRequest(request, 'POST', `/api/ledger/fiscal-periods/${periodId}/unlock`, {
        token: superadminToken,
        headers,
      });
      expect(unlockRes.status(), 'unlock right after a successful lock should return 200').toBe(200);
      const unlockBody = (await unlockRes.json()) as { id: string; isLocked: boolean; updatedAt: string };
      expect(unlockBody.isLocked).toBe(false);
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
    }
  });

  test('lock returns 409 with a stale optimistic-lock header', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let periodId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-002b Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-002b Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      periodId = await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId, tenantId, startDate: '2032-02-01', endDate: '2032-02-28' },
        { headers },
      );
      const current = await getFiscalPeriod(request, superadminToken, periodId, { headers });
      const staleIso = staleIsoBefore(current.updatedAt as string);

      const res = await apiRequest(request, 'POST', `/api/ledger/fiscal-periods/${periodId}/lock`, {
        token: superadminToken,
        headers: { ...headers, [OPTIMISTIC_LOCK_HEADER_NAME]: staleIso },
      });
      expect(res.status(), 'lock with a stale expected-updated-at header should return 409').toBe(409);
      const body = (await res.json()) as { code?: string; currentUpdatedAt?: string; expectedUpdatedAt?: string };
      expect(body.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE);
      expect(body.expectedUpdatedAt).toBe(staleIso);

      // The rejected lock must not have taken effect.
      const after = await getFiscalPeriod(request, superadminToken, periodId, { headers });
      expect(after.isLocked, 'a 409 conflict must not lock the period').toBe(false);
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
    }
  });

  test('unlock returns 409 with a stale optimistic-lock header', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let periodId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-002c Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-002c Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      periodId = await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId, tenantId, startDate: '2032-03-01', endDate: '2032-03-31' },
        { headers },
      );

      const lockRes = await apiRequest(request, 'POST', `/api/ledger/fiscal-periods/${periodId}/lock`, {
        token: superadminToken,
        headers,
      });
      expect(lockRes.status(), 'setup lock should succeed').toBe(200);
      const lockedUpdatedAt = ((await lockRes.json()) as { updatedAt: string }).updatedAt;
      const staleIso = staleIsoBefore(lockedUpdatedAt);

      const res = await apiRequest(request, 'POST', `/api/ledger/fiscal-periods/${periodId}/unlock`, {
        token: superadminToken,
        headers: { ...headers, [OPTIMISTIC_LOCK_HEADER_NAME]: staleIso },
      });
      expect(res.status(), 'unlock with a stale expected-updated-at header should return 409').toBe(409);
      const body = (await res.json()) as { code?: string; expectedUpdatedAt?: string };
      expect(body.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE);

      const after = await getFiscalPeriod(request, superadminToken, periodId, { headers });
      expect(after.isLocked, 'a 409 conflict must not unlock the period').toBe(true);
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
    }
  });

  test('lock and unlock return 403 without ledger.periods.manage', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let periodId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-002d Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-002d Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      periodId = await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId, tenantId, startDate: '2032-04-01', endDate: '2032-04-30' },
        { headers },
      );

      // A role scoped to this same organization/tenant, with zero features —
      // its user's own token is naturally scoped here, no cookie needed.
      roleId = await createRoleFixture(request, superadminToken, { name: randomSlug('QA-GL-002d-role'), tenantId });
      await setRoleAclFeatures(request, superadminToken, { roleId, features: [] });
      const email = `qa-gl-002d-${randomUUID().slice(0, 8)}@acme.com`;
      userId = await createUserFixture(request, superadminToken, {
        email,
        password: 'Valid1!Pass',
        organizationId,
        roles: [roleId],
      });
      const restrictedToken = await getAuthToken(request, email, 'Valid1!Pass');

      const lockRes = await apiRequest(request, 'POST', `/api/ledger/fiscal-periods/${periodId}/lock`, {
        token: restrictedToken,
      });
      expect(lockRes.status(), 'lock without ledger.periods.manage should return 403').toBe(403);

      const unlockRes = await apiRequest(request, 'POST', `/api/ledger/fiscal-periods/${periodId}/unlock`, {
        token: restrictedToken,
      });
      expect(unlockRes.status(), 'unlock without ledger.periods.manage should return 403').toBe(403);

      // Neither refused call should have taken effect.
      const after = await getFiscalPeriod(request, superadminToken, periodId, { headers });
      expect(after.isLocked, 'a 403 must not change isLocked').toBe(false);
    } finally {
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
    }
  });
});
