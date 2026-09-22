import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-022: Phase 2 UI gate — client-side zod validation on the
 * "Commercial terms" form. `CustomerGroupTermsSection`'s schema declares
 * `paymentTermsDays: z.coerce.number().int().min(0, negativeMessage).optional()`
 * (`customer_groups.groups.form.terms.errors.negative` = "Must be zero or
 * greater."). A negative value must be rejected inline BEFORE any network
 * call — `CrudForm` runs schema validation ahead of `onSubmit`, so a client
 * rejection never reaches `PUT /api/customer_groups/customer-groups/:id/terms`.
 *
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §14 Phase 2 UI
 * paths; `.ai/runs/2026-09-22-release-2-customer-groups-visibility/PLAN.md`
 * Step 2.9.
 */
test.describe('TC-CGRP-022: Commercial terms section — negative-input client-side validation', () => {
  test('a negative paymentTermsDays is rejected inline and never sent to the API', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin');
    const stamp = uniqueStamp();
    const code = `qa-cgrp-022-${stamp}`;
    let groupId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(page.request, token, {
        code,
        name: `QA CGRP 022 Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });

      await login(page, 'admin');
      await page.goto(`/backend/customer-groups/${groupId}/edit`);
      await expect(page.locator('[data-crud-field-id="code"] input')).toHaveValue(code, { timeout: 15_000 });

      await page.getByRole('button', { name: 'Set terms for this group' }).click();
      const paymentInput = page.locator('[data-crud-field-id="paymentTermsDays"] input');
      await expect(paymentInput).toBeVisible({ timeout: 10_000 });
      await fillControlledInput(paymentInput, '-5');

      const termsPutUrls: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'PUT' && request.url().includes(`/api/customer_groups/customer-groups/${groupId}/terms`)) {
          termsPutUrls.push(request.url());
        }
      });

      await page.getByRole('button', { name: 'Save terms' }).click();

      await expect(page.getByText('Must be zero or greater.')).toBeVisible({ timeout: 10_000 });

      // Give any accidental async submit a moment to have fired before asserting absence.
      await page.waitForTimeout(500);
      expect(termsPutUrls, 'client-side validation must block the PUT from ever being sent').toHaveLength(0);
    } finally {
      await deleteCustomerGroupIfExists(page.request, token, groupId);
    }
  });
});
