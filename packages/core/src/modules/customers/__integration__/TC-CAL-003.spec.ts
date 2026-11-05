import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  dotSeparatedItemName,
  formatToolbarRangeLabel,
  gridBlockName,
  INTERACTIONS_PATH,
  localTimeAt,
  mondayWeekRange,
  pressKeyUntil,
  seedShowWeekendsPreference,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures';

/**
 * TC-CAL-003: Calendar view switching & navigation.
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md ("Integration Test Coverage").
 *
 * - The Day/Week/Month/Agenda segmented control swaps views; each view shows
 *   the fixture (day column header label, month pill, agenda row).
 * - The D/W/M/A keyboard shortcuts swap views the same way; T returns to today.
 * - The week grid prev/next chevrons (aria-labels "Previous week"/"Next week")
 *   shift the toolbar range label by one Monday-start week.
 *
 * Fixture: one planned meeting today 10:00 local (always inside the current
 * Monday-start week). Range labels are computed with the same English
 * 'MMM dd – MMM dd, yyyy' format the toolbar uses.
 */
test.describe('TC-CAL-003: Calendar view switching & navigation', () => {
  test('switcher clicks and D/W/M/A keys swap views; T returns to today; chevrons shift the range', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const meetingTitle = `QA Cal Views ${stamp}`;
    let adminToken: string | null = null;
    let personId: string | null = null;
    let meetingId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalViews',
        lastName: `Person${stamp}`,
        displayName: `CalViews Person ${stamp}`,
      });
      meetingId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: meetingTitle,
        status: 'planned',
        scheduledAt: localTimeAt(0, 10, 0),
        durationMinutes: 60,
        participants: [{ userId: scope.userId, name: 'QA Admin', email: 'admin@acme.com' }],
      });

      // Force "Show weekends" on so today's column is visible even on a weekend.
      await seedShowWeekendsPreference(page, scope.userId);

      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);

      const viewSwitcher = page.getByRole('radiogroup', { name: 'Calendar view' });
      const dayRadio = viewSwitcher.getByRole('radio', { name: 'Day', exact: true });
      const weekRadio = viewSwitcher.getByRole('radio', { name: 'Week', exact: true });
      const monthRadio = viewSwitcher.getByRole('radio', { name: 'Month', exact: true });
      const agendaRadio = viewSwitcher.getByRole('radio', { name: 'Agenda', exact: true });
      const now = new Date();

      // -- Default: week view with the fixture block ---------------------------
      await expect(weekRadio).toBeChecked();
      await expect(page.getByRole('button', { name: gridBlockName(meetingTitle) })).toBeVisible();

      // Narrow to the unique fixture title so demo/seeded interactions cannot
      // crowd the per-day month pill cap (max 2 pills before "+N more") or add
      // ambiguous rows in the agenda. Blur the input afterwards so the global
      // D/W/M/A shortcuts are not swallowed by the focused search field.
      await page.locator('[data-calendar-search]').fill(meetingTitle);
      await page.locator('[data-calendar-search]').blur();
      await expect(page.getByRole('button', { name: gridBlockName(meetingTitle) })).toBeVisible();

      // -- Switcher click: Day — long weekday header + block -------------------
      await dayRadio.click();
      await expect(dayRadio).toBeChecked();
      const dayHeader = `${new Intl.DateTimeFormat('en', { weekday: 'long' }).format(now).toUpperCase()} · ${String(now.getDate()).padStart(2, '0')}`;
      await expect(page.getByText(dayHeader, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: gridBlockName(meetingTitle) })).toBeVisible();

      // -- Switcher click: Month — weekday header row + month pill -------------
      await monthRadio.click();
      await expect(monthRadio).toBeChecked();
      await expect(page.getByText('MON', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: dotSeparatedItemName(meetingTitle) })).toBeVisible();

      // -- Switcher click: Agenda — "Upcoming" header + agenda row -------------
      await agendaRadio.click();
      await expect(agendaRadio).toBeChecked();
      await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
      await expect(page.getByRole('button', { name: dotSeparatedItemName(meetingTitle) })).toBeVisible();

      // -- Keyboard shortcuts: D / W / M / A -----------------------------------
      await pressKeyUntil(page, 'd', async () => {
        await expect(dayRadio).toBeChecked({ timeout: 1_000 });
      });
      await pressKeyUntil(page, 'm', async () => {
        await expect(monthRadio).toBeChecked({ timeout: 1_000 });
      });
      await pressKeyUntil(page, 'a', async () => {
        await expect(agendaRadio).toBeChecked({ timeout: 1_000 });
      });
      await pressKeyUntil(page, 'w', async () => {
        await expect(weekRadio).toBeChecked({ timeout: 1_000 });
      });

      // -- Chevron navigation shifts the visible range label -------------------
      const currentWeek = mondayWeekRange(now);
      const currentLabel = formatToolbarRangeLabel(currentWeek.from, currentWeek.to);
      await expect(page.getByRole('button', { name: currentLabel })).toBeVisible();

      await page.getByRole('button', { name: 'Next week', exact: true }).click();
      const nextWeek = mondayWeekRange(localTimeAt(7, 12, 0));
      await expect(
        page.getByRole('button', { name: formatToolbarRangeLabel(nextWeek.from, nextWeek.to) }),
      ).toBeVisible();

      await page.getByRole('button', { name: 'Previous week', exact: true }).click();
      await page.getByRole('button', { name: 'Previous week', exact: true }).click();
      const previousWeek = mondayWeekRange(localTimeAt(-7, 12, 0));
      await expect(
        page.getByRole('button', { name: formatToolbarRangeLabel(previousWeek.from, previousWeek.to) }),
      ).toBeVisible();

      // -- T returns to today ---------------------------------------------------
      await pressKeyUntil(page, 't', async () => {
        await expect(page.getByRole('button', { name: currentLabel })).toBeVisible({ timeout: 1_000 });
      });
      await expect(page.getByRole('button', { name: gridBlockName(meetingTitle) })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
