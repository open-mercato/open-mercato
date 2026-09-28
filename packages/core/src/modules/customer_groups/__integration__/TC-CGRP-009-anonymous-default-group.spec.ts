import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-009: Anonymous (`customerId: null`) resolves to the default group
 * without error.
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §13, §6.2.
 *
 * `resolveGroups()`'s anonymous branch
 * (`services/customerGroupsService.ts`: `if (input.customerId == null) { ...
 * find the tenant's isDefault group ... }`) is a DI-service code path with no
 * Phase 1 HTTP endpoint that accepts a literal `customerId: null` — the
 * memberships list route's `customerId` query param is either a concrete uuid
 * or omitted entirely (which lists ALL memberships, not "anonymous"), so this
 * exact branch cannot be driven through the wire the way TC-CGRP-007 drives
 * the member/non-member branch. It is unit-tested directly in Step 1.4
 * (`services/__tests__/customerGroupsService.test.ts`).
 *
 * What this spec proves at the HTTP level: the `isDefault` flag this branch
 * depends on round-trips correctly through the real CRUD surface, and that no
 * Phase 1 endpoint errors while a tenant has an active default group —
 * i.e. the data and surface `resolveGroups()`'s anonymous path relies on are
 * sound end-to-end, even though the branch itself is exercised at the unit
 * level.
 */
const GROUPS_PATH = '/api/customer_groups/customer-groups';
const RECONCILE_PATH = '/api/customer_groups/customer-groups/reconcile';

test.describe('TC-CGRP-009: anonymous/default-group surface has no HTTP-level errors', () => {
  test('a default group round-trips through the CRUD API and no Phase 1 endpoint errors while it exists', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();

    let groupId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-009-${stamp}`,
        name: `QA CGRP 009 Default Group ${stamp}`,
        kind: 'b2c',
        priority: fixturePriority(stamp, 1),
        isDefault: true,
        isActive: true,
      });

      const readResponse = await apiRequest(request, 'GET', `${GROUPS_PATH}?id=${encodeURIComponent(groupId)}`, {
        token,
      });
      expect(readResponse.status(), 'reading the default group back should be 200').toBe(200);
      const readBody = await readJsonSafe<{ items?: Array<{ id: string; is_default: boolean; is_active: boolean }> }>(
        readResponse,
      );
      const created = (readBody?.items ?? [])[0];
      expect(created?.is_default, 'the fixture group should persist isDefault=true').toBe(true);
      expect(created?.is_active, 'the fixture group should persist isActive=true').toBe(true);

      const isDefaultFilterResponse = await apiRequest(
        request,
        'GET',
        `${GROUPS_PATH}?isDefault=true&pageSize=100`,
        { token },
      );
      expect(isDefaultFilterResponse.status(), 'filtering by isDefault=true should be 200').toBe(200);
      const isDefaultFilterBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(isDefaultFilterResponse);
      expect(
        (isDefaultFilterBody?.items ?? []).some((item) => item.id === groupId),
        'the default group should appear in the isDefault=true filtered list',
      ).toBe(true);

      // No Phase 1 endpoint errors while a default group exists for the tenant.
      const reconcileResponse = await apiRequest(request, 'GET', RECONCILE_PATH, { token });
      expect(reconcileResponse.status(), 'reconcile scan should not error while a default group exists').toBe(200);

      const listResponse = await apiRequest(request, 'GET', `${GROUPS_PATH}?pageSize=100`, { token });
      expect(listResponse.status(), 'the plain groups list should not error while a default group exists').toBe(200);
    } finally {
      await deleteCustomerGroupIfExists(request, token, groupId);
    }
  });
});
