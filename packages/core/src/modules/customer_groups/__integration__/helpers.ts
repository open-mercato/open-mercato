import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * Shared fixtures for the `customer_groups` Phase 1 integration suite
 * (TC-CGRP-*). Provisions a genuine SECOND TENANT (not just a second
 * organization) because `CustomerGroup`/`CustomerGroupMembership` are
 * tenant-scoped, not organization-scoped (see the doc comments on
 * `CustomerGroup.organizationId` in `data/entities.ts`) — an org-B fixture
 * inside the same tenant would not exercise the actual isolation boundary
 * these routes rely on (`ctx.auth.tenantId`, `orgField: null`).
 *
 * Mirrors the local `createTenant`/`createOrganization`/`createUser` helpers
 * in `packages/core/src/modules/auth/__integration__/TC-AUTH-047-cross-tenant-email.spec.ts`
 * and the role/ACL provisioning in
 * `packages/core/src/modules/warranty_claims/__integration__/TC-WC-007-tenant-isolation.spec.ts`.
 */

export function uniqueStamp(): string {
  return `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * `CustomerGroup.priority` carries a unique index scoped to `(tenant_id,
 * priority)` (partial, excluding soft-deleted rows — see `data/entities.ts`).
 * All `admin@acme.com` fixtures across every TC-CGRP spec share the SAME
 * tenant, and Playwright can run spec files concurrently, so a fixed literal
 * priority (e.g. `500`) risks a cross-file collision. Derive a
 * near-unique value from the stamp plus a small per-fixture offset instead.
 */
export function fixturePriority(stamp: string, offset = 0): number {
  const numeric = Number(stamp.split('_')[0]) % 1_000_000;
  return 2_000_000 + numeric + offset;
}

export const CUSTOMER_GROUPS_FEATURES = [
  'customer_groups.groups.view',
  'customer_groups.groups.manage',
  'customer_groups.memberships.view',
  'customer_groups.memberships.manage',
];

export async function createTenantFixture(
  request: APIRequestContext,
  superadminToken: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token: superadminToken,
    data: { name },
  });
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  return expectId(
    (await readJsonSafe<{ id?: string }>(response))?.id,
    'tenant fixture should return an id',
  );
}

export async function deleteTenantIfExists(
  request: APIRequestContext,
  superadminToken: string | null,
  tenantId: string | null,
): Promise<void> {
  if (!superadminToken || !tenantId) return;
  await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${encodeURIComponent(tenantId)}`, {
    token: superadminToken,
  }).catch(() => undefined);
}

export type SecondTenantActor = {
  tenantId: string;
  organizationId: string;
  roleId: string;
  userId: string;
  token: string;
};

/**
 * Provisions a fresh tenant + organization + role (granted the full
 * customer_groups Phase 1 feature set) + user, then mints an auth token for
 * that user. The returned token is scoped to a tenant that is guaranteed to
 * be distinct from the default `admin@acme.com` tenant, so any record
 * visible to it that was created under the default tenant is a genuine
 * cross-tenant leak.
 */
export async function createSecondTenantActor(
  request: APIRequestContext,
  superadminToken: string,
  stamp: string,
  features: string[] = CUSTOMER_GROUPS_FEATURES,
): Promise<SecondTenantActor> {
  const tenantId = await createTenantFixture(request, superadminToken, `QA CGRP Tenant B ${stamp}`);
  const organizationId = await createOrganizationFixture(request, superadminToken, {
    name: `QA CGRP Org B ${stamp}`,
    tenantId,
  });
  const roleId = await createRoleFixture(request, superadminToken, {
    name: `QA CGRP Org B Role ${stamp}`,
    tenantId,
  });
  await setRoleAclFeatures(request, superadminToken, {
    roleId,
    features,
    organizations: [organizationId],
  });
  const email = `qa-cgrp-${stamp}@test.invalid`;
  const password = 'Valid1!Pass';
  const userId = await createUserFixture(request, superadminToken, {
    email,
    password,
    organizationId,
    roles: [roleId],
  });
  const token = await getAuthToken(request, email, password);
  return { tenantId, organizationId, roleId, userId, token };
}

export async function cleanupSecondTenantActor(
  request: APIRequestContext,
  superadminToken: string,
  actor: SecondTenantActor | null,
): Promise<void> {
  if (!actor) return;
  await deleteUserIfExists(request, superadminToken, actor.userId);
  await deleteRoleIfExists(request, superadminToken, actor.roleId);
  await deleteOrganizationIfExists(request, superadminToken, actor.organizationId);
  await deleteTenantIfExists(request, superadminToken, actor.tenantId);
}

const CUSTOMER_GROUPS_PATH = '/api/customer_groups/customer-groups';

/**
 * Creating or updating a group with `isDefault: true` clears every other
 * default group in the tenant (clear-and-set, see `api/customer-groups/crud.ts`).
 * Specs that create a default group in the shared admin tenant snapshot the
 * pre-existing default with this helper and hand it to `restoreDefaultGroup`
 * in `finally`, so the tenant's real default survives the run.
 */
export async function findDefaultGroupId(request: APIRequestContext, token: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `${CUSTOMER_GROUPS_PATH}?isDefault=true&pageSize=100`, { token });
  expect(response.status(), 'listing the tenant default group should be 200').toBe(200);
  const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(response);
  return (body?.items ?? []).find((item) => typeof item.id === 'string')?.id ?? null;
}

export async function restoreDefaultGroup(
  request: APIRequestContext,
  token: string | null,
  groupId: string | null,
): Promise<void> {
  if (!token || !groupId) return;
  await apiRequest(request, 'PUT', CUSTOMER_GROUPS_PATH, {
    token,
    data: { id: groupId, isDefault: true },
  }).catch(() => undefined);
}
