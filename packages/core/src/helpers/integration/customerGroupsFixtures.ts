import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';

const GROUPS_PATH = '/api/customer-groups';
const MEMBERSHIPS_PATH = '/api/customer-groups/memberships';

export type CustomerGroupFixtureInput = {
  code: string;
  name: string;
  kind?: 'b2c' | 'b2b' | 'internal' | 'partner';
  priority?: number;
  isDefault?: boolean;
  isActive?: boolean;
  parentId?: string;
};

export async function createCustomerGroupFixture(
  request: APIRequestContext,
  token: string,
  input: CustomerGroupFixtureInput,
): Promise<string> {
  const response = await apiRequest(request, 'POST', GROUPS_PATH, {
    token,
    data: {
      code: input.code,
      name: input.name,
      kind: input.kind ?? 'b2c',
      priority: input.priority ?? 100,
      isDefault: input.isDefault ?? false,
      isActive: input.isActive ?? true,
      ...(input.parentId ? { parentId: input.parentId } : {}),
    },
  });
  expect(response.status(), `create customer group fixture failed: ${response.status()}`).toBe(201);
  return expectId(
    (await readJsonSafe<{ id?: string }>(response))?.id,
    'customer group fixture should return an id',
  );
}

export async function deleteCustomerGroupIfExists(
  request: APIRequestContext,
  token: string | null,
  groupId: string | null,
): Promise<void> {
  if (!token || !groupId) return;
  await apiRequest(request, 'DELETE', `${GROUPS_PATH}?id=${encodeURIComponent(groupId)}`, { token }).catch(
    () => undefined,
  );
}

export type CustomerGroupMembershipFixtureInput = {
  groupId: string;
  customerId: string;
  source?: 'manual' | 'import' | 'rule' | 'onboarding';
  validFrom?: string;
  validUntil?: string;
};

export async function createCustomerGroupMembershipFixture(
  request: APIRequestContext,
  token: string,
  input: CustomerGroupMembershipFixtureInput,
): Promise<string> {
  const response = await apiRequest(request, 'POST', MEMBERSHIPS_PATH, {
    token,
    data: {
      groupId: input.groupId,
      customerId: input.customerId,
      source: input.source ?? 'manual',
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
      ...(input.validUntil ? { validUntil: input.validUntil } : {}),
    },
  });
  expect(response.status(), `create customer group membership fixture failed: ${response.status()}`).toBe(201);
  return expectId(
    (await readJsonSafe<{ id?: string }>(response))?.id,
    'customer group membership fixture should return an id',
  );
}

export async function deleteCustomerGroupMembershipIfExists(
  request: APIRequestContext,
  token: string | null,
  membershipId: string | null,
): Promise<void> {
  if (!token || !membershipId) return;
  await apiRequest(request, 'DELETE', `${MEMBERSHIPS_PATH}?id=${encodeURIComponent(membershipId)}`, {
    token,
  }).catch(() => undefined);
}

export type CustomerGroupTermsFixtureInput = {
  groupId: string;
  priceKindId?: string | null;
  paymentTermsDays?: number | null;
  allowPurchaseOnAccount?: boolean;
  defaultCreditLimit?: number | null;
  creditCurrencyCode?: string | null;
  approvalRequiredAbove?: number | null;
  minOrderValue?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type CustomerGroupTermsFixtureResult = {
  id: string;
  updatedAt: string;
};

/**
 * Upserts (`PUT /api/customer-groups/:id/terms`) the target group's commercial
 * terms row. Mirrors `createCustomerGroupFixture`'s shape but returns
 * `{ id, updatedAt }` instead of a bare id — callers exercising optimistic
 * locking need the row's `updatedAt` immediately after create/update without
 * an extra GET round-trip.
 */
export async function createCustomerGroupTermsFixture(
  request: APIRequestContext,
  token: string,
  input: CustomerGroupTermsFixtureInput,
  headers: Record<string, string> = {},
): Promise<CustomerGroupTermsFixtureResult> {
  const { groupId, ...fields } = input;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data[key] = value;
  }
  const response = await apiRequest(request, 'PUT', `${GROUPS_PATH}/${groupId}/terms`, {
    token,
    data,
    headers,
  });
  expect(response.status(), `create/update customer group terms fixture failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ terms?: { id?: string; updatedAt?: string } }>(response);
  return {
    id: expectId(body?.terms?.id, 'customer group terms fixture should return an id'),
    updatedAt: expectId(body?.terms?.updatedAt, 'customer group terms fixture should return updatedAt'),
  };
}

/**
 * `CustomerGroupTerms` has no standalone DELETE endpoint — `GET/PUT
 * /api/customer-groups/:id/terms` only (see the doc comment on that route:
 * terms are a strict 1:1 sub-resource of a group with no independent
 * list/create/delete semantics). Deleting the PARENT group via
 * `deleteCustomerGroupIfExists` is what actually reclaims a terms row in
 * tests. This no-op exists only for naming symmetry with the other
 * `delete*IfExists` helpers so a spec's `finally` block reads consistently.
 */
export async function deleteCustomerGroupTermsIfExists(
  _request: APIRequestContext,
  _token: string | null,
  _groupId: string | null,
): Promise<void> {
  return undefined;
}
