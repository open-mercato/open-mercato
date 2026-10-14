import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * Shared fixtures for the `promotions` Phase 1 integration suite (TC-PROM-*,
 * Step 1.9 of `.ai/specs/SPEC-055-2026-02-23-promotions-module.md`).
 *
 * Mirrors the house style in `customer_groups/__integration__/helpers.ts`:
 * self-contained fixtures created per test, cleaned up in `finally`, no
 * reliance on seeded/demo data.
 */

export function uniqueStamp(): string {
  return `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export const PROMOTIONS_PATH = '/api/promotions';

export function promotionDetailPath(id: string): string {
  return `${PROMOTIONS_PATH}/${id}`;
}

export function promotionTreePath(id: string): string {
  return `${PROMOTIONS_PATH}/${id}/tree`;
}

export const PROMOTIONS_ORDER_PATH = `${PROMOTIONS_PATH}/order`;

export const PROMOTIONS_FEATURES = [
  'promotions.view',
  'promotions.create',
  'promotions.update',
  'promotions.delete',
];

export type PromotionFixture = {
  id: string;
  updatedAt: string;
  order: number;
  rootGroupId: string;
};

export type RuleGroupNode = {
  id: string;
  operator: string;
  sortOrder: number;
  rules: Array<{ id: string; ruleType: string; config: Record<string, unknown>; sortOrder: number }>;
  benefits: Array<{
    id: string;
    benefitType: string;
    appliesTo: string;
    config: Record<string, unknown>;
    sortOrder: number;
  }>;
  // A child group is always a real, persisted node — never null; only the
  // top-level `PromotionDetail.ruleGroupTree` can be null (no root group).
  children: RuleGroupNode[];
};

export type PromotionDetail = {
  id: string;
  name: string;
  order: number;
  active: boolean;
  eligibleCurrencies: string[];
  updatedAt: string;
  ruleGroupTree: RuleGroupNode | null;
};

/** Creates a promotion via `POST /api/promotions`, then fetches its detail to
 * capture `updatedAt` and the auto-created root rule group id. */
export async function createPromotionFixture(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<PromotionFixture> {
  const stamp = uniqueStamp();
  const body = {
    name: `QA Promotion ${stamp}`,
    order: 0,
    active: false,
    ...overrides,
  };
  const createResponse = await apiRequest(request, 'POST', PROMOTIONS_PATH, { token, data: body });
  expect(createResponse.status(), 'POST /api/promotions should return 201').toBe(201);
  const createBody = await readJsonSafe<{ id?: string }>(createResponse);
  const id = expectId(createBody?.id, 'Promotion creation response should include id');

  const detail = await getPromotionDetail(request, token, id);
  const rootGroupId = detail.ruleGroupTree?.id ?? null;
  expect(typeof rootGroupId === 'string' && rootGroupId.length > 0, 'promotion must have an auto-created root rule group').toBe(
    true,
  );

  return { id, updatedAt: detail.updatedAt, order: detail.order, rootGroupId: rootGroupId as string };
}

export async function getPromotionDetail(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<PromotionDetail> {
  const response = await apiRequest(request, 'GET', promotionDetailPath(id), { token });
  expect(response.status(), `GET ${promotionDetailPath(id)} should return 200`).toBe(200);
  const body = await readJsonSafe<PromotionDetail>(response);
  if (!body) throw new Error('[internal] promotion detail response body was empty');
  return body;
}

export async function deletePromotionIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return;
  await apiRequest(request, 'DELETE', `${PROMOTIONS_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined);
}

export type SecondTenantActor = {
  tenantId: string;
  organizationId: string;
  roleId: string;
  userId: string;
  token: string;
};

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
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'tenant fixture should return an id');
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

/**
 * Provisions a fresh tenant + organization + role (granted the full
 * promotions Phase 1 feature set) + user, then mints an auth token for that
 * user — mirrors `customer_groups/__integration__/helpers.ts`'s
 * `createSecondTenantActor`. `Promotion` is tenant- AND organization-scoped
 * (`orm.orgField`/`orm.tenantField` on the CRUD route), so a genuinely
 * separate tenant exercises the real isolation boundary.
 */
export async function createSecondTenantActor(
  request: APIRequestContext,
  superadminToken: string,
  stamp: string,
  features: string[] = PROMOTIONS_FEATURES,
): Promise<SecondTenantActor> {
  const tenantId = await createTenantFixture(request, superadminToken, `QA PROM Tenant B ${stamp}`);
  const organizationId = await createOrganizationFixture(request, superadminToken, {
    name: `QA PROM Org B ${stamp}`,
    tenantId,
  });
  const roleId = await createRoleFixture(request, superadminToken, {
    name: `QA PROM Org B Role ${stamp}`,
    tenantId,
  });
  await setRoleAclFeatures(request, superadminToken, {
    roleId,
    features,
    organizations: [organizationId],
  });
  const email = `qa-prom-${stamp}@test.invalid`;
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
