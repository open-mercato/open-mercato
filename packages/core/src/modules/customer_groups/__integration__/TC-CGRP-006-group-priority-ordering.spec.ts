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
 * TC-CGRP-006: Group resolution with overlapping memberships returns
 * priority-ordered ids.
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §13.
 *
 * `resolveGroups()`'s own sort (`services/customerGroupsService.ts`:
 * `sortedGroups = groups.slice().sort((a, b) => b.priority - a.priority ...)`)
 * runs inside a DI-resolved service with no direct HTTP endpoint — it is
 * unit-tested in Step 1.4 (`services/__tests__/customerGroupsService.test.ts`)
 * and end-to-end proven for a real caller via the Phase 1 pricing gate
 * (TC-CGRP-007). What this spec proves at the HTTP level, non-racy and
 * without a DI harness, is the DATA `resolveGroups()` depends on: a customer
 * with overlapping active memberships in two groups of different priority,
 * and the `GET /api/customer_groups/customer-groups` list (`sortFieldMap.priority`) returning
 * those two groups in the same descending-priority order the resolver's sort
 * comparator would produce.
 */
const GROUPS_PATH = '/api/customer_groups/customer-groups';
const MEMBERSHIPS_PATH = '/api/customer_groups/customer-groups/memberships';

test.describe('TC-CGRP-006: overlapping memberships resolve priority-ordered groups', () => {
  test('a customer in two groups sees them retrievable in descending priority order', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const customerId = randomUUID();

    let highPriorityGroupId: string | null = null;
    let lowPriorityGroupId: string | null = null;
    let highMembershipId: string | null = null;
    let lowMembershipId: string | null = null;

    try {
      highPriorityGroupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-006-high-${stamp}`,
        name: `QA CGRP 006 High ${stamp}`,
        priority: fixturePriority(stamp, 2),
      });
      lowPriorityGroupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-006-low-${stamp}`,
        name: `QA CGRP 006 Low ${stamp}`,
        priority: fixturePriority(stamp, 1),
      });
      expect(fixturePriority(stamp, 2)).toBeGreaterThan(fixturePriority(stamp, 1));

      highMembershipId = await createCustomerGroupMembershipFixture(request, adminToken, {
        groupId: highPriorityGroupId,
        customerId,
      });
      lowMembershipId = await createCustomerGroupMembershipFixture(request, adminToken, {
        groupId: lowPriorityGroupId,
        customerId,
      });

      // The customer has an overlapping, currently-valid membership in both
      // groups — confirmed reachable via the memberships API before checking order.
      const membershipsResponse = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?customerId=${encodeURIComponent(customerId)}&activeOnly=true&pageSize=100`,
        { token: adminToken },
      );
      const membershipsBody = await readJsonSafe<{ items?: Array<{ group_id?: string; groupId?: string }> }>(
        membershipsResponse,
      );
      const resolvedGroupIds = new Set(
        (membershipsBody?.items ?? []).map((item) => item.groupId ?? item.group_id),
      );
      expect(resolvedGroupIds.has(highPriorityGroupId), 'customer should have an active membership in the high-priority group').toBe(true);
      expect(resolvedGroupIds.has(lowPriorityGroupId), 'customer should have an active membership in the low-priority group').toBe(true);

      // Priority-descending order (matches `resolveGroups()`'s own comparator):
      // the high-priority group must sort before the low-priority one.
      const sortedResponse = await apiRequest(
        request,
        'GET',
        `${GROUPS_PATH}?sortField=priority&sortDir=desc&pageSize=100`,
        { token: adminToken },
      );
      const sortedBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(sortedResponse);
      const orderedIds = (sortedBody?.items ?? []).map((item) => item.id);
      const highIndex = orderedIds.indexOf(highPriorityGroupId);
      const lowIndex = orderedIds.indexOf(lowPriorityGroupId);
      expect(highIndex, 'the high-priority group should be present in the sorted list').toBeGreaterThanOrEqual(0);
      expect(lowIndex, 'the low-priority group should be present in the sorted list').toBeGreaterThanOrEqual(0);
      expect(highIndex, 'the higher-priority group must sort before the lower-priority one').toBeLessThan(lowIndex);
    } finally {
      await deleteCustomerGroupMembershipIfExists(request, adminToken, highMembershipId);
      await deleteCustomerGroupMembershipIfExists(request, adminToken, lowMembershipId);
      await deleteCustomerGroupIfExists(request, adminToken, highPriorityGroupId);
      await deleteCustomerGroupIfExists(request, adminToken, lowPriorityGroupId);
    }
  });
});
