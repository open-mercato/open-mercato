import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPromotionFixture, deletePromotionIfExists, PROMOTIONS_PATH, uniqueStamp } from './helpers';

/**
 * TC-PROM-076: promotions list drag-sort and save.
 *
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Implementation
 * Plan Phase 1 step 18 — "list drag-sort and save".
 *
 * No repo precedent exists for simulating an actual dnd-kit pointer drag in
 * Playwright (`packages/core/src/modules/customer_groups/__integration__/TC-CGRP-017-drag-reorder-ui.spec.ts`
 * asserts the drag handle's presence but does not attempt a real drag
 * simulation either). `backend/promotions/page.tsx` ships a
 * keyboard/mouse-free alternative specifically for this — explicit "Move
 * up"/"Move down" `IconButton`s next to the drag handle on every row — so
 * this spec drives the reorder through those real buttons instead of trying
 * to simulate dnd-kit's pointer sensor, then clicks the same "Save" button a
 * real drag would need, and confirms the new order persisted with a fresh
 * `GET /api/promotions` read (plus a reloaded-page UI assertion).
 *
 * Promotions are seeded via the API (fast, deterministic) with a shared
 * unique name fragment and reads the list filtered by that fragment via the
 * page's own search box, isolating this test from any other promotion in
 * the environment and from pagination.
 */
test.describe('TC-PROM-076: promotions list drag-sort and save', () => {
  test('reordering promotions via the Move up/down buttons persists the new order', async ({ page, request }) => {
    test.setTimeout(120_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const searchFragment = `QA PROM 076 ${stamp}`;
    const names = {
      a: `${searchFragment} A`,
      b: `${searchFragment} B`,
      c: `${searchFragment} C`,
    };

    let idA: string | null = null;
    let idB: string | null = null;
    let idC: string | null = null;

    try {
      const fixtureA = await createPromotionFixture(request, token, { name: names.a, order: 9001 });
      idA = fixtureA.id;
      const fixtureB = await createPromotionFixture(request, token, { name: names.b, order: 9002 });
      idB = fixtureB.id;
      const fixtureC = await createPromotionFixture(request, token, { name: names.c, order: 9003 });
      idC = fixtureC.id;

      await login(page, 'admin');
      await page.goto('/backend/promotions', { waitUntil: 'domcontentloaded' });

      const searchInput = page.getByPlaceholder('Search promotions...');
      await searchInput.fill(searchFragment);

      const nameSpans = page.locator('[data-slot="card-content"]').filter({ hasText: searchFragment });
      await expect(nameSpans).toHaveCount(3);

      // Initial order mirrors creation order (ascending `order`): A, B, C.
      await expect.poll(() => nameSpans.allTextContents().then((texts) => texts.map((text) => text.includes(names.a)
        ? 'A'
        : text.includes(names.b)
          ? 'B'
          : text.includes(names.c)
            ? 'C'
            : '?'))).toEqual(['A', 'B', 'C']);

      // Move C to the top via the real "Move up" buttons (two presses: index 2 -> 1 -> 0).
      const cardC = page.locator('[data-slot="card-content"]').filter({ hasText: names.c });
      await cardC.getByRole('button', { name: 'Move up' }).click();
      await cardC.getByRole('button', { name: 'Move up' }).click();

      await expect.poll(() => nameSpans.allTextContents().then((texts) => texts.map((text) => text.includes(names.a)
        ? 'A'
        : text.includes(names.b)
          ? 'B'
          : text.includes(names.c)
            ? 'C'
            : '?'))).toEqual(['C', 'A', 'B']);

      await expect(page.getByText('Unsaved changes')).toBeVisible();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Promotions updated').first()).toBeVisible();

      // Reload the page and the search filter (search is local component
      // state, not part of the URL) to confirm the UI itself re-renders the
      // persisted order after a fresh load, not just the in-memory state.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByPlaceholder('Search promotions...').fill(searchFragment);
      await expect(nameSpans).toHaveCount(3);
      await expect.poll(() => nameSpans.allTextContents().then((texts) => texts.map((text) => text.includes(names.a)
        ? 'A'
        : text.includes(names.b)
          ? 'B'
          : text.includes(names.c)
            ? 'C'
            : '?'))).toEqual(['C', 'A', 'B']);

      // Independently confirm via a fresh API read (no UI state involved).
      const listResponse = await apiRequest(request, 'GET', `${PROMOTIONS_PATH}?search=${encodeURIComponent(searchFragment)}&sortField=order&sortDir=asc&pageSize=50`, {
        token,
      });
      expect(listResponse.status(), 'GET /api/promotions should return 200').toBe(200);
      const listBody = await readJsonSafe<{ items: Array<{ id: string; order: number }> }>(listResponse);
      const orderedIds = (listBody?.items ?? []).map((item) => item.id);
      expect(orderedIds).toEqual([idC, idA, idB]);
    } finally {
      await deletePromotionIfExists(request, token, idA);
      await deletePromotionIfExists(request, token, idB);
      await deletePromotionIfExists(request, token, idC);
    }
  });
});
