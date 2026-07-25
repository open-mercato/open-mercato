import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { waitForCalendarLoaded } from './helpers/calendarFixtures';

/**
 * TC-CAL-010: Week view keeps today's column when today is a weekend and
 * "Show weekends" is OFF (regression guard for PR #3544 / issue #3483).
 *
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md ("Integration Test Coverage").
 *
 * The bug: `applyWeekendVisibility(days, showWeekends)` unconditionally dropped
 * every Saturday/Sunday when weekends were hidden, so opening `/backend/calendar`
 * on a weekend rendered an empty Mon–Fri week with today's column (and any events
 * on it) silently missing. PR #3544 adds the `keepWeekendDate` argument so the
 * current day's column is always kept, while the rest of the weekend stays hidden.
 *
 * TC-CAL-007 exercises the "Show weekends" toggle but never pins "today" to a
 * weekend, so it does not guard this fix. This spec freezes the browser clock so
 * "today" deterministically lands on a weekend (and, in a separate context, a
 * weekday) and asserts the day-column headers directly.
 *
 * Determinism notes:
 * - June 2026 starts on a Monday, so 2026-06-27 is deterministically a Saturday
 *   inside the Mon-start week Jun 22–28, and 2026-06-24 is a Wednesday. The
 *   assertions key on weekday-token headers (`27 SAT` / `SUN` / `24 WED` / `SAT`),
 *   independent of the real run date.
 * - Week day headers read `${dd} ${EEE}` uppercased (e.g. "27 SAT"); weekend
 *   columns are asserted via their weekday tokens. `getByText(...).first()` on a
 *   hidden/absent column resolves to a not-visible locator, so `toBeHidden()`
 *   passes when the column is not rendered (same approach as TC-CAL-007).
 * - `page.clock.setFixedTime` (NOT `clock.install`) freezes the wall clock but
 *   keeps timers running, so loaders/SSE still settle and `waitForCalendarLoaded`
 *   does not hang. The clock is frozen before `login`/`goto` so the browser
 *   computes "today" from the frozen value on first render.
 * - "Show weekends" defaults OFF; this spec intentionally does NOT seed the
 *   preference, because the default-OFF state is exactly the bug condition.
 *
 * Self-contained: no fixtures (the calendar boots empty on a fresh tenant; the
 * assertions read day-column headers, never event blocks). The toggle test resets
 * the per-user localStorage preference in `finally` so it cannot leak across retries.
 */
test.describe('TC-CAL-010: Week view keeps today\'s weekend column when weekends are hidden', () => {
  test('today is a Saturday → only today\'s weekend column is restored, the rest stays hidden', async ({ page }) => {
    test.slow();

    // Saturday, 2026-06-27 10:00 local — frozen before navigation so the browser
    // computes "today" from it on first render.
    await page.clock.setFixedTime(new Date(2026, 5, 27, 10, 0, 0));

    await login(page, 'admin');
    await page.goto('/backend/calendar');
    await waitForCalendarLoaded(page);

    // Today's Saturday column (`27 SAT`) is restored even though weekends are OFF…
    await expect(page.getByText(/\b27\s+SAT\b/).first()).toBeVisible();
    // …but the rest of the weekend (Sunday) is still hidden.
    await expect(page.getByText(/\bSUN\b/).first()).toBeHidden();
  });

  test('today is a Wednesday → no spurious weekend column appears', async ({ page }) => {
    test.slow();

    // Wednesday, 2026-06-24 10:00 local. Today is a weekday, so the fix must not
    // add any weekend column — the week renders Mon–Fri only.
    await page.clock.setFixedTime(new Date(2026, 5, 24, 10, 0, 0));

    await login(page, 'admin');
    await page.goto('/backend/calendar');
    await waitForCalendarLoaded(page);

    // Today's weekday column is present…
    await expect(page.getByText(/\b24\s+WED\b/).first()).toBeVisible();
    // …and neither weekend day is rendered.
    await expect(page.getByText(/\bSAT\b/).first()).toBeHidden();
    await expect(page.getByText(/\bSUN\b/).first()).toBeHidden();
  });

  test('toggling Show weekends ON still reveals the full weekend (Sat + Sun)', async ({ page }) => {
    test.slow();

    await page.clock.setFixedTime(new Date(2026, 5, 27, 10, 0, 0));

    try {
      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);

      // Default OFF: today's Saturday column shows, Sunday is hidden.
      await expect(page.getByText(/\b27\s+SAT\b/).first()).toBeVisible();
      await expect(page.getByText(/\bSUN\b/).first()).toBeHidden();

      // Enable "Show weekends" via the settings modal and save.
      await page.getByRole('button', { name: 'Calendar settings' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const weekendSwitch = dialog.getByRole('switch', { name: 'Show weekends' });
      await expect(weekendSwitch).not.toBeChecked();
      await weekendSwitch.click();
      await expect(weekendSwitch).toBeChecked();
      await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
      await expect(dialog).toBeHidden();

      // Now the whole weekend renders (Mon–Sun): both Sat and Sun headers visible.
      await expect(page.getByText(/\bSAT\b/).first()).toBeVisible();
      await expect(page.getByText(/\bSUN\b/).first()).toBeVisible();
    } finally {
      // Reset the per-user preference so the localStorage state does not leak into
      // other specs sharing this browser profile across retries.
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
    }
  });
});
