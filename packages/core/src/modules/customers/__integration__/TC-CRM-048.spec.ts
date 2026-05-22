import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-048: Inline activity composer layout upgrade
 * Spec: .ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md Phase 6 (Q7)
 *
 * Verifies the reworked `InlineActivityComposer`:
 *   - description textarea now has a visible label + 3-row autosize sizing
 *   - a "Hide week preview" toggle is rendered and clicking it removes the
 *     MiniWeekCalendar from the DOM
 *   - the preference persists in localStorage under the per-entity-kind key
 */
// TODO(crm-activity-redesign): The `InlineActivityComposer` (Description textarea + week
// preview toggle) was removed from the people-v2 detail page by PR #1791 in favour of
// `ActivitiesCard` + `ActivitiesAddNewMenu` (which opens `ScheduleActivityDialog`). Re-author
// this scenario against the new schedule dialog once UX confirms whether the week-preview
// toggle should resurface.
test.describe.skip('TC-CRM-048: Inline activity composer — multiline description + week preview toggle', () => {
  test('shows labelled multi-row textarea and lets the user hide the week preview', async ({
    page,
    request,
  }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;
    const stamp = Date.now();
    const personDisplayName = `QA TC-CRM-048 Person ${stamp}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-048 Co ${stamp}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC048-${stamp}`,
        displayName: personDisplayName,
        companyEntityId: companyId,
      });

      await login(page, 'admin');
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.evaluate(() => {
        // Force Zone 1 expanded and clear any previous preference seed.
        localStorage.setItem('om:zone1-collapsed:person-v2', JSON.stringify('0'));
        localStorage.removeItem('om:inline-composer:week-preview:person');
      });

      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: personDisplayName, exact: true })).toBeVisible({
        timeout: 15000,
      });

      // Textarea has an associated label and rows=3.
      const textarea = page.getByRole('textbox', { name: /Description/i }).first()
      await expect(textarea).toBeVisible({ timeout: 10000 });
      await expect(textarea).toHaveAttribute('rows', '3');

      // Hide week preview toggle is present by default (calendar visible).
      const hideBtn = page.getByRole('button', { name: /Hide week preview/i }).first()
      await expect(hideBtn).toBeVisible()

      // Click to hide → Show button appears, calendar is gone, preference stored.
      await hideBtn.click()
      await expect(page.getByRole('button', { name: /Show week preview/i }).first()).toBeVisible()
      const storedValue = await page.evaluate(() =>
        localStorage.getItem('om:inline-composer:week-preview:person'),
      )
      expect(storedValue).toBe(JSON.stringify('1'))
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
