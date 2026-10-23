import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  createCustomerGroupTermsFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { expectConflictBanner } from '@open-mercato/core/helpers/integration/optimisticLockUi';
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-029: two editors open a group that has no commercial terms yet. The
 * other editor saves first (simulated with an out-of-band PUT that creates the
 * terms row); the still-open tab then sets its own terms and saves. That second
 * first-time save must surface the conflict bar instead of silently overwriting
 * the row the other editor just created (#7078).
 */
test.describe('TC-CGRP-029: Commercial terms section — concurrent first save', () => {
  test('a first save after another editor created the terms surfaces the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin');
    const stamp = uniqueStamp();
    const code = `qa-cgrp-029-${stamp}`;
    let groupId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(page.request, token, {
        code,
        name: `QA CGRP 029 Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });

      await login(page, 'admin');
      await page.goto(`/backend/customer-groups/${groupId}/edit`);
      await expect(page.locator('[data-crud-field-id="code"] input')).toHaveValue(code, { timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Set terms for this group' })).toBeVisible({ timeout: 10_000 });

      await createCustomerGroupTermsFixture(page.request, token, {
        groupId,
        paymentTermsDays: 41,
      });

      await page.getByRole('button', { name: 'Set terms for this group' }).click();
      const paymentInput = page.locator('[data-crud-field-id="paymentTermsDays"] input');
      await expect(paymentInput).toBeVisible({ timeout: 10_000 });
      await fillControlledInput(paymentInput, '42');
      await page.getByRole('button', { name: 'Save terms' }).click();

      await expectConflictBanner(page);

      const storedResponse = await apiRequest(page.request, 'GET', `/api/customer_groups/customer-groups/${groupId}/terms`, {
        token,
      });
      expect(storedResponse.status()).toBe(200);
      const storedBody = await readJsonSafe<{ terms?: { paymentTermsDays?: number } }>(storedResponse);
      expect(storedBody?.terms?.paymentTermsDays, 'the other editor’s first save must survive').toBe(41);
    } finally {
      await deleteCustomerGroupIfExists(page.request, token, groupId);
    }
  });
});
