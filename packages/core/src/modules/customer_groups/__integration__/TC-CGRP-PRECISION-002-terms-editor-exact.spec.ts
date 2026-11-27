import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-PRECISION-002: the "Commercial terms" editor keeps exact terms amounts when an
 * unrelated field is saved. Amounts set through the API with more digits than a float holds
 * must survive a UI save that only changes the payment days.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

type TermsBody = {
  terms?: {
    paymentTermsDays?: number | null;
    defaultCreditLimitExact?: string | null;
    creditCurrencyCode?: string | null;
    approvalRequiredAboveExact?: string | null;
    minOrderValueExact?: string | null;
  } | null;
};

const CREDIT_LIMIT = '25.123456789012345678';
const APPROVAL_ABOVE = '1000.000000000000000001';
const MIN_ORDER = '0.000000000000000001';

test.describe('TC-CGRP-PRECISION-002: terms editor keeps exact amounts', () => {
  test('changing only the payment days keeps every stored amount digit', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin');
    const stamp = uniqueStamp();
    const code = `qa-cgrp-precision-002-${stamp}`;
    let groupId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(page.request, token, {
        code,
        name: `QA CGRP Precision 002 ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 8),
      });
      const termsPath = `/api/customer_groups/customer-groups/${groupId}/terms`;

      const seeded = await apiRequest(page.request, 'PUT', termsPath, {
        token,
        data: {
          paymentTermsDays: 30,
          defaultCreditLimit: CREDIT_LIMIT,
          creditCurrencyCode: 'ETH',
          approvalRequiredAbove: APPROVAL_ABOVE,
          minOrderValue: MIN_ORDER,
        },
      });
      expect(seeded.status(), 'seeding terms through the API should succeed').toBe(200);

      await login(page, 'admin');
      await page.goto(`/backend/customer-groups/${groupId}/edit`);
      await expect(page.locator('[data-crud-field-id="code"] input')).toHaveValue(code, { timeout: 15_000 });

      const paymentInput = page.locator('[data-crud-field-id="paymentTermsDays"] input');
      await expect(paymentInput).toHaveValue('30', { timeout: 10_000 });
      await expect(page.locator('[data-crud-field-id="defaultCreditLimit"] input')).toHaveValue(CREDIT_LIMIT);

      await fillControlledInput(paymentInput, '45');
      await page.getByRole('button', { name: 'Save terms' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Commercial terms saved.' }),
      ).toBeVisible({ timeout: 10_000 });

      const response = await apiRequest(page.request, 'GET', termsPath, { token });
      expect(response.status()).toBe(200);
      const body = (await readJsonSafe<TermsBody>(response)) ?? {};
      expect(body.terms?.paymentTermsDays).toBe(45);
      expect(body.terms?.defaultCreditLimitExact).toBe(CREDIT_LIMIT);
      expect(body.terms?.creditCurrencyCode).toBe('ETH');
      expect(body.terms?.approvalRequiredAboveExact).toBe(APPROVAL_ABOVE);
      expect(body.terms?.minOrderValueExact).toBe(MIN_ORDER);
    } finally {
      await deleteCustomerGroupIfExists(page.request, token, groupId);
    }
  });
});
