import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import {
  cleanupSecondTenantActor,
  createSecondTenantActor,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * TC-CGRP-031: `/api/customer_groups/customer-groups/credit-accounts` (Step 1.7) —
 * tenant isolation, organization isolation, ACL feature gating, the hold-reason
 * invariant, and optimistic locking.
 *
 * `CustomerCreditAccount` is organization-scoped (unlike `CustomerGroup`, which is
 * tenant-scoped only — see the doc comment on `CustomerGroup.organizationId` in
 * `data/entities.ts`), so this spec checks BOTH boundaries: a genuinely separate
 * tenant (via `createSecondTenantActor`, mirroring TC-CGRP-001) and a second
 * organization inside the SAME tenant (mirroring TC-CGRP-026's pattern).
 *
 * No `POST` route exists yet (account provisioning is operator-only and out of this
 * Step's scope, G13/D-R5-5), so the fixture row is inserted directly via `pg`
 * (`withClient`), the same "no create API yet" convention `dbFixtures.ts` already
 * documents for other fixtures.
 */
const CREDIT_ACCOUNTS_PATH = '/api/customer_groups/customer-groups/credit-accounts';

async function insertCreditAccountFixture(input: {
  tenantId: string;
  organizationId: string;
  customerId: string;
  currencyCode: string;
  creditLimit: string;
}): Promise<{ id: string; updatedAt: string }> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string; updated_at: string }>(
      `insert into customer_credit_accounts
         (id, tenant_id, organization_id, customer_id, currency_code, credit_limit, is_on_hold, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, false, now(), now())
       returning id, updated_at`,
      [input.tenantId, input.organizationId, input.customerId, input.currencyCode, input.creditLimit],
    );
    const row = result.rows[0];
    return { id: row.id, updatedAt: new Date(row.updated_at).toISOString() };
  });
}

async function deleteCreditAccountFixture(id: string | null): Promise<void> {
  if (!id) return;
  await withClient(async (client) => {
    await client.query('delete from customer_credit_ledger_entries where credit_account_id = $1', [id]);
    await client.query('delete from customer_credit_accounts where id = $1', [id]);
  }).catch(() => undefined);
}

test.describe('TC-CGRP-031: credit account isolation and guards', () => {
  test('tenant isolation, org isolation, feature gating, hold-reason invariant, and optimistic locking', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { tenantId, organizationId: orgA } = getTokenContext(adminToken);
    const stamp = uniqueStamp();
    const customerId = randomUUID();

    let accountId: string | null = null;
    let crossTenantActor: SecondTenantActor | null = null;
    let orgB: string | null = null;
    let viewOnlyRoleId: string | null = null;
    let viewOnlyUserId: string | null = null;
    let orgBRoleId: string | null = null;
    let orgBUserId: string | null = null;

    try {
      const fixture = await insertCreditAccountFixture({
        tenantId,
        organizationId: orgA,
        customerId,
        currencyCode: 'USD',
        creditLimit: '1000.00',
      });
      accountId = fixture.id;
      const t0 = fixture.updatedAt;

      // --- admin (orgA) can see the account and its computed exposure/available ---
      const adminListResponse = await apiRequest(
        request,
        'GET',
        `${CREDIT_ACCOUNTS_PATH}?customerId=${encodeURIComponent(customerId)}`,
        { token: adminToken },
      );
      expect(adminListResponse.status(), 'admin list should be 200').toBe(200);
      const adminListBody = await readJsonSafe<{
        items?: Array<{ id: string; credit_limit?: string; exposure?: string | null; available?: string | null }>;
      }>(adminListResponse);
      const adminItem = (adminListBody?.items ?? []).find((item) => item.id === accountId);
      expect(adminItem, 'admin list must include the fixture account').toBeTruthy();
      expect(adminItem?.credit_limit).toBe('1000.00');
      expect(adminItem?.exposure).toBe('0.00');
      expect(adminItem?.available).toBe('1000.00');

      // --- cross-TENANT isolation ---
      crossTenantActor = await createSecondTenantActor(request, superadminToken, stamp, [
        'customer_groups.credit.view',
        'customer_groups.credit.manage',
      ]);

      const crossTenantListResponse = await apiRequest(
        request,
        'GET',
        `${CREDIT_ACCOUNTS_PATH}?customerId=${encodeURIComponent(customerId)}`,
        { token: crossTenantActor.token },
      );
      expect(crossTenantListResponse.status(), 'cross-tenant list should be 200').toBe(200);
      const crossTenantListBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(crossTenantListResponse);
      expect(
        (crossTenantListBody?.items ?? []).some((item) => item.id === accountId),
        'cross-tenant list must not include the tenant-A account',
      ).toBe(false);

      const crossTenantUpdateResponse = await apiRequest(request, 'PUT', CREDIT_ACCOUNTS_PATH, {
        token: crossTenantActor.token,
        data: { id: accountId, creditLimit: 1 },
      });
      expect(crossTenantUpdateResponse.status(), 'cross-tenant update must 404').toBe(404);

      // --- cross-ORGANIZATION isolation (same tenant) ---
      orgB = await createOrganizationFixture(request, adminToken, {
        name: `QA CGRP 031 Org B ${stamp}`,
        tenantId,
      });
      orgBRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 031 Org B Role ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: orgBRoleId,
        features: ['customer_groups.credit.view', 'customer_groups.credit.manage'],
        organizations: [orgB],
      });
      const orgBEmail = `qa-cgrp-031-orgb-${stamp}@test.invalid`;
      orgBUserId = await createUserFixture(request, adminToken, {
        email: orgBEmail,
        password: 'Valid1!Pass',
        organizationId: orgB,
        roles: [orgBRoleId],
      });
      const orgBToken = await getAuthToken(request, orgBEmail, 'Valid1!Pass');

      const orgBListResponse = await apiRequest(
        request,
        'GET',
        `${CREDIT_ACCOUNTS_PATH}?customerId=${encodeURIComponent(customerId)}`,
        { token: orgBToken },
      );
      expect(orgBListResponse.status(), 'org-B list should be 200').toBe(200);
      const orgBListBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(orgBListResponse);
      expect(
        (orgBListBody?.items ?? []).some((item) => item.id === accountId),
        'org-B list must not include the org-A account',
      ).toBe(false);

      const orgBUpdateResponse = await apiRequest(request, 'PUT', CREDIT_ACCOUNTS_PATH, {
        token: orgBToken,
        data: { id: accountId, creditLimit: 1 },
      });
      expect(orgBUpdateResponse.status(), 'org-B update must 404').toBe(404);

      // --- feature gating: view-only cannot PUT ---
      viewOnlyRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 031 View Only ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: viewOnlyRoleId,
        features: ['customer_groups.credit.view'],
        organizations: [orgA],
      });
      const viewOnlyEmail = `qa-cgrp-031-viewonly-${stamp}@test.invalid`;
      viewOnlyUserId = await createUserFixture(request, adminToken, {
        email: viewOnlyEmail,
        password: 'Valid1!Pass',
        organizationId: orgA,
        roles: [viewOnlyRoleId],
      });
      const viewOnlyToken = await getAuthToken(request, viewOnlyEmail, 'Valid1!Pass');

      const viewOnlyUpdateResponse = await apiRequest(request, 'PUT', CREDIT_ACCOUNTS_PATH, {
        token: viewOnlyToken,
        data: { id: accountId, creditLimit: 1 },
      });
      expect(viewOnlyUpdateResponse.status(), 'view-only PUT must 403').toBe(403);

      // --- hold-reason invariant ---
      const missingReasonResponse = await apiRequest(request, 'PUT', CREDIT_ACCOUNTS_PATH, {
        token: adminToken,
        data: { id: accountId, isOnHold: true },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: t0 },
      });
      expect(missingReasonResponse.status(), 'turning on hold with no reason must 400').toBe(400);

      // --- successful update + optimistic lock ---
      const sessionAResponse = await apiRequest(request, 'PUT', CREDIT_ACCOUNTS_PATH, {
        token: adminToken,
        data: { id: accountId, isOnHold: true, holdReason: 'Payment overdue' },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: t0 },
      });
      expect(sessionAResponse.status(), 'session A (fresh t0) PUT should win').toBe(200);

      const sessionBResponse = await apiRequest(request, 'PUT', CREDIT_ACCOUNTS_PATH, {
        token: adminToken,
        data: { id: accountId, creditLimit: 42 },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: t0 },
      });
      expect(sessionBResponse.status(), 'session B (stale t0) PUT must 409').toBe(409);
      const sessionBBody = await readJsonSafe<{ code?: string }>(sessionBResponse);
      expect(sessionBBody?.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE);
    } finally {
      await deleteUserIfExists(request, adminToken, viewOnlyUserId);
      await deleteRoleIfExists(request, adminToken, viewOnlyRoleId);
      await deleteUserIfExists(request, adminToken, orgBUserId);
      await deleteRoleIfExists(request, adminToken, orgBRoleId);
      await deleteOrganizationIfExists(request, adminToken, orgB);
      await cleanupSecondTenantActor(request, superadminToken, crossTenantActor);
      await deleteCreditAccountFixture(accountId);
    }
  });
});
