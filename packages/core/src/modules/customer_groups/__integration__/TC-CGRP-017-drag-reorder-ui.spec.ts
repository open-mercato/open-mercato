import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fixturePriority, uniqueStamp } from './helpers';

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
 * sanctioned by the Step: (1) prove the REST reorder contract works funcion-
 * ally for the admin's own tenant (tenant *isolation* for the same route is
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
 */
test.describe('TC-CGRP-017: customer groups list drag-reorder wiring', () => {
  test('drag handles render unfiltered and disappear once the list is narrowed; reorder persists via the API', async ({
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

      // Functional proof of the underlying REST contract (own-tenant path;
      // cross-tenant isolation for this same route is TC-CGRP-003).
      const reorderResponse = await apiRequest(request, 'POST', '/api/customer_groups/customer-groups/reorder', {
        token,
        data: { ids: [secondGroupId, firstGroupId] },
      });
      expect(reorderResponse.status(), 'reorder should return 200').toBe(200);

      const afterReorder = await apiRequest(
        request,
        'GET',
        `/api/customer_groups/customer-groups?search=${encodeURIComponent(stamp)}&sortField=priority&sortDir=asc&pageSize=10`,
        { token },
      );
      const afterBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(afterReorder);
      const ids = (afterBody?.items ?? []).map((item) => item.id);
      const secondIndex = ids.indexOf(secondGroupId);
      const firstIndex = ids.indexOf(firstGroupId);
      expect(secondIndex, 'reordered group B should appear in the re-fetched list').toBeGreaterThanOrEqual(0);
      expect(firstIndex, 'reordered group A should appear in the re-fetched list').toBeGreaterThanOrEqual(0);
      expect(secondIndex, 'group B should now sort before group A after reorder').toBeLessThan(firstIndex);
    } finally {
      await deleteCustomerGroupIfExists(request, token, firstGroupId);
      await deleteCustomerGroupIfExists(request, token, secondGroupId);
    }
  });
});
