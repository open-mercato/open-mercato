import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  createCustomerGroupMembershipFixture,
  deleteCustomerGroupIfExists,
  deleteCustomerGroupMembershipIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import {
  cleanupSecondTenantActor,
  createSecondTenantActor,
  fixturePriority,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * TC-CGRP-002: `/api/customer-groups/memberships` tenant isolation.
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §13.
 *
 * `CustomerGroupMembership` is tenant-scoped only (mirrors `CustomerGroup`,
 * see `data/entities.ts`), so this exercises a genuinely separate tenant via
 * `createSecondTenantActor`, not a second organization.
 *
 * Covers GET (list + `?id=`), POST, PUT, DELETE from the single shared
 * `makeCrudRoute` instance in `api/customer-groups/memberships/crud.ts`.
 * `customerId` is a plain uuid column with no FK/ORM relation into the
 * `customers` module (per root AGENTS.md § Never — cross-module ORM
 * relationships), so a random uuid is a valid fixture value.
 */
const GROUPS_PATH = '/api/customer-groups';
const MEMBERSHIPS_PATH = '/api/customer-groups/memberships';

test.describe('TC-CGRP-002: customer group memberships tenant isolation', () => {
  test('a membership created in tenant A is invisible and unreachable from tenant B', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    const customerId = randomUUID();

    let groupId: string | null = null;
    let membershipId: string | null = null;
    let actor: SecondTenantActor | null = null;

    try {
      groupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-002-${stamp}`,
        name: `QA CGRP 002 Group ${stamp}`,
        priority: fixturePriority(stamp, 1),
      });
      membershipId = await createCustomerGroupMembershipFixture(request, adminToken, {
        groupId,
        customerId,
      });

      actor = await createSecondTenantActor(request, superadminToken, stamp);

      // GET list: tenant B must not see the tenant-A membership.
      const listResponse = await apiRequest(request, 'GET', `${MEMBERSHIPS_PATH}?pageSize=100`, {
        token: actor.token,
      });
      expect(listResponse.status(), 'tenant B list should be 200').toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(listResponse);
      expect(
        (listBody?.items ?? []).some((item) => item.id === membershipId),
        'tenant B list must not include the tenant-A membership',
      ).toBe(false);

      // GET by customerId filter: tenant B must see zero memberships for the shared customerId value.
      const byCustomerResponse = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?customerId=${encodeURIComponent(customerId)}`,
        { token: actor.token },
      );
      expect(byCustomerResponse.status(), 'tenant B customerId lookup should be 200').toBe(200);
      const byCustomerBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(byCustomerResponse);
      expect(
        byCustomerBody?.items ?? [],
        'tenant B must not resolve any membership for a customerId that only has a tenant-A membership',
      ).toHaveLength(0);

      // GET by id: tenant B must get zero rows.
      const byIdResponse = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?id=${encodeURIComponent(membershipId)}`,
        { token: actor.token },
      );
      expect(byIdResponse.status(), 'tenant B id lookup should be 200').toBe(200);
      const byIdBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(byIdResponse);
      expect(byIdBody?.items ?? [], 'tenant B id lookup must return zero rows for a tenant-A membership').toHaveLength(0);

      // PUT: tenant B must not be able to update the tenant-A membership by id.
      const updateResponse = await apiRequest(request, 'PUT', MEMBERSHIPS_PATH, {
        token: actor.token,
        data: { id: membershipId, notes: 'cross-tenant edit attempt' },
      });
      expect(updateResponse.status(), 'tenant B update of a tenant-A membership must 404').toBe(404);

      // DELETE: tenant B must not be able to delete the tenant-A membership by id.
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${MEMBERSHIPS_PATH}?id=${encodeURIComponent(membershipId)}`,
        { token: actor.token },
      );
      expect(deleteResponse.status(), 'tenant B delete of a tenant-A membership must 404').toBe(404);

      // The tenant-A membership survives untouched under tenant A's own token.
      const survivorResponse = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?id=${encodeURIComponent(membershipId)}`,
        { token: adminToken },
      );
      const survivorBody = await readJsonSafe<{ items?: Array<{ id: string; notes: string | null }> }>(
        survivorResponse,
      );
      expect(
        (survivorBody?.items ?? [])[0]?.notes,
        'tenant-A membership must be unaffected by tenant-B attempts',
      ).toBeFalsy();
    } finally {
      await deleteCustomerGroupMembershipIfExists(request, adminToken, membershipId);
      await deleteCustomerGroupIfExists(request, adminToken, groupId);
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
