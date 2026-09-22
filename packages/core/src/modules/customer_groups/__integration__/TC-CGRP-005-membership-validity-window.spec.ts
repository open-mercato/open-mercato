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
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-005: A membership outside its validity window is excluded.
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §13 —
 * "Membership outside its validity window is excluded at the boundary
 * instants."
 *
 * The exact-instant boundary check itself
 * (`isMembershipValidAt` in `services/customerGroupsService.ts`: `validUntil
 * === at` is still valid, inclusive) is unit-tested in Step 1.4
 * (`services/__tests__/customerGroupsService.test.ts`) against a caller-
 * controlled `at` — that precision is not reproducible over HTTP, where the
 * server computes its own `now` at request time and network latency makes a
 * "validUntil equals the server's now" assertion inherently racy.
 *
 * What IS safely provable at the HTTP level, non-racy, is the membership
 * list route's own `activeOnly` filter (`api/customer-groups/memberships/crud.ts`
 * — the same inclusive `$gte`/`$lte` shape against `validFrom`/`validUntil`):
 * a membership whose window has clearly not started yet, one whose window
 * has clearly already closed, and one currently inside its window.
 */
const MEMBERSHIPS_PATH = '/api/customer-groups/memberships';

test.describe('TC-CGRP-005: membership validity window exclusion', () => {
  test('activeOnly excludes not-yet-valid and expired memberships, includes the current one', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();

    let groupId: string | null = null;
    let futureMembershipId: string | null = null;
    let expiredMembershipId: string | null = null;
    let currentMembershipId: string | null = null;
    const futureCustomerId = randomUUID();
    const expiredCustomerId = randomUUID();
    const currentCustomerId = randomUUID();

    try {
      groupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-005-${stamp}`,
        name: `QA CGRP 005 Group ${stamp}`,
        priority: fixturePriority(stamp, 1),
      });

      const oneYearMs = 365 * 24 * 60 * 60 * 1000;
      const farFuture = new Date(Date.now() + oneYearMs).toISOString();
      const farPast = new Date(Date.now() - oneYearMs).toISOString();

      futureMembershipId = await createCustomerGroupMembershipFixture(request, adminToken, {
        groupId,
        customerId: futureCustomerId,
        validFrom: farFuture,
      });
      expiredMembershipId = await createCustomerGroupMembershipFixture(request, adminToken, {
        groupId,
        customerId: expiredCustomerId,
        validUntil: farPast,
      });
      currentMembershipId = await createCustomerGroupMembershipFixture(request, adminToken, {
        groupId,
        customerId: currentCustomerId,
        validFrom: farPast,
        validUntil: farFuture,
      });

      const activeResponse = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?groupId=${encodeURIComponent(groupId)}&activeOnly=true&pageSize=100`,
        { token: adminToken },
      );
      expect(activeResponse.status(), 'activeOnly list should be 200').toBe(200);
      const activeBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(activeResponse);
      const activeIds = new Set((activeBody?.items ?? []).map((item) => item.id));

      expect(activeIds.has(futureMembershipId), 'a not-yet-valid membership must be excluded').toBe(false);
      expect(activeIds.has(expiredMembershipId), 'an expired membership must be excluded').toBe(false);
      expect(activeIds.has(currentMembershipId), 'a membership currently inside its window must be included').toBe(
        true,
      );

      // Without the filter, all three are still visible — proves the exclusion
      // above is the `activeOnly` filter, not a missing/broken fixture.
      const allResponse = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?groupId=${encodeURIComponent(groupId)}&pageSize=100`,
        { token: adminToken },
      );
      const allBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(allResponse);
      const allIds = new Set((allBody?.items ?? []).map((item) => item.id));
      expect(allIds.has(futureMembershipId) && allIds.has(expiredMembershipId) && allIds.has(currentMembershipId), 'unfiltered list should include all three memberships').toBe(
        true,
      );
    } finally {
      await deleteCustomerGroupMembershipIfExists(request, adminToken, futureMembershipId);
      await deleteCustomerGroupMembershipIfExists(request, adminToken, expiredMembershipId);
      await deleteCustomerGroupMembershipIfExists(request, adminToken, currentMembershipId);
      await deleteCustomerGroupIfExists(request, adminToken, groupId);
    }
  });
});
