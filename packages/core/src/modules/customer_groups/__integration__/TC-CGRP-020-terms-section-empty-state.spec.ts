import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-020: Phase 2 UI gate — the "Commercial terms" section on the group
 * edit page (`components/CustomerGroupTermsSection.tsx`, mounted by
 * `backend/customer-groups/[id]/edit/page.tsx`) renders the dedicated empty
 * state — "No terms set — inheriting from parent / tenant defaults" plus a
 * "Set terms for this group" action — for a freshly created group that has
 * no terms row yet, and does NOT render a blank terms form.
 *
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §14 Phase 2 UI
 * paths; `.ai/runs/2026-09-22-release-2-customer-groups-visibility/PLAN.md`
 * Step 2.9.
 */
test.describe('TC-CGRP-020: Commercial terms section — empty state', () => {
  test('a group with no terms row shows the empty state, not a blank form', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin');
    const stamp = uniqueStamp();
    const code = `qa-cgrp-020-${stamp}`;
    let groupId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(page.request, token, {
        code,
        name: `QA CGRP 020 Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });

      await login(page, 'admin');
      await page.goto(`/backend/customer-groups/${groupId}/edit`);

      // Readiness gate: the group CrudForm's own field has loaded, which the
      // edit page flips in the same load pass that resolves the terms fetch
      // (see `EditCustomerGroupPage`'s single `Promise.all` + shared `loading`).
      await expect(page.locator('[data-crud-field-id="code"] input')).toHaveValue(code, { timeout: 15_000 });

      await expect(page.getByRole('heading', { name: 'Commercial terms', level: 3 })).toBeVisible();
      await expect(
        page.getByText('No terms set — inheriting from parent / tenant defaults', { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Set terms for this group' })).toBeVisible();

      // The terms form itself must NOT be mounted yet (no blank form).
      await expect(page.locator('[data-crud-field-id="paymentTermsDays"]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Save terms' })).toHaveCount(0);
    } finally {
      await deleteCustomerGroupIfExists(page.request, token, groupId);
    }
  });
});
