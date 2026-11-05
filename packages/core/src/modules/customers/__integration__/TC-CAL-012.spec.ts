import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  gridBlockName,
  INTERACTIONS_PATH,
  listInteractionsInWindow,
  localTimeAt,
  mondayWeekRange,
  seedShowWeekendsPreference,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures';

/**
 * TC-CAL-012: A recurring series remains visible after its master leaves the
 * calendar's regular fetch window.
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md (issue #4735).
 */
test.describe('TC-CAL-012: Recurring master outside the visible window', () => {
  test('fetches the master through the recurrence overlay and renders one expanded occurrence', async ({ page, request }) => {
    const stamp = Date.now();
    const meetingTitle = `QA Cal Recurring ${stamp}`;
    let adminToken: string | null = null;
    let personId: string | null = null;
    let interactionId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalRecurring',
        lastName: `Person${stamp}`,
        displayName: `CalRecurring Person ${stamp}`,
      });
      interactionId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: meetingTitle,
        status: 'planned',
        scheduledAt: localTimeAt(-7, 10, 0),
        durationMinutes: 60,
        recurrenceRule: 'FREQ=WEEKLY',
      });

      const currentWeek = mondayWeekRange(new Date());
      const regularItems = await listInteractionsInWindow(request, adminToken, {
        entityId: personId,
        ...currentWeek,
      });
      expect(regularItems.some((item) => item.id === interactionId)).toBe(false);

      const recurringMasters = await listInteractionsInWindow(request, adminToken, {
        entityId: personId,
        ...currentWeek,
        recurrenceMasters: true,
      });
      expect(recurringMasters.map((item) => item.id)).toEqual([interactionId]);

      await seedShowWeekendsPreference(page, scope.userId);
      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);
      await page.locator('[data-calendar-search]').fill(meetingTitle);

      await expect(page.getByRole('button', { name: gridBlockName(meetingTitle) })).toHaveCount(1);
    } finally {
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, interactionId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
