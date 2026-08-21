import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  escapeRegExp,
  findInteractionIdByTitle,
  INTERACTIONS_PATH,
  localTimeAt,
  mondayWeekRange,
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
 * The editor defaults the start to the next full hour, which can roll past
 * midnight (and, on Sunday nights, past the visible week). The agenda view
 * window (today..+7d) always contains the default start, so presence is
 * asserted there; the week-grid assertion runs only when the expected start
 * deterministically falls inside the current Monday-start week.
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

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalEditor',
        lastName: `Person${stamp}`,
        displayName: personName,
      });

      // The editor defaults new events to today's anchor — force "Show weekends" on
      // so the created event is visible on the grid even on a weekend.
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
      // Priority is a Jira-style dropdown (trigger button labelled "Priority",
      // showing the current value); it defaults to Medium (#3552).
      const priorityTrigger = dialog.getByRole('button', { name: 'Priority', exact: true });
      await expect(priorityTrigger).toBeVisible();
      await expect(priorityTrigger).toContainText('Medium');
      await expect(dialog.getByText('Assignee', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Starts', { exact: true })).toBeHidden();

      // -- Back to Meeting: Starts/Ends return, Priority leaves ------------------
      await typeSwitcher.getByRole('button', { name: 'Meeting', exact: true }).click();
      await expect(dialog.getByText('Starts', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Ends', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Priority', exact: true })).toBeHidden();

      // Capture the editor's default start (next full hour) right after the
      // form state exists, mirroring createDefaultFormState.
      const defaultStart = new Date();
      defaultStart.setHours(defaultStart.getHours() + 1, 0, 0, 0);

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

      // -- The new item renders without reload -----------------------------------
      // `.first()`: an event whose default slot crosses midnight (e.g. 11:00 PM–12:30 AM, which the
      // editor produces when the test runs late in the day) correctly renders in BOTH day cells it
      // spans, so a bare locator matches 2 buttons and trips Playwright strict mode. The assertion's
      // intent is only "the event rendered", so target the first instance.
      const itemLocator = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(eventTitle)}`) }).first();
      const currentWeek = mondayWeekRange(new Date());
      if (defaultStart.getTime() >= currentWeek.from.getTime() && defaultStart.getTime() <= currentWeek.to.getTime()) {
        await expect(itemLocator).toBeVisible();
      }
      await pressKeyUntil(page, 'a', async () => {
        await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible({ timeout: 1_000 });
      });
      await expect(itemLocator).toBeVisible();

      // -- Resolve the created id for teardown ------------------------------------
      createdInteractionId = await findInteractionIdByTitle(request, adminToken, {
        entityId: personId,
        title: eventTitle,
        from: localTimeAt(-1, 0, 0),
        to: localTimeAt(8, 0, 0),
      });
      expect(createdInteractionId, 'Created calendar event should be resolvable through the API').toBeTruthy();
    } finally {
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, createdInteractionId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
