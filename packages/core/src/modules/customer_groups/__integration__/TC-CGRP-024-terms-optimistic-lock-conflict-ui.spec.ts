import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCustomerGroupFixture,
  createCustomerGroupTermsFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { expectConflictBanner } from '@open-mercato/core/helpers/integration/optimisticLockUi';
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-024: Phase 2 UI gate — optimistic-lock conflict on the
 * "Commercial terms" form, complementing TC-CGRP-014's API-level proof
 * (`PUT /api/customer-groups/:id/terms` returns a structured 409) with the
 * real browser surface.
 *
 * `CustomerGroupTermsSection` passes `optimisticLockUpdatedAt={terms?.updatedAt}`
 * to its embedded `CrudForm`, and per `packages/ui/AGENTS.md` § CrudForm
 * Guidelines this is enough — `CrudForm` itself wraps the `onSubmit` call in
 * `withScopedApiRequestHeaders(...)` with the lock header and, on a 409,
 * calls `surfaceRecordConflict` to show the unified conflict bar
 * (`data-testid="record-conflict-banner"`, or the enterprise record_locks
 * dialog — see `optimisticLockUi.ts`'s `expectConflictBanner`). No manual
 * `withScopedApiRequestHeaders`/`buildOptimisticLockHeader` wiring exists (or
 * should exist) in `CustomerGroupTermsSection.tsx`'s `handleSubmit`.
 *
 * Technique: load the edit page once (the form captures the terms row's
 * `updatedAt` at load) -> advance the SAME terms row out-of-band via a
 * direct, header-less API PUT (reusing the `createCustomerGroupTermsFixture`
 * fixture helper, which is itself just an unauthenticated-lock PUT) so the
 * row's `updatedAt` moves past what the open browser tab is still holding ->
 * edit + submit the still-open UI form -> the now-stale lock header 409s and
 * the conflict bar appears instead of silently overwriting the concurrent
 * change. Mirrors `TC-LOCK-OSS-014`/`-015`'s bump-then-save pattern.
 *
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §14 Phase 2 UI
 * paths; `.ai/runs/2026-09-22-release-2-customer-groups-visibility/PLAN.md`
 * Step 2.9.
 */
test.describe('TC-CGRP-024: Commercial terms section — optimistic-lock conflict on save', () => {
  test('a stale terms save surfaces the conflict bar instead of silently overwriting', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin');
    const stamp = uniqueStamp();
    const code = `qa-cgrp-024-${stamp}`;
    let groupId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(page.request, token, {
        code,
        name: `QA CGRP 024 Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });
      await createCustomerGroupTermsFixture(page.request, token, {
        groupId,
        paymentTermsDays: 15,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customer-groups/${groupId}/edit`);

      // Terms already exist, so the form is pre-filled (not the empty state) —
      // its optimistic-lock token is captured at load time.
      const paymentInput = page.locator('[data-crud-field-id="paymentTermsDays"] input');
      await expect(paymentInput).toHaveValue('15', { timeout: 15_000 });

      // Advance the SAME terms row out-of-band (header-less PUT, always
      // succeeds) -> the open browser tab now holds a stale lock token.
      await createCustomerGroupTermsFixture(page.request, token, {
        groupId,
        paymentTermsDays: 45,
      });

      // Edit + save in the browser -> the now-stale header triggers a 409.
      await fillControlledInput(paymentInput, '99');
      await page.getByRole('button', { name: 'Save terms' }).click();

      await expectConflictBanner(page);
    } finally {
      await deleteCustomerGroupIfExists(page.request, token, groupId);
    }
  });
});
