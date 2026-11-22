import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import { getFetchWindow } from '../lib/calendar/range';
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
  test('follows the recurring overlay cursor and renders masters from both pages', async ({ page, request }) => {
    const stamp = Date.now();
    const meetingTitle = `QA Cal Recurring ${stamp}`;
    const seriesTitles = [`${meetingTitle} Morning`, `${meetingTitle} Afternoon`];
    let adminToken: string | null = null;
    let personId: string | null = null;
    const interactionIds: string[] = [];

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);
      const fixturePersonId = await createPersonFixture(request, adminToken, {
        firstName: 'CalRecurring',
        lastName: `Person${stamp}`,
        displayName: `CalRecurring Person ${stamp}`,
      });
      personId = fixturePersonId;
      for (const [index, title] of seriesTitles.entries()) {
        interactionIds.push(await createInteractionFixture(request, adminToken, {
          entityId: fixturePersonId,
          interactionType: 'meeting',
          title,
          status: 'planned',
          scheduledAt: localTimeAt(-14, 10 + index * 2),
          durationMinutes: 60,
          recurrenceRule: 'FREQ=WEEKLY',
        }));
      }

      const fetchWindow = getFetchWindow(mondayWeekRange(new Date()));
      const regularItems = await listInteractionsInWindow(request, adminToken, {
        entityId: fixturePersonId,
        ...fetchWindow,
      });
      expect(regularItems.some((item) => interactionIds.includes(item.id))).toBe(false);

      const recurringMasters = await listInteractionsInWindow(request, adminToken, {
        entityId: fixturePersonId,
        ...fetchWindow,
        recurrenceMasters: true,
      });
      expect(recurringMasters.map((item) => item.id).sort()).toEqual([...interactionIds].sort());

      await seedShowWeekendsPreference(page, scope.userId);
      await login(page, 'admin');
      const overlayCursors: (string | null)[] = [];
      await page.route(`**${INTERACTIONS_PATH}?*`, async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('recurrenceMasters') !== 'true') {
          await route.continue();
          return;
        }
        overlayCursors.push(url.searchParams.get('cursor'));
        url.searchParams.set('entityId', fixturePersonId);
        url.searchParams.set('limit', '1');
        await route.continue({ url: url.toString() });
      });
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);
      await page.locator('[data-calendar-search]').fill(meetingTitle);

      for (const title of seriesTitles) {
        await expect(page.getByRole('button', { name: gridBlockName(title) })).toHaveCount(1);
      }
      expect(overlayCursors).toContain(null);
      expect(overlayCursors.some((cursor) => Boolean(cursor))).toBe(true);
    } finally {
      for (const interactionId of interactionIds) {
        await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, interactionId);
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
