import { expect, test, type APIRequestContext } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
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
 * TC-CGRP-017: drag-reorder wiring on the customer-groups admin list.
 *
 * Source: .ai/runs/2026-09-22-release-2-customer-groups-visibility/PLAN.md
 * Step 1.14 — group list with drag-reorder.
 *
 * Approach note (per the Step's instructions to document the choice): a real
 * `@dnd-kit` pointer-drag simulation was NOT attempted here. This module's
 * own `backend/customer-groups/page.tsx` doc comment states its `DragHandle`
 * is "the only other place in this repo wiring `@dnd-kit/core` +
 * `@dnd-kit/sortable`" besides `packages/ui/src/backend/columns/ColumnChooserPanel.tsx`
 * — and a repo-wide search of every `__integration__/**\/*.spec.ts` file found
 * NO existing Playwright spec anywhere (including for `ColumnChooserPanel`)
 * that drives a `@dnd-kit` drag via `dragTo`/manual `mouse.down+move+up`. With
 * no in-repo precedent to mirror and no live environment available in this
 * session to iterate on pointer-event timing against the real Sortable
 * collision detector, a hand-rolled simulation would be pure guesswork and a
 * likely flake source. This test instead takes the fallback explicitly
 * sanctioned by the Step: (1) prove the REST reorder contract works function-
 * ally for a caller's own tenant (tenant *isolation* for the same route is
 * already covered by TC-CGRP-003), and (2) prove the UI wiring itself —
 * `dragReorderEnabled` in `page.tsx` — by asserting the drag-handle
 * (`aria-label="Reorder"`, rendered via `useSortable`'s `attributes` which
 * include `role="button"`) is present on the unfiltered list and absent once
 * the list is narrowed. The Step's own text illustrates narrowing via the
 * `isActive` filter; this spec narrows via the search box instead — same
 * `dragReorderEnabled = !search && (!filters.isActive || filters.isActive === '')`
 * boolean, and the search input already has a robust, precedented locator
 * (`getByPlaceholder`) elsewhere in this suite, whereas driving the custom
 * `FilterBar` select-filter's open/select/apply sequence blind (no live env
 * to verify its exact selectors) was the higher flake risk of the two
 * equally-valid branches of that same condition.
 *
 * The REST reorder half runs inside a freshly provisioned second tenant:
 * reorder rewrites priorities (10, 20, ... on a full ordering), which would
 * collide with — or silently renumber — unrelated live groups in the shared
 * admin tenant. The second test also reorders the SAME groups twice (a swap),
 * the regression case for the reorder command's collision-safe two-phase write:
 * writing final priorities straight over the current ones hit the
 * `(tenant_id, priority)` unique index row by row and failed the swap.
 */
const GROUPS_PATH = '/api/customer_groups/customer-groups';
const REORDER_PATH = '/api/customer_groups/customer-groups/reorder';

async function readOrderedIds(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<unknown[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${GROUPS_PATH}?search=${encodeURIComponent(stamp)}&sortField=priority&sortDir=asc&pageSize=10`,
    { token },
  );
  expect(response.status(), 'listing the reordered groups should be 200').toBe(200);
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response);
  return (body?.items ?? []).map((item) => item.id);
}

test.describe('TC-CGRP-017: customer groups list drag-reorder wiring', () => {
  test('drag handles render unfiltered and disappear once the list is narrowed', async ({
    page,
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();

    let firstGroupId: string | null = null;
    let secondGroupId: string | null = null;

    try {
      firstGroupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-017-a-${stamp}`,
        name: `QA CGRP 017 A ${stamp}`,
        priority: fixturePriority(stamp, 0),
      });
      secondGroupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-017-b-${stamp}`,
        name: `QA CGRP 017 B ${stamp}`,
        priority: fixturePriority(stamp, 1),
      });

      await login(page, 'admin');
      await page.goto('/backend/customer-groups', { waitUntil: 'domcontentloaded' });

      const firstRow = page.getByRole('row').filter({ hasText: `qa-cgrp-017-a-${stamp}` }).first();
      await expect(firstRow).toBeVisible({ timeout: 20_000 });

      // Unfiltered view: drag-reorder is enabled, so the handle is a real
      // accessible control (dnd-kit's `useSortable` attributes set `role="button"`;
      // the DragHandle span carries `aria-label="Reorder"`).
      await expect(firstRow.getByRole('button', { name: 'Reorder' })).toBeVisible({ timeout: 10_000 });

      // Narrow the list via search — dragReorderEnabled flips to false.
      const searchInput = page.getByPlaceholder('Search groups...');
      await expect(searchInput).toBeVisible({ timeout: 10_000 });
      await searchInput.fill(stamp);

      const firstRowFiltered = page.getByRole('row').filter({ hasText: `qa-cgrp-017-a-${stamp}` }).first();
      await expect(firstRowFiltered).toBeVisible({ timeout: 10_000 });
      // The row itself still renders; the drag handle no longer exposes an
      // accessible "Reorder" button — the component falls back to a
      // decorative, `aria-hidden` grip icon per `dragReorderEnabled` gating.
      await expect(firstRowFiltered.getByRole('button', { name: 'Reorder' })).toHaveCount(0);
    } finally {
      await deleteCustomerGroupIfExists(request, token, firstGroupId);
      await deleteCustomerGroupIfExists(request, token, secondGroupId);
    }
  });

  test('reorder persists via the API and reordering the same groups again (swap) also succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();

    let actor: SecondTenantActor | null = null;
    let firstGroupId: string | null = null;
    let secondGroupId: string | null = null;

    try {
      actor = await createSecondTenantActor(request, superadminToken, stamp);
      const token = actor.token;

      firstGroupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-017-rest-a-${stamp}`,
        name: `QA CGRP 017 REST A ${stamp}`,
        priority: fixturePriority(stamp, 0),
      });
      secondGroupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-017-rest-b-${stamp}`,
        name: `QA CGRP 017 REST B ${stamp}`,
        priority: fixturePriority(stamp, 1),
      });

      const firstReorder = await apiRequest(request, 'POST', REORDER_PATH, {
        token,
        data: { ids: [secondGroupId, firstGroupId] },
      });
      expect(firstReorder.status(), 'first reorder should return 200').toBe(200);
      expect(await readOrderedIds(request, token, stamp), 'group B should sort before group A after the first reorder').toEqual([
        secondGroupId,
        firstGroupId,
      ]);

      const swapReorder = await apiRequest(request, 'POST', REORDER_PATH, {
        token,
        data: { ids: [firstGroupId, secondGroupId] },
      });
      expect(swapReorder.status(), 'reordering the same groups again (swap) should return 200, not a priority conflict').toBe(
        200,
      );
      expect(await readOrderedIds(request, token, stamp), 'group A should sort before group B after the swap').toEqual([
        firstGroupId,
        secondGroupId,
      ]);
    } finally {
      const cleanupToken = actor?.token ?? null;
      await deleteCustomerGroupIfExists(request, cleanupToken, firstGroupId);
      await deleteCustomerGroupIfExists(request, cleanupToken, secondGroupId);
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
