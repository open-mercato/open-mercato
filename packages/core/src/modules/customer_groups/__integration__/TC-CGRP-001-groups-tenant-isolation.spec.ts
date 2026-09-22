import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import {
  cleanupSecondTenantActor,
  createSecondTenantActor,
  fixturePriority,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * TC-CGRP-001: `/api/customer-groups` tenant isolation.
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §13 — "every
 * route in §9, each asserting tenant isolation with a second-tenant fixture".
 *
 * `CustomerGroup` is tenant-scoped, not organization-scoped (see the doc
 * comment on `CustomerGroup.organizationId` in `data/entities.ts`), so this
 * spec provisions a genuinely separate TENANT (via `createSecondTenantActor`)
 * rather than a second organization in the same tenant.
 *
 * Covers GET (list + `?id=`), POST, PUT, DELETE all from the single shared
 * `makeCrudRoute` instance in `api/customer-groups/crud.ts`.
 */
const GROUPS_PATH = '/api/customer-groups';

test.describe('TC-CGRP-001: customer groups tenant isolation', () => {
  test('a group created in tenant A is invisible and unreachable from tenant B', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();

    let groupId: string | null = null;
    let actor: SecondTenantActor | null = null;

    try {
      groupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-001-${stamp}`,
        name: `QA CGRP 001 Group ${stamp}`,
        priority: fixturePriority(stamp, 1),
      });

      actor = await createSecondTenantActor(request, superadminToken, stamp);

      // GET list: tenant B must not see tenant A's group at all.
      const listResponse = await apiRequest(request, 'GET', `${GROUPS_PATH}?pageSize=100`, {
        token: actor.token,
      });
      expect(listResponse.status(), 'tenant B list should be 200').toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(listResponse);
      expect(
        (listBody?.items ?? []).some((item) => item.id === groupId),
        'tenant B list must not include the tenant-A group',
      ).toBe(false);

      // GET by id: tenant B must get zero rows, not the tenant-A record.
      const byIdResponse = await apiRequest(
        request,
        'GET',
        `${GROUPS_PATH}?id=${encodeURIComponent(groupId)}`,
        { token: actor.token },
      );
      expect(byIdResponse.status(), 'tenant B id lookup should be 200').toBe(200);
      const byIdBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(byIdResponse);
      expect(byIdBody?.items ?? [], 'tenant B id lookup must return zero rows for a tenant-A group').toHaveLength(0);

      // PUT: tenant B must not be able to update the tenant-A group by id.
      const updateResponse = await apiRequest(request, 'PUT', GROUPS_PATH, {
        token: actor.token,
        data: { id: groupId, name: 'cross-tenant rename attempt' },
      });
      expect(updateResponse.status(), 'tenant B update of a tenant-A group must 404').toBe(404);

      // DELETE: tenant B must not be able to delete the tenant-A group by id.
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${GROUPS_PATH}?id=${encodeURIComponent(groupId)}`,
        { token: actor.token },
      );
      expect(deleteResponse.status(), 'tenant B delete of a tenant-A group must 404').toBe(404);

      // The tenant-A group survives untouched under tenant A's own token.
      const survivorResponse = await apiRequest(
        request,
        'GET',
        `${GROUPS_PATH}?id=${encodeURIComponent(groupId)}`,
        { token: adminToken },
      );
      const survivorBody = await readJsonSafe<{ items?: Array<{ id: string; name: string }> }>(survivorResponse);
      expect((survivorBody?.items ?? [])[0]?.name, 'tenant-A group must be unaffected by tenant-B attempts').toBe(
        `QA CGRP 001 Group ${stamp}`,
      );

      // POST: a group created BY tenant B never resolves for tenant A either.
      const tenantBCreate = await apiRequest(request, 'POST', GROUPS_PATH, {
        token: actor.token,
        data: {
          code: `qa-cgrp-001-b-${stamp}`,
          name: `QA CGRP 001 Tenant B Group ${stamp}`,
          kind: 'b2c',
          priority: fixturePriority(stamp, 2),
        },
      });
      expect(tenantBCreate.status(), 'tenant B create should succeed').toBe(201);
      const tenantBGroupId = (await readJsonSafe<{ id?: string }>(tenantBCreate))?.id ?? null;
      try {
        const crossLookup = await apiRequest(
          request,
          'GET',
          `${GROUPS_PATH}?id=${encodeURIComponent(tenantBGroupId!)}`,
          { token: adminToken },
        );
        const crossBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(crossLookup);
        expect(crossBody?.items ?? [], 'tenant A must not see a group created by tenant B').toHaveLength(0);
      } finally {
        await deleteCustomerGroupIfExists(request, actor.token, tenantBGroupId);
      }
    } finally {
      await deleteCustomerGroupIfExists(request, adminToken, groupId);
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
