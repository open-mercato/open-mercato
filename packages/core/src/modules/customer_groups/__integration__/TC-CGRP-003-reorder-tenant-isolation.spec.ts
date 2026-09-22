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
 * TC-CGRP-003: `POST /api/customer_groups/customer-groups/reorder` tenant isolation.
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §13.
 *
 * `commands/reorderGroups.ts` scopes its `em.find` by `{ id: { $in: parsed.ids },
 * tenantId: parsed.tenantId }` — where `parsed.tenantId` always comes from the
 * caller's own auth context (`route.ts` calls
 * `customerGroupReorderSchema.parse({ ...body, tenantId })` with `tenantId =
 * auth.tenantId`, overriding any client-supplied value), and silently skips any
 * id that does not resolve in that scope ("An id that no longer resolves to a
 * group in this tenant... is silently skipped"). So a tenant-B caller sending a
 * tenant-A group id must get a 200 `{ ok: true }` (not an error — the route
 * itself has no per-id existence check) while leaving the tenant-A group's
 * `priority` completely unchanged — and, because the match set is empty, the
 * command never issues a write, so this assertion is safe under concurrent
 * Playwright workers (no risk of colliding with another worker's own
 * `(tenant_id, priority)` unique-index write in the shared default tenant).
 *
 * The "reorder rewrites priorities in gaps of 10" success-path behavior is
 * already covered at the unit level by
 * `commands/__tests__/reorderGroups.test.ts`; it is deliberately NOT
 * re-asserted here at the HTTP level, because every `admin@acme.com` fixture
 * across this suite shares one real tenant, and the command always rewrites
 * the reordered ids to the SAME deterministic priority values (10, 20, ...) —
 * two Playwright workers calling this route concurrently in that shared
 * tenant would race on the `(tenant_id, priority)` unique index and could
 * legitimately 409 one another (a real product behavior, not a bug), making a
 * fixed-value success assertion here flaky by construction.
 */
const GROUPS_PATH = '/api/customer_groups/customer-groups';
const REORDER_PATH = '/api/customer_groups/customer-groups/reorder';

test.describe('TC-CGRP-003: customer groups reorder tenant isolation', () => {
  test('reordering with a tenant-A group id from tenant B silently no-ops on the tenant-A row', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    const originalPriority = fixturePriority(stamp, 1);

    let groupId: string | null = null;
    let actor: SecondTenantActor | null = null;

    try {
      groupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-003-${stamp}`,
        name: `QA CGRP 003 Group ${stamp}`,
        priority: originalPriority,
      });

      actor = await createSecondTenantActor(request, superadminToken, stamp);

      const reorderResponse = await apiRequest(request, 'POST', REORDER_PATH, {
        token: actor.token,
        data: { ids: [groupId] },
      });
      expect(reorderResponse.status(), 'cross-tenant reorder call itself should not error').toBe(200);
      const reorderBody = await readJsonSafe<{ ok?: boolean }>(reorderResponse);
      expect(reorderBody?.ok, 'cross-tenant reorder should report ok').toBe(true);

      // The tenant-A group's priority must be untouched — a reorder scoped to
      // tenant A's own priority space would have rewritten it to 10.
      const survivorResponse = await apiRequest(
        request,
        'GET',
        `${GROUPS_PATH}?id=${encodeURIComponent(groupId)}`,
        { token: adminToken },
      );
      const survivorBody = await readJsonSafe<{ items?: Array<{ id: string; priority: number }> }>(survivorResponse);
      expect(
        (survivorBody?.items ?? [])[0]?.priority,
        'tenant-B reorder call must not change a tenant-A group priority',
      ).toBe(originalPriority);
    } finally {
      await deleteCustomerGroupIfExists(request, adminToken, groupId);
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
