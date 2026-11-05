import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  gridBlockName,
  INTERACTIONS_PATH,
  localTimeAt,
  seedShowWeekendsPreference,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures';

/**
 * TC-CAL-002: Calendar page load & week grid (hydration smoke).
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md ("Integration Test Coverage").
 *
 * `/backend/calendar` renders the server shell and hydrates the client
 * calendar: header (date title + "New event"), toolbar (Today, range preset,
 * search), tabs ("All Scheduled" / "Meetings" / "Events"), view switcher
 * (Day/Week/Month/Agenda radiogroup, Week active by default), shortcut footer
 * with the timezone label, and the fixture meeting rendered as a week-grid
 * block (accessible name `${title}, ${timeRange}`). The sidebar lists
 * Calendar inside the Customers group (page.meta.ts pageGroup).
 *
 * Fixture: one planned meeting today at 10:00 local. The test seeds the calendar
 * preference `showWeekends: true` (via localStorage, before navigation) so today's
 * column is visible even when the run date is a weekend — the Mon–Fri default is
 * covered by TC-CAL-007 instead.
 */
test.describe('TC-CAL-002: Calendar page load & week grid hydration', () => {
  test('page shell, week grid block and sidebar entry render after hydration', async ({ page, request }) => {
    const stamp = Date.now();
    const meetingTitle = `QA Cal Smoke ${stamp}`;
    let adminToken: string | null = null;
    let personId: string | null = null;
    let meetingId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalSmoke',
        lastName: `Person${stamp}`,
        displayName: `CalSmoke Person ${stamp}`,
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

      // -- Header: formatted date title + New event CTA ----------------------
      const now = new Date();
      const headerTitle = new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', year: 'numeric' }).format(now);
      await expect(page.getByRole('heading', { name: headerTitle })).toBeVisible();
      await expect(page.getByRole('button', { name: 'New event', exact: true })).toBeVisible();

      // -- Toolbar: Today button, range preset select, search input ----------
      await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Date range preset' })).toBeVisible();
      await expect(page.locator('[data-calendar-search]')).toBeVisible();

      // -- Tabs and view switcher (Week is the default) -----------------------
      await expect(page.getByRole('tab', { name: 'All Scheduled' })).toBeVisible();
      await expect(page.getByRole('tab', { name: /^Meetings \(\d+\)$/ })).toBeVisible();
      await expect(page.getByRole('tab', { name: /^Events \(\d+\)$/ })).toBeVisible();
      const viewSwitcher = page.getByRole('radiogroup', { name: 'Calendar view' });
      await expect(viewSwitcher.getByRole('radio', { name: 'Day', exact: true })).toBeVisible();
      await expect(viewSwitcher.getByRole('radio', { name: 'Week', exact: true })).toBeChecked();
      await expect(viewSwitcher.getByRole('radio', { name: 'Month', exact: true })).toBeVisible();
      await expect(viewSwitcher.getByRole('radio', { name: 'Agenda', exact: true })).toBeVisible();

      // -- Week grid: today's column header and the fixture meeting block ----
      const todayColumnLabel = `${String(now.getDate()).padStart(2, '0')} ${new Intl.DateTimeFormat('en', { weekday: 'short' }).format(now).toUpperCase()}`;
      await expect(page.getByText(todayColumnLabel, { exact: true })).toBeVisible();
      const meetingBlock = page.getByRole('button', { name: gridBlockName(meetingTitle) });
      await expect(meetingBlock).toBeVisible();

      // -- Footer: shortcut legend + browser timezone label -------------------
      await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toBeVisible();
      await expect(page.getByText(/\(GMT[+-]\d/)).toBeVisible();

      // -- Sidebar: Calendar entry inside the Customers group -----------------
      const sidebar = page.locator('aside').first();
      await expect(sidebar).toContainText('Customers');
      await expect(sidebar.getByRole('link', { name: 'Calendar', exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
