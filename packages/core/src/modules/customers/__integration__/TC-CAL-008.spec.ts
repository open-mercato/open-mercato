import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  escapeRegExp,
  gridBlockName,
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
 *   label contains the title and "9:00"). The popover shows the title, the
 *   date and time rows, and an **Edit** button.
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
 * Dense overlaps (#7500) are covered by a third test: six meetings sharing one
 * slot collapse into the readable blocks the column width allows plus one
 * "+N more" overflow block whose popover lists every hidden meeting with its
 * full title and time range; clicking a row opens the event editor directly.
 * The width policy itself (how many columns fit) is unit-tested in
 * `components/calendar/__tests__/TimeGrid.dense.test.tsx`.
 *
 * A fourth test covers #8867: when a long block keeps a whole afternoon in one
 * dense cluster, a hidden meeting hours later stays at its own start time and
 * the "+N more" slot covers only the meetings it really overlaps.
 *
 * Determinism notes:
 * - The default Playwright viewport (1280px) boots the calendar in Week view.
 * - Both fixtures are anchored to **this week's Monday at 09:00** (overlapping:
 *   09:00–10:30 and 09:30–11:00). Monday is always inside the visible Mon–Fri
 *   week (weekends default OFF), so the blocks render regardless of the run day,
 *   and they share `ownerUserId` so `findConflicts` pairs them. A retry moves two
 *   hours later so it cannot stack with meetings a timed-out attempt left behind.
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
    const slotHour = 9 + test.info().retry * 2;
    const startA = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), slotHour, 0, 0, 0);
    const startB = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), slotHour, 30, 0, 0);

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

      // The block accessible name is `${title}, ${timeRange}`; the start renders
      // its hour in the range, so anchor on title + start time.
      const blockA = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(titleA)},.*${slotHour}:00`) });
      await expect(blockA).toBeVisible();

      // -- Inline conflict badge (Conflict warnings default ON) ------------------
      const conflictBadge = page.getByText(/\d+\s+conflicts?/i).first();
      await expect(conflictBadge).toBeVisible();

      // -- Clicking the block opens the peek popover -----------------------------
      await blockA.click();
      // The peek is a Radix Popover (not a [role=dialog]); scope the assertions
      // to the open popover content: its time row and the Edit button (grid
      // blocks have no Edit affordance).
      const peek = page.locator('[data-slot="popover-content"][data-state="open"]');
      await expect(peek.getByText(new RegExp(`${slotHour}:00`)).first()).toBeVisible();
      const peekEdit = peek.getByRole('button', { name: 'Edit', exact: true });
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

  // Click-to-create: a plain click on an empty half-hour slot opens the create
  // editor prefilled with that slot, no drag required.
  test('clicking an empty week-grid slot opens the create editor prefilled with that half hour', async ({ page }) => {
    test.slow();
    await login(page, 'admin');
    await page.goto('/backend/calendar');
    await waitForCalendarLoaded(page);

    const emptyGridSearch = `__qa_empty_click_${Date.now()}__`;
    const searchInput = page.locator('[data-calendar-search]');
    await searchInput.fill(emptyGridSearch);
    await searchInput.blur();

    const dragLayer = page.locator('.cursor-cell').first();
    const scroller = dragLayer.locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " overflow-auto ")][1]',
    );
    await expect(dragLayer).toBeVisible();
    const [layerBox, scrollerBox] = await Promise.all([dragLayer.boundingBox(), scroller.boundingBox()]);
    expect(layerBox).not.toBeNull();
    expect(scrollerBox).not.toBeNull();
    const point = { x: layerBox!.x + layerBox!.width / 2, y: scrollerBox!.y + scrollerBox!.height * 0.5 };

    // Hovering highlights the slot under the pointer before any click.
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('[data-calendar-hover-slot]')).toHaveCount(1);

    await page.mouse.click(point.x, point.y);
    const editor = page.getByRole('dialog');
    await expect(editor).toBeVisible();
    await expect(editor.getByText('New event').first()).toBeVisible();
    await expect(editor.getByRole('combobox', { name: 'Starts' })).toContainText(/\d{1,2}:(00|30)/);
    await expect(editor.getByRole('combobox', { name: 'Ends' })).toContainText(/\d{1,2}:(00|30)/);

    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
  });

  // Dense overlaps (#7500): six simultaneous meetings must stay individually
  // discoverable. The cluster sits on Wednesday 14:20–15:40 so it can never merge
  // with the Monday 09:00 conflict fixtures above, and the odd time range makes
  // the overflow block's accessible name (`N more events, 2:20 – 3:40 PM`) unique
  // against any seeded data.
  test('six simultaneous meetings collapse into an overflow list that still opens every peek', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const runToken = `QA Cal Dense ${stamp}`;
    const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map((name) => `${runToken} ${name}`);
    let adminToken: string | null = null;
    let personId: string | null = null;
    const meetingIds: string[] = [];

    const monday = mondayWeekRange(new Date()).from;
    const wednesdayStart = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 2, 14, 20, 0, 0);

    try {
      adminToken = await getAuthToken(request, 'admin');
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalDense',
        lastName: `Person${stamp}`,
        displayName: `CalDense Person ${stamp}`,
      });
      for (const title of titles) {
        meetingIds.push(
          await createInteractionFixture(request, adminToken, {
            entityId: personId,
            interactionType: 'meeting',
            title,
            status: 'planned',
            scheduledAt: wednesdayStart,
            durationMinutes: 80,
          }),
        );
      }

      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);

      const overflow = page.getByRole('button', { name: /more events, .*2:20.*3:40/ });
      await expect(overflow).toHaveCount(1);
      await overflow.scrollIntoViewIfNeeded();
      await expect(overflow).toBeVisible();
      await expect(overflow).toHaveText(/\+\d+ more/);

      // -- Containment: the overflow block stays inside its day column -----------
      const dayColumn = overflow.locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " flex-1 ")][1]',
      );
      const [overflowBox, columnBox] = await Promise.all([overflow.boundingBox(), dayColumn.boundingBox()]);
      expect(overflowBox, 'overflow block should have a bounding box').not.toBeNull();
      expect(columnBox, 'day column should have a bounding box').not.toBeNull();
      expect(overflowBox!.x).toBeGreaterThanOrEqual(columnBox!.x - 0.5);
      expect(overflowBox!.x + overflowBox!.width).toBeLessThanOrEqual(columnBox!.x + columnBox!.width + 0.5);

      // -- Disclosure lists every hidden meeting with full title + time range ----
      const runBlocks = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(runToken)} `) });
      const visibleBlockCount = await runBlocks.count();
      expect(visibleBlockCount).toBeLessThan(titles.length);
      await overflow.click();
      await expect(page.getByText(/\d+ overlapping events/)).toBeVisible();
      const list = page.getByRole('list').filter({ has: runBlocks });
      await expect(list).toBeVisible();
      const rows = list.getByRole('button', { name: new RegExp(`^${escapeRegExp(runToken)} `) });
      await expect(rows).toHaveCount(titles.length - visibleBlockCount);
      await expect(list.getByText(/2:20.*3:40/).first()).toBeVisible();
      for (const title of titles) {
        await expect(page.getByRole('button', { name: gridBlockName(title) })).toHaveCount(1);
      }

      // -- A row opens the editor directly (no intermediate peek) ----------------
      const firstRow = rows.first();
      const firstRowTitle = (await firstRow.getAttribute('aria-label'))?.split(', ')[0] ?? '';
      expect(titles).toContain(firstRowTitle);
      await firstRow.click();
      // Scope by accessible name: the overflow popover is a Radix popover
      // content (role=dialog) that lingers briefly while animating out.
      const editor = page.getByRole('dialog', { name: 'Edit event' });
      await expect(editor).toBeVisible();
      await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(firstRowTitle);
      await page.keyboard.press('Escape');
      await expect(editor).toBeHidden();

      // -- Keyboard: the overflow block is focusable and opens with Enter --------
      await overflow.focus();
      await expect(overflow).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByText(/\d+ overlapping events/)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByText(/\d+ overlapping events/)).toBeHidden();

      // -- Narrower viewport: the treatment still holds and stays contained ------
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(overflow).toHaveCount(1);
      await overflow.scrollIntoViewIfNeeded();
      const [narrowOverflowBox, narrowColumnBox] = await Promise.all([overflow.boundingBox(), dayColumn.boundingBox()]);
      expect(narrowOverflowBox).not.toBeNull();
      expect(narrowColumnBox).not.toBeNull();
      expect(narrowOverflowBox!.x + narrowOverflowBox!.width).toBeLessThanOrEqual(
        narrowColumnBox!.x + narrowColumnBox!.width + 0.5,
      );
    } finally {
      for (const meetingId of meetingIds) {
        await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingId);
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
  // #8867: a full-day block plus a burst of calls at 10:10 and a demo at 15:10
  // on Thursday. The calls collapse into a "+N more" slot of their own; the demo
  // must stay drawn at 15:10 instead of being pulled into that slot.
  test('a later meeting keeps its own time slot when an earlier burst collapses', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const runToken = `QA Cal Burst ${stamp}`;
    const trainingTitle = `${runToken} Training`;
    const callTitles = ['Call A', 'Call B', 'Call C', 'Call D'].map((name) => `${runToken} ${name}`);
    const demoTitle = `${runToken} Demo`;
    let adminToken: string | null = null;
    let personId: string | null = null;
    const meetingIds: string[] = [];

    const monday = mondayWeekRange(new Date()).from;
    const thursdayAt = (hours: number, minutes: number) =>
      new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3, hours, minutes, 0, 0);

    try {
      adminToken = await getAuthToken(request, 'admin');
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalBurst',
        lastName: `Person${stamp}`,
        displayName: `CalBurst Person ${stamp}`,
      });
      const meetings = [
        { title: trainingTitle, scheduledAt: thursdayAt(9, 10), durationMinutes: 470 },
        ...callTitles.map((title) => ({ title, scheduledAt: thursdayAt(10, 10), durationMinutes: 45 })),
        { title: demoTitle, scheduledAt: thursdayAt(15, 10), durationMinutes: 60 },
      ];
      for (const meeting of meetings) {
        meetingIds.push(
          await createInteractionFixture(request, adminToken, {
            entityId: personId,
            interactionType: 'meeting',
            status: 'planned',
            ...meeting,
          }),
        );
      }

      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);

      const overflow = page.getByRole('button', { name: /more events, .*10:10.*10:55/ });
      await expect(overflow, 'the calls collapse into a slot of their own').toHaveCount(1);
      await expect(
        page.getByRole('button', { name: /more events, .*10:10.*4:10/ }),
        'no slot stretches from the calls to the demo',
      ).toHaveCount(0);

      const demo = page.getByRole('button', { name: gridBlockName(demoTitle) });
      await expect(demo, 'the demo is drawn as its own block').toHaveCount(1);
      await demo.scrollIntoViewIfNeeded();
      await expect(demo).toBeVisible();
      await overflow.scrollIntoViewIfNeeded();
      const [overflowBox, demoBox] = await Promise.all([overflow.boundingBox(), demo.boundingBox()]);
      expect(overflowBox, 'overflow block should have a bounding box').not.toBeNull();
      expect(demoBox, 'demo block should have a bounding box').not.toBeNull();
      expect(demoBox!.y, 'the demo sits below the collapsed calls').toBeGreaterThan(overflowBox!.y + overflowBox!.height);
    } finally {
      for (const meetingId of meetingIds) {
        await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingId);
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
