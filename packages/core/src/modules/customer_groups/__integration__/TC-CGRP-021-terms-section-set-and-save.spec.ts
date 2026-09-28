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
 * TC-CGRP-021: Phase 2 UI gate — filling in the "Commercial terms" form
 * (`components/CustomerGroupTermsSection.tsx`) through real Playwright
 * interactions, submitting, and confirming the values persist across a
 * hard reload (proving the real `PUT /api/customer_groups/customer-groups/:id/terms` round
 * trip, not just local form state).
 *
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §14 Phase 2 UI
 * paths; `.ai/runs/2026-09-22-release-2-customer-groups-visibility/PLAN.md`
 * Step 2.9.
 */
test.describe('TC-CGRP-021: Commercial terms section — set and save via the real UI', () => {
  test('reveals the form, saves real field values, and they survive a reload', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin');
    const stamp = uniqueStamp();
    const code = `qa-cgrp-021-${stamp}`;
    let groupId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(page.request, token, {
        code,
        name: `QA CGRP 021 Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });

      await login(page, 'admin');
      await page.goto(`/backend/customer-groups/${groupId}/edit`);
      await expect(page.locator('[data-crud-field-id="code"] input')).toHaveValue(code, { timeout: 15_000 });

      await page.getByRole('button', { name: 'Set terms for this group' }).click();

      const paymentInput = page.locator('[data-crud-field-id="paymentTermsDays"] input');
      await expect(paymentInput).toBeVisible({ timeout: 10_000 });

      await fillControlledInput(paymentInput, '30');
      await page.locator('[data-crud-field-id="allowPurchaseOnAccount"]').getByRole('switch').click();
      await fillControlledInput(page.locator('[data-crud-field-id="defaultCreditLimit"] input'), '5000');
      await fillControlledInput(page.locator('[data-crud-field-id="creditCurrencyCode"] input'), 'usd');
      await fillControlledInput(page.locator('[data-crud-field-id="approvalRequiredAbove"] input'), '1000');
      await fillControlledInput(page.locator('[data-crud-field-id="minOrderValue"] input'), '50');

      await page.getByRole('button', { name: 'Save terms' }).click();

      await expect(
        page.getByRole('alert').filter({ hasText: 'Commercial terms saved.' }),
      ).toBeVisible({ timeout: 10_000 });

      // The form now shows the saved values, not the empty state.
      await expect(page.getByText('No terms set — inheriting from parent / tenant defaults')).toHaveCount(0);
      await expect(paymentInput).toHaveValue('30');
      await expect(
        page.locator('[data-crud-field-id="allowPurchaseOnAccount"]').getByRole('switch'),
      ).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('[data-crud-field-id="creditCurrencyCode"] input')).toHaveValue('USD');

      // Reload and confirm persistence through the real API round trip.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-crud-field-id="code"] input')).toHaveValue(code, { timeout: 15_000 });

      await expect(page.getByText('No terms set — inheriting from parent / tenant defaults')).toHaveCount(0);
      const reloadedPaymentInput = page.locator('[data-crud-field-id="paymentTermsDays"] input');
      await expect(reloadedPaymentInput).toHaveValue('30', { timeout: 10_000 });
      await expect(
        page.locator('[data-crud-field-id="allowPurchaseOnAccount"]').getByRole('switch'),
      ).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('[data-crud-field-id="defaultCreditLimit"] input')).toHaveValue('5000');
      await expect(page.locator('[data-crud-field-id="creditCurrencyCode"] input')).toHaveValue('USD');
      await expect(page.locator('[data-crud-field-id="approvalRequiredAbove"] input')).toHaveValue('1000');
      await expect(page.locator('[data-crud-field-id="minOrderValue"] input')).toHaveValue('50');
    } finally {
      await deleteCustomerGroupIfExists(page.request, token, groupId);
    }
  });
});
