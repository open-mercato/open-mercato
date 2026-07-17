import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  INTERACTIONS_PATH,
  localTimeAt,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures';

/**
 * TC-CAL-007: Calendar Settings / Customization modal.
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md ("Integration Test Coverage",
 * Figma `1788:3701`).
 *
 * The toolbar gear (`button[aria-label="Calendar settings"]`) opens the
 * Customization dialog: Event Categories + Activity Types tag inputs (the
 * Activity Types list is seeded from the tenant `activity-types` dictionary, so
 * the "Meeting" default type appears as a chip) and four preference switches.
 *
 * "Show weekends" is a per-user view preference persisted to localStorage.
 * Default OFF → the week renders Mon–Fri (5 day-columns, no Sat/Sun headers).
 * Toggling it ON and clicking "Save Changes" makes the week render Mon–Sun
 * (7 day-columns; Sat/Sun headers appear). The saved preference survives a full
 * page reload. Cancel discards an unsaved toggle change.
 *
 * Determinism notes:
 * - The default Playwright viewport (1280px) is above the 640px phone
 *   breakpoint, so the calendar boots in Week view with the "This week" preset
 *   — the week-grid day headers are present without any view switching.
 * - Week day headers read `${dd} ${EEE}` uppercased (e.g. "08 MON"); weekend
 *   columns are asserted via their "SAT"/"SUN" weekday tokens, which are
 *   independent of the run date.
 * - A planned meeting fixture in the current week keeps the grid populated, but
 *   the column-count assertions key on weekday headers, not on the fixture.
 */
test.describe('TC-CAL-007: Calendar settings / customization modal', () => {
  test('gear opens customization modal; Show weekends toggle persists across reload; Cancel discards', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const meetingTitle = `QA Cal Settings ${stamp}`;
    let adminToken: string | null = null;
    let personId: string | null = null;
    let meetingId: string | null = null;

    try {
      // Freeze to a weekday so this spec verifies the settings modal default.
      // TC-CAL-010 separately covers the intentional "today is a weekend"
      // exception where today's weekend column remains visible.
      await page.clock.setFixedTime(new Date(2026, 5, 24, 10, 0, 0));

      adminToken = await getAuthToken(request, 'admin');
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalSettings',
        lastName: `Person${stamp}`,
        displayName: `CalSettings Person ${stamp}`,
      });
      meetingId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: meetingTitle,
        status: 'planned',
        scheduledAt: localTimeAt(0, 11, 0),
        durationMinutes: 60,
      });

      await login(page, 'admin');
      // The Activity Types tag input is seeded from the activity-types dictionary fetched on
      // mount; wait for that exact response (set up before navigation) rather than
      // `networkidle`, which never settles because the backend AppShell holds a persistent
      // `/api/events/stream` SSE connection open.
      const activityTypesLoaded = page.waitForResponse((response) =>
        response.url().includes('/api/customers/dictionaries/activity-types'),
      );
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);

      // Weekend weekday-header locators (Sat/Sun): the week-grid header row uses
      // `${dd} ${EEE}` uppercased, so a Sat column header text matches /\bSAT\b/.
      const saturdayHeader = page.getByText(/\bSAT\b/).first();
      const sundayHeader = page.getByText(/\bSUN\b/).first();

      // -- Default: weekends hidden (Mon–Fri week, 5 columns) -------------------
      await expect(saturdayHeader).toBeHidden();
      await expect(sundayHeader).toBeHidden();

      // The seed must be populated before the modal snapshots it on first open.
      await activityTypesLoaded;

      // -- Gear opens the Customization dialog -----------------------------------
      await page.getByRole('button', { name: 'Calendar settings' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Customization').first()).toBeVisible();
      await expect(dialog.getByText('Event Categories', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Activity Types', { exact: true })).toBeVisible();
      const weekendSwitch = dialog.getByRole('switch', { name: 'Show weekends' });
      await expect(weekendSwitch).toBeVisible();

      // -- Activity Types tag input seeded from the activity-types dictionary -----
      // ("meeting" is a seeded default → its "Meeting" label renders as a chip).
      await expect(dialog.getByText('Meeting', { exact: true })).toBeVisible();

      // -- Conflict scope: nested under Conflict warnings, defaults to "My meetings" --
      const conflictWarningsSwitch = dialog.getByRole('switch', { name: 'Conflict warnings' });
      const scopeGroup = dialog.getByRole('group', { name: 'Conflict scope' });
      await expect(scopeGroup).toBeVisible();
      await expect(scopeGroup.getByRole('button', { name: 'My meetings', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(scopeGroup.getByRole('button', { name: 'All meetings', exact: true })).toHaveAttribute('aria-pressed', 'false');
      // Turning Conflict warnings off hides the scope selector; turning it back on restores it.
      await conflictWarningsSwitch.click();
      await expect(scopeGroup).toBeHidden();
      await conflictWarningsSwitch.click();
      await expect(scopeGroup).toBeVisible();

      // -- Exactly ONE close affordance (regression guard: before dismissible={false}
      //    the header X coexisted with DialogContent's auto-rendered X → two X's) --
      await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(1);

      // -- Escape closes the modal (DS dialog rule: Escape cancels; dismissible only
      //    gates the auto-X button, not Radix's Escape/overlay dismissal) ----------
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      // Re-open to continue the Cancel-discards flow on a fresh (unsaved) modal.
      await page.getByRole('button', { name: 'Calendar settings' }).click();
      await expect(dialog).toBeVisible();
      await expect(weekendSwitch).toBeVisible();

      // -- Cancel discards an unsaved toggle change ------------------------------
      await expect(weekendSwitch).not.toBeChecked();
      await weekendSwitch.click();
      await expect(weekendSwitch).toBeChecked();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toBeHidden();
      // Week still shows Mon–Fri — the discarded toggle had no effect.
      await expect(saturdayHeader).toBeHidden();
      await expect(sundayHeader).toBeHidden();

      // -- Toggle Show weekends ON + Save → 7-column week ------------------------
      await page.getByRole('button', { name: 'Calendar settings' }).click();
      const dialog2 = page.getByRole('dialog');
      await expect(dialog2).toBeVisible();
      const weekendSwitch2 = dialog2.getByRole('switch', { name: 'Show weekends' });
      await expect(weekendSwitch2).not.toBeChecked();
      await weekendSwitch2.click();
      await expect(weekendSwitch2).toBeChecked();
      // Also switch conflict scope to "All meetings" so its persistence is covered too.
      const scopeGroup2 = dialog2.getByRole('group', { name: 'Conflict scope' });
      await scopeGroup2.getByRole('button', { name: 'All meetings', exact: true }).click();
      await expect(scopeGroup2.getByRole('button', { name: 'All meetings', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await dialog2.getByRole('button', { name: 'Save Changes', exact: true }).click();
      await expect(dialog2).toBeHidden();

      // Sat + Sun columns now render (Mon–Sun, 7 columns).
      await expect(saturdayHeader).toBeVisible();
      await expect(sundayHeader).toBeVisible();

      // -- Preferences persist across a full page reload (per-user localStorage) --
      await page.reload();
      await waitForCalendarLoaded(page);
      await expect(page.getByText(/\bSAT\b/).first()).toBeVisible();
      await expect(page.getByText(/\bSUN\b/).first()).toBeVisible();
      // Conflict scope persisted too — reopen and confirm "All meetings" is selected.
      await page.getByRole('button', { name: 'Calendar settings' }).click();
      const dialog3 = page.getByRole('dialog');
      await expect(dialog3).toBeVisible();
      await expect(
        dialog3.getByRole('group', { name: 'Conflict scope' }).getByRole('button', { name: 'All meetings', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await dialog3.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog3).toBeHidden();
    } finally {
      // Reset the per-user preference so the localStorage state does not leak
      // into other specs sharing this browser profile across retries.
      await page.evaluate(() => {
        try {
          for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
            const key = window.localStorage.key(index);
            if (key && key.startsWith('om.customers.calendar.preferences')) {
              window.localStorage.removeItem(key);
            }
          }
        } catch {
          /* ignore */
        }
      }).catch(() => {});
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
