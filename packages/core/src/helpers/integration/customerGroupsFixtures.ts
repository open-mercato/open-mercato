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
