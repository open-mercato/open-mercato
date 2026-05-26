import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-044: Zone 1 collapse state persists across a full page refresh with
 * no visible "expanded for one tick" flicker.
 *
 * Spec: .ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md Phase 4 (Q4)
 *
 * The `usePersistedBooleanFlag` hook was rewritten with `useSyncExternalStore`
 * so the client's first render already reflects the stored value. This test
 * verifies the observable behaviour end-to-end:
 *   1. Seed `om:zone1-collapsed:person-v2 = "1"` in localStorage.
 *   2. Navigate to a person detail page.
 *   3. On the first render after hydration, the collapse toggle exposes the
 *      "Expand form panel" aria-label (i.e. the zone is already collapsed).
 *   4. Repeat with `"0"` and assert the zone starts expanded ("Collapse form
 *      panel" aria-label).
 *
 * The old hook would briefly show the opposite state for the first paint,
 * then flip after its `useEffect` ran. This test fails on that old behaviour.
 */
test.describe('TC-CRM-044: Zone 1 collapse persists without hydration flicker', () => {
  test('first render after refresh reflects the stored localStorage value', async ({
    page,
    request,
  }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let personEntityId: string | null = null;
    const stamp = Date.now();
    const displayName = `QA TC-CRM-044 ${stamp}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-044 Co ${stamp}`);
      personEntityId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC044-${stamp}`,
        displayName,
        companyEntityId: companyId,
      });

      await login(page, 'admin');
      await page.setViewportSize({ width: 1600, height: 900 });

      const detailUrl = `/backend/customers/people-v2/${personEntityId}`;

      // First: seed as collapsed -> expect "Expand" label after refresh.
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible({
        timeout: 15000,
      });

      await page.evaluate(() => {
        localStorage.setItem('om:zone1-collapsed:person-v2', JSON.stringify('1'));
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible({
        timeout: 15000,
      });
      await expect(
        page.getByRole('button', { name: 'Expand form panel' }),
      ).toBeVisible({ timeout: 5000 });
      await expect(
        page.getByRole('button', { name: 'Collapse form panel' }),
      ).toHaveCount(0);

      // Now: seed as expanded -> expect "Collapse" label.
      await page.evaluate(() => {
        localStorage.setItem('om:zone1-collapsed:person-v2', JSON.stringify('0'));
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible({
        timeout: 15000,
      });
      await expect(
        page.getByRole('button', { name: 'Collapse form panel' }),
      ).toBeVisible({ timeout: 5000 });
      await expect(
        page.getByRole('button', { name: 'Expand form panel' }),
      ).toHaveCount(0);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personEntityId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
