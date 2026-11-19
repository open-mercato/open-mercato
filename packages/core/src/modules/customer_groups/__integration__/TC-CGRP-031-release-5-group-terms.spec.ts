import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui';
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import { fixturePriority, uniqueStamp } from './helpers';

type TermsBody = {
  terms?: {
    updatedAt?: string;
    termsCurrencyCode?: string | null;
    approvalPolicy?: string | null;
    allowQuoteRequests?: boolean | null;
    requiresPoNumber?: boolean | null;
  };
};

function termsPath(groupId: string): string {
  return `/api/customer_groups/customer-groups/${groupId}/terms`;
}

/**
 * TC-CGRP-031: Release 5 step CG1 — the four new group terms
 * (`terms_currency_code`, `approval_policy`, `allow_quote_requests`,
 * `requires_po_number`) through `PUT /api/customer_groups/customer-groups/:id/terms`
 * and through the "Commercial terms" form, including the missing-currency warning.
 *
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §5.3, §7.3, §13
 * "Phase 3 — terms (CG1)".
 */
test.describe('TC-CGRP-031: Release 5 group terms', () => {
  test('the terms route refuses a non-ISO terms currency and stores and clears the four fields', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let groupId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-031a-${stamp}`,
        name: `QA CGRP 031a Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });

      for (const invalid of ['eur', 'EURO']) {
        const refused = await apiRequest(request, 'PUT', termsPath(groupId), {
          token,
          data: { termsCurrencyCode: invalid },
        });
        expect(refused.status(), `terms currency "${invalid}" must be refused`).toBe(400);
      }
      const refusedPolicy = await apiRequest(request, 'PUT', termsPath(groupId), {
        token,
        data: { approvalPolicy: 'either' },
      });
      expect(refusedPolicy.status(), 'approvalPolicy "either" must be refused').toBe(400);

      const stored = await apiRequest(request, 'PUT', termsPath(groupId), {
        token,
        data: { termsCurrencyCode: 'EUR', approvalPolicy: 'merchant', allowQuoteRequests: true, requiresPoNumber: false },
      });
      expect(stored.status()).toBe(200);
      const storedBody = await readJsonSafe<TermsBody>(stored);
      expect(storedBody?.terms).toMatchObject({
        termsCurrencyCode: 'EUR',
        approvalPolicy: 'merchant',
        allowQuoteRequests: true,
        requiresPoNumber: false,
      });

      const read = await apiRequest(request, 'GET', termsPath(groupId), { token });
      expect(read.status()).toBe(200);
      expect((await readJsonSafe<TermsBody>(read))?.terms).toMatchObject({
        termsCurrencyCode: 'EUR',
        approvalPolicy: 'merchant',
        allowQuoteRequests: true,
        requiresPoNumber: false,
      });

      const cleared = await apiRequest(request, 'PUT', termsPath(groupId), {
        token,
        data: { termsCurrencyCode: null, approvalPolicy: null, allowQuoteRequests: null, requiresPoNumber: null },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: storedBody?.terms?.updatedAt ?? '' },
      });
      expect(cleared.status()).toBe(200);
      expect((await readJsonSafe<TermsBody>(cleared))?.terms).toMatchObject({
        termsCurrencyCode: null,
        approvalPolicy: null,
        allowQuoteRequests: null,
        requiresPoNumber: null,
      });
    } finally {
      await deleteCustomerGroupIfExists(request, token, groupId);
    }
  });

  test('the terms form sets the four fields, warns about a missing terms currency, and the values survive a reload', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin');
    const stamp = uniqueStamp();
    const code = `qa-cgrp-031b-${stamp}`;
    let groupId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(page.request, token, {
        code,
        name: `QA CGRP 031b Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 2),
      });

      await login(page, 'admin');
      await page.goto(`/backend/customer-groups/${groupId}/edit`);
      await expect(page.locator('[data-crud-field-id="code"] input')).toHaveValue(code, { timeout: 15_000 });
      await page.getByRole('button', { name: 'Set terms for this group' }).click();

      const thresholdInput = page.locator('[data-crud-field-id="approvalRequiredAbove"] input');
      await expect(thresholdInput).toBeVisible({ timeout: 10_000 });
      await fillControlledInput(thresholdInput, '1000');
      await expect(page.getByTestId('customer-group-terms-missing-currency-warning')).toBeVisible();

      await fillControlledInput(page.locator('[data-crud-field-id="termsCurrencyCode"] input'), 'pln');
      await expect(page.getByTestId('customer-group-terms-missing-currency-warning')).toHaveCount(0);

      const policy = page.locator('[data-crud-field-id="approvalPolicy"]');
      await expect(policy.getByRole('combobox')).toContainText('Inherit');
      await policy.getByRole('combobox').click();
      await page.getByRole('option', { name: 'Buyer and merchant', exact: true }).click();

      const quotes = page.locator('[data-crud-field-id="allowQuoteRequests"]');
      await quotes.getByRole('combobox').click();
      await page.getByRole('option', { name: 'Allow', exact: true }).click();

      const poNumber = page.locator('[data-crud-field-id="requiresPoNumber"]');
      await poNumber.getByRole('combobox').click();
      await page.getByRole('option', { name: 'Require', exact: true }).click();

      await page.getByRole('button', { name: 'Save terms' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Commercial terms saved.' })).toBeVisible({ timeout: 10_000 });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-crud-field-id="code"] input')).toHaveValue(code, { timeout: 15_000 });
      await expect(page.locator('[data-crud-field-id="termsCurrencyCode"] input')).toHaveValue('PLN', { timeout: 10_000 });
      await expect(page.locator('[data-crud-field-id="approvalPolicy"]').getByRole('combobox')).toContainText('Buyer and merchant');
      await expect(page.locator('[data-crud-field-id="allowQuoteRequests"]').getByRole('combobox')).toContainText('Allow');
      await expect(page.locator('[data-crud-field-id="requiresPoNumber"]').getByRole('combobox')).toContainText('Require');

      const read = await apiRequest(page.request, 'GET', termsPath(groupId), { token });
      expect((await readJsonSafe<TermsBody>(read))?.terms).toMatchObject({
        termsCurrencyCode: 'PLN',
        approvalPolicy: 'both',
        allowQuoteRequests: true,
        requiresPoNumber: true,
      });
    } finally {
      await deleteCustomerGroupIfExists(page.request, token, groupId);
    }
  });
});
