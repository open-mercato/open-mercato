import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  escapeRegExp,
  findInteractionIdByTitle,
  INTERACTIONS_PATH,
  pressKeyUntil,
  seedShowWeekendsPreference,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures';

/**
 * TC-CAL-005: Create an event through the calendar editor.
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md ("Integration Test Coverage",
 * updated scenario: editor with type switcher).
 *
 * - `N` opens the typed editor dialog ("New event").
 * - Switching the type tab morphs the field set: Task shows Due + Priority
 *   (+ Assignee), Meeting shows Starts/Ends without Priority.
 * - Fill Title + pick the fixture person in the Related-to picker, keep the
 *   default schedule, Save → success flash ("Event saved") and the new item
 *   appears without a page reload.
 *
 * Determinism: the editor defaults the start to the next full hour, which on a
 * real late-evening run rolls past midnight — the 90-minute event then renders
 * in TWO day columns (two buttons with the same aria-label) and, on Sunday
 * nights, past the visible week. To remove that root cause the browser clock is
 * frozen (via `page.clock.setFixedTime`, matching TC-CAL-007/010) to a weekday
 * mid-day anchor BEFORE navigation, so the editor's default start is a fixed
 * 11:00 that can never straddle midnight regardless of the real wall clock. All
 * Node-side time math (default-start mirror, teardown window) is derived from
 * that same anchor so the API teardown still resolves the record. The item
 * locator additionally keeps `.first()` as defense in depth.
 *
 * Teardown resolves the created interaction id via the API (by exact title,
 * scoped to the fixture person) and deletes it along with the person.
 */
test.describe('TC-CAL-005: Create event via calendar editor', () => {
  test('N opens editor; type switcher morphs fields; save flashes and renders the new item without reload', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const eventTitle = `QA Cal Editor ${stamp}`;
    const personName = `CalEditor Person ${stamp}`;
    let adminToken: string | null = null;
    let personId: string | null = null;
    let createdInteractionId: string | null = null;

    // Wed, 2026-06-24 10:00 local — frozen before navigation so the browser
    // computes "today" (and the editor's default start of 11:00) from it on first
    // render. A fixed weekday mid-day start can never straddle midnight, so the
    // created event stays in a single day column no matter when the suite runs.
    const fixedNow = new Date(2026, 5, 24, 10, 0, 0);
    await page.clock.setFixedTime(fixedNow);

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalEditor',
        lastName: `Person${stamp}`,
        displayName: personName,
      });

      // Force "Show weekends" on so the created event is visible on the grid
      // regardless of the anchor day.
      await seedShowWeekendsPreference(page, scope.userId);

      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);

      // -- N opens the editor ---------------------------------------------------
      const dialog = page.getByRole('dialog');
      await pressKeyUntil(page, 'n', async () => {
        await expect(dialog).toBeVisible({ timeout: 2_000 });
      });
      await expect(dialog.getByText('New event').first()).toBeVisible();

      // -- Type switcher: Task shows Due + Priority + Assignee -------------------
      const typeSwitcher = dialog.getByRole('group', { name: 'Event type' });
      await expect(typeSwitcher.getByRole('button', { name: 'Meeting', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await typeSwitcher.getByRole('button', { name: 'Task', exact: true }).click();
      await expect(typeSwitcher.getByRole('button', { name: 'Task', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog.getByText('Due', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('group', { name: 'Priority' })).toBeVisible();
      await expect(dialog.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'Medium', exact: true })).toBeVisible();
      await expect(dialog.getByText('Assignee', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Starts', { exact: true })).toBeHidden();

      // -- Back to Meeting: Starts/Ends return, Priority leaves ------------------
      await typeSwitcher.getByRole('button', { name: 'Meeting', exact: true }).click();
      await expect(dialog.getByText('Starts', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Ends', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('group', { name: 'Priority' })).toBeHidden();

      // Mirror the editor's default start (next full hour) from the same frozen
      // anchor the browser renders under — deterministically 11:00 on the anchor day.
      const defaultStart = new Date(fixedNow);
      defaultStart.setHours(fixedNow.getHours() + 1, 0, 0, 0);

      // -- Title + Related-to person picker --------------------------------------
      await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(eventTitle);
      await dialog.getByRole('button', { name: 'Related to', exact: true }).click();
      const relatedSearch = dialog.getByRole('textbox', { name: 'Search people or companies…' });
      await relatedSearch.fill(personName);
      await dialog.getByRole('option', { name: new RegExp(escapeRegExp(personName)) }).first().click();
      await expect(dialog.getByText(personName).first()).toBeVisible();
      // Refocus a neutral field so the related-to dropdown closes before saving.
      await dialog.getByRole('textbox', { name: 'Title', exact: true }).click();

      // -- Save: flash + dialog closes -------------------------------------------
      await dialog.getByRole('button', { name: 'Save event', exact: true }).click();
      await expect(page.getByText('Event saved').first()).toBeVisible();
      await expect(dialog).toBeHidden();

      // Regression guard for #3721: the frozen anchor must keep the default 90-min
      // event inside a single calendar day. If a future anchor change reintroduces a
      // midnight-spanning slot, this fails fast here rather than as a strict-mode flake.
      const defaultEnd = new Date(defaultStart.getTime() + 90 * 60 * 1000);
      expect(
        defaultStart.getDate(),
        'Frozen anchor should keep the default event within one day (no midnight span)',
      ).toBe(defaultEnd.getDate());

      // -- The new item renders without reload -----------------------------------
      // The frozen anchor makes the default start (Wed 11:00) deterministically fall in
      // the visible week, so the grid assertion is unconditional. `.first()` stays as
      // defense in depth: an event whose slot crossed midnight would render in BOTH day
      // cells (two buttons with the same aria-label) and trip Playwright strict mode.
      const itemLocator = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(eventTitle)}`) }).first();
      await expect(itemLocator).toBeVisible();
      await pressKeyUntil(page, 'a', async () => {
        await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible({ timeout: 1_000 });
      });
      await expect(itemLocator).toBeVisible();

      // -- Resolve the created id for teardown ------------------------------------
      // Anchor the search window to the frozen clock: the event was persisted with the
      // browser's (frozen) start, so a real-time window would miss it entirely.
      createdInteractionId = await findInteractionIdByTitle(request, adminToken, {
        entityId: personId,
        title: eventTitle,
        from: new Date(fixedNow.getFullYear(), fixedNow.getMonth(), fixedNow.getDate() - 1, 0, 0, 0, 0),
        to: new Date(fixedNow.getFullYear(), fixedNow.getMonth(), fixedNow.getDate() + 8, 0, 0, 0, 0),
      });
      expect(createdInteractionId, 'Created calendar event should be resolvable through the API').toBeTruthy();
    } finally {
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, createdInteractionId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
