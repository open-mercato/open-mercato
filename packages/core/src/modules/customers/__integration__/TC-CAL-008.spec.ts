import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  escapeRegExp,
  INTERACTIONS_PATH,
  mondayWeekRange,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures';

/**
 * TC-CAL-008: Week-view states (peek popover + edit + inline conflict badge).
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md ("Integration Test Coverage",
 * Figma `1786:2934`).
 *
 * - Clicking a time-grid event block opens the `EventPeekPopover` (the block is
 *   a `button` whose accessible name is `${title}, ${timeRange}` — e.g. the
 *   label contains the title and "9:00"). The popover shows the title, a
 *   `EEE, MMM d · h:mm` date·time line, and an **Edit** button.
 * - Clicking the popover's **Edit** opens the full `CalendarEventEditor` in edit
 *   mode ("Edit event" dialog) with the title prefilled.
 * - With two overlapping planned meetings sharing an owner, the time-grid column
 *   renders an inline error-tint "N conflicts" badge (Conflict warnings default
 *   ON). Toggling **Conflict warnings** OFF in the settings modal + Save removes
 *   the badge.
 *
 * Drag-to-create is covered by a second test below: a unique search filter first
 * removes every event block from the rendered grid, then a real-mouse drag over
 * one fixed cell opens the create editor with the dragged time prefilled. This
 * exercises the pointer→onCreateRange→editor `defaultRange` wiring without
 * relying on seeded event placement. The pure drag time math is additionally
 * unit-tested in `lib/calendar/grid.ts`.
 *
 * Determinism notes:
 * - The default Playwright viewport (1280px) boots the calendar in Week view.
 * - Both fixtures are anchored to **this week's Monday at 09:00** (overlapping:
 *   09:00–10:30 and 09:30–11:00). Monday is always inside the visible Mon–Fri
 *   week (weekends default OFF), so the blocks render regardless of the run day,
 *   and they share `ownerUserId` so `findConflicts` pairs them.
 * - A unique run token in both titles keeps seeded/demo interactions from
 *   colliding with the assertions.
 */
test.describe('TC-CAL-008: Calendar week-view states', () => {
  test('block click opens the peek popover with Edit; overlapping meetings show the conflict badge until Conflict warnings is off', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const runToken = `QA Cal States ${stamp}`;
    const titleA = `${runToken} A`;
    const titleB = `${runToken} B`;
    let adminToken: string | null = null;
    let personId: string | null = null;
    let meetingAId: string | null = null;
    let meetingBId: string | null = null;

    // This week's Monday at 09:00 — always inside the visible Mon–Fri week.
    const monday = mondayWeekRange(new Date()).from;
    const startA = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 9, 0, 0, 0);
    const startB = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 9, 30, 0, 0);

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalStates',
        lastName: `Person${stamp}`,
        displayName: `CalStates Person ${stamp}`,
      });
      meetingAId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: titleA,
        status: 'planned',
        scheduledAt: startA,
        durationMinutes: 90,
        ownerUserId: scope.userId,
      });
      meetingBId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: titleB,
        status: 'planned',
        scheduledAt: startB,
        durationMinutes: 90,
        ownerUserId: scope.userId,
      });

      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);

      // The block accessible name is `${title}, ${timeRange}`; the 09:00 start
      // renders a "9:00" token in the range, so anchor on title + "9:00".
      const blockA = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(titleA)},.*9:00`) });
      await expect(blockA).toBeVisible();

      // -- Inline conflict badge (Conflict warnings default ON) ------------------
      const conflictBadge = page.getByText(/\d+\s+conflicts?/i).first();
      await expect(conflictBadge).toBeVisible();

      // -- Clicking the block opens the peek popover -----------------------------
      await blockA.click();
      // The peek is a Radix Popover (not a [role=dialog]); assert on its
      // peek-unique content: the `EEE, MMM d · h:mm` date·time line (the "·"
      // separator does not appear on the grid block) and the Edit button (grid
      // blocks have no Edit affordance).
      await expect(page.getByText(/·.*9:00/).first()).toBeVisible();
      const peekEdit = page.getByRole('button', { name: 'Edit', exact: true });
      await expect(peekEdit).toBeVisible();

      // -- Edit opens the editor in edit mode with the title prefilled -----------
      await peekEdit.click();
      const editor = page.getByRole('dialog');
      await expect(editor).toBeVisible();
      await expect(editor.getByText('Edit event').first()).toBeVisible();
      await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(titleA);
      // Close the editor (Escape cancels) before touching the settings modal.
      await page.keyboard.press('Escape');
      await expect(editor).toBeHidden();

      // -- Toggling Conflict warnings OFF removes the badge ----------------------
      await page.getByRole('button', { name: 'Calendar settings' }).click();
      const settings = page.getByRole('dialog');
      await expect(settings).toBeVisible();
      await expect(settings.getByText('Customization').first()).toBeVisible();
      const conflictSwitch = settings.getByRole('switch', { name: 'Conflict warnings' });
      await expect(conflictSwitch).toBeChecked();
      await conflictSwitch.click();
      await expect(conflictSwitch).not.toBeChecked();
      await settings.getByRole('button', { name: 'Save Changes', exact: true }).click();
      await expect(settings).toBeHidden();

      // The inline conflict badge is gone; the blocks still render.
      await expect(page.getByText(/\d+\s+conflicts?/i)).toHaveCount(0);
      await expect(blockA).toBeVisible();
    } finally {
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
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingAId);
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingBId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });

  // Real-mouse drag-to-create: covers the end-to-end pointer→onCreateRange→editor
  // `defaultRange` wiring that the grid.ts unit tests (pure time math) cannot reach.
  // A per-run search token guarantees the rendered grid contains no event blocks.
  // The drag targets one fixed point in the first weekday layer instead of scanning
  // the viewport for somewhere that happens to be empty.
  test('dragging empty week-grid space opens the create editor with the dragged time prefilled', async ({ page }) => {
    test.slow();
    await login(page, 'admin');
    await page.goto('/backend/calendar');
    await waitForCalendarLoaded(page);

    const emptyGridSearch = `__qa_empty_drag_${Date.now()}__`;
    const searchInput = page.locator('[data-calendar-search]');
    await searchInput.fill(emptyGridSearch);
    await searchInput.blur();

    const dragLayer = page.locator('.cursor-cell').first();
    const scroller = dragLayer.locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " overflow-auto ")][1]',
    );
    await expect(dragLayer, 'week grid should expose a drag layer').toBeVisible();

    await expect.poll(async () => {
      const [layerBox, scrollerBox] = await Promise.all([
        dragLayer.boundingBox(),
        scroller.boundingBox(),
      ]);
      if (!layerBox || !scrollerBox) return false;
      const x = layerBox.x + layerBox.width / 2;
      const y = scrollerBox.y + scrollerBox.height * 0.45;
      return page.evaluate(
        ({ clientX, clientY }) =>
          document.elementFromPoint(clientX, clientY)?.classList.contains('cursor-cell') === true,
        { clientX: x, clientY: y },
      );
    }, {
      message: `search filter ${emptyGridSearch} should expose the fixed drag target`,
    }).toBe(true);

    const [layerBox, scrollerBox] = await Promise.all([
      dragLayer.boundingBox(),
      scroller.boundingBox(),
    ]);
    expect(layerBox, 'fixed weekday drag layer should have a bounding box').not.toBeNull();
    expect(scrollerBox, 'week grid scroller should have a bounding box').not.toBeNull();
    const coords = {
      x: layerBox!.x + layerBox!.width / 2,
      y0: scrollerBox!.y + scrollerBox!.height * 0.45,
      y1: scrollerBox!.y + scrollerBox!.height * 0.65,
    };

    await page.mouse.move(coords.x, coords.y0);
    await page.mouse.down();
    await page.mouse.move(coords.x, (coords.y0 + coords.y1) / 2, { steps: 6 });
    await page.mouse.move(coords.x, coords.y1, { steps: 6 });
    await page.mouse.up();

    const editor = page.getByRole('dialog');
    await expect(editor).toBeVisible();
    await expect(editor.getByText('New event').first()).toBeVisible();
    // The dragged range prefilled the schedule — the start time (DS Select) shows a value.
    await expect(editor.getByRole('combobox', { name: 'Starts' })).toContainText(/\d{1,2}:\d{2}/);

    // No fixture was saved; just dismiss the editor.
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
  });
});
