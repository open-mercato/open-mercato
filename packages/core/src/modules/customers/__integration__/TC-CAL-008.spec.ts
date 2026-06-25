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
 * Drag-to-create is covered by a second test below: a real-mouse drag over an
 * empty grid cell (resolved via `elementFromPoint` so it never lands on a block)
 * opens the create editor with the dragged time prefilled — exercising the
 * pointer→onCreateRange→editor `defaultRange` wiring. The pure drag time math is
 * additionally unit-tested in `lib/calendar/grid.ts`.
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
  // Targets a point where the topmost element is the drag layer (`.cursor-cell`), so
  // the drag never lands on an event block (which would open the peek instead).
  test('dragging empty week-grid space opens the create editor with the dragged time prefilled', async ({ page }) => {
    test.slow();
    await login(page, 'admin');
    await page.goto('/backend/calendar');
    await waitForCalendarLoaded(page);

    const coords = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.overflow-auto');
      const layers = Array.from(document.querySelectorAll<HTMLElement>('.cursor-cell'));
      if (!scroller || layers.length === 0) return null;
      // Scroll into a late-day region where seeded/demo events are unlikely.
      scroller.scrollTop = Math.floor(scroller.scrollHeight * 0.6);
      const viewport = scroller.getBoundingClientRect();
      for (const layer of layers) {
        const rect = layer.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        for (let fraction = 0.3; fraction < 0.75; fraction += 0.05) {
          const y = viewport.top + viewport.height * fraction;
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.classList.contains('cursor-cell')) {
            return { x, y0: y, y1: Math.min(y + 130, viewport.bottom - 16) };
          }
        }
      }
      return null;
    });
    expect(coords, 'found empty grid space to drag on').not.toBeNull();

    await page.mouse.move(coords!.x, coords!.y0);
    await page.mouse.down();
    await page.mouse.move(coords!.x, (coords!.y0 + coords!.y1) / 2, { steps: 6 });
    await page.mouse.move(coords!.x, coords!.y1, { steps: 6 });
    await page.mouse.up();

    const editor = page.getByRole('dialog');
    await expect(editor).toBeVisible();
    await expect(editor.getByText('New event').first()).toBeVisible();
    // The dragged range prefilled the schedule — the start time input is populated.
    await expect(editor.locator('input[type="time"]').first()).not.toHaveValue('');

    // No fixture was saved; just dismiss the editor.
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
  });
});
