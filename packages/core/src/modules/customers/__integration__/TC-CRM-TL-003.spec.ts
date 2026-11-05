import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { addBuckets, addDays, shiftCloseDate, toUtcDateKey } from '@open-mercato/core/modules/customers/lib/dealsTimeline';
import {
  addTimelineDeal,
  cleanupTimelineScope,
  createTimelineScope,
  installDevNoticeHandler,
  loginWithCredentials,
  openTimeline,
  readDateKey,
  readDeal,
  timelineCard,
  timelineCell,
  type TimelineFixtureScope,
} from './helpers/timelineFixtures';
import { expectFocusedDeal, utcMonthDayLabel } from './helpers/timelineUi';

/**
 * TC-CRM-TL-003: Deals timeline rescheduling (UI, Phase 2)
 * Spec: .ai/specs/2026-10-26-deals-close-date-timeline.md → Integration Test Coverage (TC-CRM-TL-003)
 *
 * Default week window: column 0 = last week, 1 = this week, 2..4 = following weeks.
 */

const PASSWORD = 'Secret123!';

function todayKey(): string {
  return toUtcDateKey(new Date()) as string;
}

async function closeDateOf(request: Parameters<typeof readDeal>[0], token: string, dealId: string): Promise<string | null> {
  return readDateKey(await readDeal(request, token, dealId), 'expectedCloseAt', 'expected_close_at');
}

async function dragCardTo(page: Page, card: Locator, target: Locator): Promise<void> {
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('[internal] drag source or target not rendered');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 40), { steps: 20 });
  await page.mouse.up();
}

async function changeDateInDrawer(page: Page, dateKey: string): Promise<void> {
  const drawer = page.getByTestId('timeline-deal-drawer');
  await drawer.getByRole('button', { name: 'Change close date' }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.locator('input[type="date"]') });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="date"]').fill(dateKey);
  await dialog.locator('input[type="date"]').press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await expect(dialog).toBeHidden();
}

async function cardColumn(page: Page, dealId: string): Promise<number | null> {
  return page
    .locator(`[data-timeline-cell]:has([data-timeline-card][data-deal-id="${dealId}"])`)
    .first()
    .getAttribute('data-column', { timeout: 2_000 })
    .then((value) => (value === null ? null : Number(value)))
    .catch(() => null);
}

async function wonThisQuarterCount(request: Parameters<typeof readDeal>[0], token: string): Promise<number> {
  const response = await apiRequest(request, 'GET', '/api/customers/deals/summary', { token });
  expect(response.status(), await response.text()).toBe(200);
  const body = await readJsonSafe<{ wonThisQuarter?: { dealsClosed?: number } }>(response);
  return Number(body?.wonThisQuarter?.dealsClosed ?? Number.NaN);
}

function isDealPut(request: { method: () => string; url: () => string }): boolean {
  return request.method() === 'PUT' && new URL(request.url()).pathname === '/api/customers/deals';
}

type DealPutHold = { release: () => Promise<void>; dispose: () => Promise<void>; held: () => number };

const DEAL_PUT_ROUTE = '**/api/customers/deals';

async function holdDealPuts(page: Page): Promise<DealPutHold> {
  const pending: Array<() => Promise<void>> = [];
  let holding = true;
  const handler = async (route: Route) => {
    if (route.request().method() !== 'PUT' || !holding) {
      await route.continue();
      return;
    }
    await new Promise<void>((resolve) => {
      pending.push(async () => {
        await route.continue().catch(() => undefined);
        resolve();
      });
    });
  };
  await page.route(DEAL_PUT_ROUTE, handler);
  const release = async () => {
    holding = false;
    while (pending.length) await (pending.shift() as () => Promise<void>)();
  };
  return {
    held: () => pending.length,
    release,
    dispose: async () => {
      await release();
      await page.unroute(DEAL_PUT_ROUTE, handler).catch(() => undefined);
    },
  };
}

async function waitForPointerReady(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.body.style.pointerEvents), { timeout: 10_000 }).not.toBe('none');
}

async function expectDraggable(card: Locator): Promise<void> {
  await expect(card, 'the card accepts a drag again').toHaveClass(/cursor-grab/, { timeout: 30_000 });
}

async function waitForBoardIdle(page: Page): Promise<void> {
  await expect(page.getByRole('grid').first(), 'no timeline refetch is in flight').toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
}

function trackDealPuts(page: Page): { sent: () => number; statuses: number[] } {
  let sent = 0;
  const statuses: number[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/customers/deals') sent += 1;
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/customers/deals') statuses.push(response.status());
  });
  return { sent: () => sent, statuses };
}

test.describe('TC-CRM-TL-003: deals timeline rescheduling', () => {
  test('drag one week later moves the card, updates the date and aria-label; Undo restores it', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 Drag');
      const dealId = await addTimelineDeal(request, token, scope, { title: `TL003 Drag ${scope.stamp}`, date: today, ownerUserId: adminUserId });
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      const card = timelineCard(page, dealId);
      await expect(card).toBeVisible();

      await dragCardTo(page, card, timelineCell(page, adminUserId, 2));
      const expected = shiftCloseDate(today, 'week', 1);
      await expect(timelineCell(page, adminUserId, 2).locator(`[data-deal-id="${dealId}"]`)).toBeVisible();
      await expect.poll(() => closeDateOf(request, token, dealId), { timeout: 15_000 }).toBe(expected);
      await expect(timelineCard(page, dealId)).toHaveAttribute('aria-label', utcMonthDayLabel(expected));

      const undo = page.getByRole('button', { name: /^undo$/i }).first();
      await expect(undo).toBeVisible({ timeout: 15_000 });
      await undo.click();
      await expect.poll(() => closeDateOf(request, token, dealId), { timeout: 20_000 }).toBe(today);
      await expect(timelineCell(page, adminUserId, 1).locator(`[data-deal-id="${dealId}"]`)).toBeVisible({ timeout: 30_000 });
      await expect(timelineCard(page, dealId)).toHaveAttribute('aria-label', utcMonthDayLabel(today));
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('keyboard path: Enter opens the drawer, Change close date with Cmd/Ctrl+Enter moves the card', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    const target = addDays(addBuckets(today, 'week', 2), 2);
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 Keyboard');
      const dealId = await addTimelineDeal(request, token, scope, { title: `TL003 Key ${scope.stamp}`, date: today, ownerUserId: adminUserId });
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      const card = timelineCard(page, dealId);
      await card.focus();
      await page.keyboard.press('Enter');
      const drawer = page.getByTestId('timeline-deal-drawer');
      await expect(drawer).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expectFocusedDeal(page, dealId);

      await page.keyboard.press('Enter');
      await expect(drawer).toBeVisible();
      await changeDateInDrawer(page, target);
      await expect.poll(() => closeDateOf(request, token, dealId), { timeout: 15_000 }).toBe(target);
      await expect(drawer.getByTestId('timeline-drawer-close-date')).toContainText(utcMonthDayLabel(target));
      await page.keyboard.press('Escape');
      await expect(timelineCell(page, adminUserId, 3).locator(`[data-deal-id="${dealId}"]`)).toBeVisible();
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('destination not visible: Show deal receives focus and moves the window; popover rows reschedule hidden deals', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    const farDate = addBuckets(today, 'week', 10);
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 Far');
      const movedId = await addTimelineDeal(request, token, scope, { title: `TL003 Far ${scope.stamp}`, date: today, ownerUserId: adminUserId });
      for (let index = 0; index < 4; index += 1) {
        await addTimelineDeal(request, token, scope, {
          title: `TL003 Busy ${index} ${scope.stamp}`,
          date: addBuckets(today, 'week', 1),
          ownerUserId: adminUserId,
        });
      }
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      const urlBefore = new URL(page.url());
      await timelineCard(page, movedId).click();
      await changeDateInDrawer(page, farDate);
      await expect.poll(() => closeDateOf(request, token, movedId), { timeout: 15_000 }).toBe(farDate);
      const showDeal = page.getByRole('button', { name: 'Show deal' });
      await expect(showDeal).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('timeline-deal-drawer')).toBeHidden();
      expect(new URL(page.url()).searchParams.get('from'), 'the window stays put').toBe(urlBefore.searchParams.get('from'));
      await expect(showDeal, 'focus lands on Show deal once the drawer closes').toBeFocused();
      await showDeal.click();
      await expect(timelineCard(page, movedId)).toBeVisible({ timeout: 30_000 });
      await expectFocusedDeal(page, movedId);

      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      const busyCell = timelineCell(page, adminUserId, 2);
      const shown = await busyCell.locator('[data-timeline-card]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-deal-id')));
      const hiddenId = scope.dealIds.find((id) => id !== movedId && !shown.includes(id)) as string;
      const hiddenTitle = String((await readDeal(request, token, hiddenId))?.title ?? '');
      await busyCell.getByRole('button', { name: /\+1 more/i }).click();
      await page.getByRole('dialog').last().getByText(hiddenTitle).click();
      const target = addDays(addBuckets(today, 'week', 3), 1);
      await changeDateInDrawer(page, target);
      await expect.poll(() => closeDateOf(request, token, hiddenId), { timeout: 15_000 }).toBe(target);
      await expect(page).toHaveURL(/\/backend\/customers\/deals\/timeline/);
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('destination behind +N more: Show deal opens that cell\'s popover with the deal focused', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    const nextWeekStart = addBuckets(today, 'week', 1);
    const hiddenDate = addDays(nextWeekStart, 4);
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 Behind');
      const movedId = await addTimelineDeal(request, token, scope, { title: `TL003 Behind ${scope.stamp}`, date: today, ownerUserId: adminUserId });
      for (let index = 0; index < 3; index += 1) {
        await addTimelineDeal(request, token, scope, {
          title: `TL003 Full ${index} ${scope.stamp}`,
          date: nextWeekStart,
          ownerUserId: adminUserId,
        });
      }
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      const urlBefore = new URL(page.url());
      await timelineCard(page, movedId).click();
      await changeDateInDrawer(page, hiddenDate);
      await expect.poll(() => closeDateOf(request, token, movedId), { timeout: 15_000 }).toBe(hiddenDate);
      const showDeal = page.getByRole('button', { name: 'Show deal' });
      await expect(showDeal).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('timeline-deal-drawer')).toBeHidden();
      await expect(showDeal, 'focus lands on Show deal once the drawer closes').toBeFocused();
      const fullCell = timelineCell(page, adminUserId, 2);
      await expect(fullCell.locator(`[data-deal-id="${movedId}"]`), 'the moved deal sits behind +N more').toHaveCount(0);
      await showDeal.click();
      expect(new URL(page.url()).searchParams.get('from'), 'the visible window does not move').toBe(urlBefore.searchParams.get('from'));
      const row = page.locator(`[data-popover-deal-id="${movedId}"]`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row, 'the popover opens with the moved deal focused').toBeFocused();
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('two quick moves of the same card never write with a stale version', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    let hold: DealPutHold | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 Rapid');
      const dealId = await addTimelineDeal(request, token, scope, { title: `TL003 Rapid ${scope.stamp}`, date: today, ownerUserId: adminUserId });
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      await expectDraggable(timelineCard(page, dealId));
      const puts = trackDealPuts(page);
      const activeHold = await holdDealPuts(page);
      hold = activeHold;

      await dragCardTo(page, timelineCard(page, dealId), timelineCell(page, adminUserId, 2));
      await expect.poll(() => activeHold.held(), { timeout: 15_000 }).toBe(1);
      await expect(timelineCard(page, dealId), 'the card is locked while its write is in flight').not.toHaveClass(/cursor-grab/);
      const secondWhileLocked = page.waitForRequest(isDealPut, { timeout: 3_000 });
      await dragCardTo(page, timelineCard(page, dealId), timelineCell(page, adminUserId, 3));
      await expect(secondWhileLocked, 'a locked card sends no second write').rejects.toThrow();
      expect(puts.sent()).toBe(1);

      await activeHold.release();
      await expect.poll(() => puts.statuses.length, { timeout: 30_000 }).toBe(1);
      await expect.poll(() => closeDateOf(request, token, dealId), { timeout: 15_000 }).toBe(shiftCloseDate(today, 'week', 1));
      await expectDraggable(timelineCard(page, dealId));

      await dragCardTo(page, timelineCard(page, dealId), timelineCell(page, adminUserId, 3));
      const finalDate = shiftCloseDate(today, 'week', 2);
      await expect.poll(() => puts.statuses.length, { timeout: 30_000 }).toBe(2);
      expect(puts.sent(), 'exactly two writes').toBe(2);
      expect(puts.statuses.every((status) => status < 400), `PUT statuses ${puts.statuses.join(',')}`).toBe(true);
      await expect.poll(() => closeDateOf(request, token, dealId), { timeout: 15_000 }).toBe(finalDate);
      await expect.poll(() => cardColumn(page, dealId), { timeout: 30_000 }).toBe(3);
      await expect(timelineCard(page, dealId)).toHaveAttribute('aria-label', utcMonthDayLabel(finalDate));
      await expect(page.getByText('Record changed')).toHaveCount(0);
    } finally {
      await hold?.dispose();
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('a drawer opened while a drag is saving stays locked, then writes with the fresh version', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    let hold: DealPutHold | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 InFlight');
      const dealId = await addTimelineDeal(request, token, scope, { title: `TL003 InFlight ${scope.stamp}`, date: today, ownerUserId: adminUserId });
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      await expectDraggable(timelineCard(page, dealId));
      const activeHold = await holdDealPuts(page);
      hold = activeHold;

      await dragCardTo(page, timelineCard(page, dealId), timelineCell(page, adminUserId, 2));
      await expect.poll(() => activeHold.held(), { timeout: 15_000 }).toBe(1);
      await timelineCard(page, dealId).click();
      const drawer = page.getByTestId('timeline-deal-drawer');
      await expect(drawer).toBeVisible();
      const markWon = drawer.getByRole('button', { name: 'Mark won' });
      await expect(markWon, 'drawer writes are locked while the drag is saving').toBeDisabled();
      await expect(drawer.getByRole('button', { name: 'Change close date' })).toBeDisabled();

      const dragResponse = page.waitForResponse((response) => isDealPut(response.request()));
      await activeHold.release();
      expect((await dragResponse).status()).toBeLessThan(400);
      const moved = shiftCloseDate(today, 'week', 1);
      await expect(drawer.getByTestId('timeline-drawer-close-date'), 'the drawer re-reads the deal').toContainText(utcMonthDayLabel(moved));
      await expect(markWon, 'the lock clears once fresh data has landed').toBeEnabled({ timeout: 30_000 });

      const wonResponse = page.waitForResponse(
        (response) => response.url().includes('/api/customers/deals') && ['PUT', 'POST'].includes(response.request().method()),
      );
      await markWon.click();
      expect((await wonResponse).status(), 'Mark won after the in-flight drag does not hit a stale-version 409').toBeLessThan(400);
      await expect(page.getByText('Record changed')).toHaveCount(0);
    } finally {
      await hold?.dispose();
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('drawer after a drag of the same deal writes with a fresh version (Mark won succeeds)', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 Fresh');
      const dealId = await addTimelineDeal(request, token, scope, { title: `TL003 Fresh ${scope.stamp}`, date: today, ownerUserId: adminUserId });
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      await timelineCard(page, dealId).click();
      const drawer = page.getByTestId('timeline-deal-drawer');
      await expect(drawer).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await waitForPointerReady(page);
      await expectDraggable(timelineCard(page, dealId));
      await dragCardTo(page, timelineCard(page, dealId), timelineCell(page, adminUserId, 2));
      const moved = shiftCloseDate(today, 'week', 1);
      await expect.poll(() => closeDateOf(request, token, dealId), { timeout: 15_000 }).toBe(moved);
      await timelineCard(page, dealId).click();
      await expect(drawer.getByTestId('timeline-drawer-close-date')).toContainText(utcMonthDayLabel(moved));
      const wonResponse = page.waitForResponse(
        (response) => response.url().includes('/api/customers/deals') && ['PUT', 'POST'].includes(response.request().method()),
      );
      await drawer.getByRole('button', { name: 'Mark won' }).click();
      const response = await wonResponse;
      expect(response.status(), 'Mark won after a drag does not hit a stale-version 409').toBeLessThan(400);
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('conflict: a drag on a deal changed behind the page shows the conflict bar and rolls back', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 Conflict');
      const dealId = await addTimelineDeal(request, token, scope, { title: `TL003 Conflict ${scope.stamp}`, date: today, ownerUserId: adminUserId });
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      await expect(timelineCard(page, dealId)).toBeVisible();
      const record = await readDeal(request, token, dealId);
      const behind = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: { id: dealId, probability: 42 },
        headers: record?.updatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': String(record.updatedAt) } : undefined,
      });
      expect(behind.status(), await behind.text()).toBe(200);

      await dragCardTo(page, timelineCard(page, dealId), timelineCell(page, adminUserId, 2));
      await expect(page.getByText('Record changed').first()).toBeVisible({ timeout: 15_000 });
      await expect(timelineCell(page, adminUserId, 1).locator(`[data-deal-id="${dealId}"]`)).toBeVisible();
      await expect(timelineCard(page, dealId)).toHaveAttribute('aria-label', utcMonthDayLabel(today));
      expect(await closeDateOf(request, token, dealId)).toBe(today);
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('read-only user: no drag affordance and no Change close date; Enter still opens the drawer', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const { organizationId, tenantId } = getTokenContext(token);
    const today = todayKey();
    const email = `tc-crm-tl-003-readonly-${Date.now()}@example.com`;
    let scope: TimelineFixtureScope | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 ReadOnly');
      const dealId = await addTimelineDeal(request, token, scope, { title: `TL003 RO ${scope.stamp}`, date: today });
      roleId = await createRoleFixture(request, token, { name: `TC-CRM-TL-003 RO ${scope.stamp}`, tenantId });
      userId = await createUserFixture(request, token, { email, password: PASSWORD, organizationId, roles: [roleId] });
      await setUserAclVisibility(request, token, {
        userId,
        organizations: [organizationId],
        features: ['customers.deals.view', 'customers.people.view', 'customers.companies.view'],
      });
      await installDevNoticeHandler(page);
      await loginWithCredentials(page, email, PASSWORD);
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      const card = timelineCard(page, dealId);
      await expect(card).toBeVisible();
      await expect(card, 'read-only cards carry a hint instead of a drag affordance').toHaveAttribute('title', /.+/);
      const writeAttempt = page.waitForRequest(isDealPut, { timeout: 3_000 });
      await dragCardTo(page, card, timelineCell(page, '__unassigned', 2));
      await expect(writeAttempt, 'a read-only drag sends no write').rejects.toThrow();
      await expect(timelineCell(page, '__unassigned', 1).locator(`[data-deal-id="${dealId}"]`), 'the card stays in its column').toBeVisible();
      await expect(timelineCell(page, '__unassigned', 2).locator(`[data-deal-id="${dealId}"]`)).toHaveCount(0);
      expect(await closeDateOf(request, token, dealId)).toBe(today);
      await page.keyboard.press('Escape');
      await card.focus();
      await page.keyboard.press('Enter');
      const drawer = page.getByTestId('timeline-deal-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Change close date' })).toHaveCount(0);
      await expect(drawer.getByRole('button', { name: 'Change stage' })).toHaveCount(0);
      await expect(drawer.getByRole('button', { name: 'Mark won' })).toHaveCount(0);
    } finally {
      await deleteUserIfExists(request, token, userId);
      await deleteRoleIfExists(request, token, roleId);
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('closed deals are view-only: no drag, only Schedule follow-up in the drawer', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    let interactionId: string | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 Closed');
      const wonId = await addTimelineDeal(request, token, scope, {
        title: `TL003 Won ${scope.stamp}`,
        date: today,
        ownerUserId: adminUserId,
        status: 'win',
      });
      const neighbourId = await addTimelineDeal(request, token, scope, {
        title: `TL003 Neighbour ${scope.stamp}`,
        date: today,
        ownerUserId: adminUserId,
      });
      const before = await readDeal(request, token, wonId);
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}&closed=all`);
      const card = timelineCard(page, wonId);
      await expect(card).toBeVisible();
      await expect(card, 'closed cards explain why they cannot be rescheduled').toHaveAttribute('title', /.+/);
      const writeAttempt = page.waitForRequest(isDealPut, { timeout: 3_000 });
      await dragCardTo(page, card, timelineCell(page, adminUserId, 2));
      await expect(writeAttempt, 'dragging a won deal sends no write').rejects.toThrow();
      await expect(timelineCell(page, adminUserId, 1).locator(`[data-deal-id="${wonId}"]`)).toBeVisible();
      await expect(timelineCell(page, adminUserId, 2).locator(`[data-deal-id="${wonId}"]`)).toHaveCount(0);
      expect(await closeDateOf(request, token, wonId)).toBe(today);

      await timelineCard(page, wonId).click();
      const drawer = page.getByTestId('timeline-deal-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Schedule follow-up' })).toBeVisible();
      for (const name of ['Change close date', 'Change stage', 'Mark won', 'Mark lost']) {
        await expect(drawer.getByRole('button', { name }), `${name} hidden for a won deal`).toHaveCount(0);
      }

      await drawer.getByRole('button', { name: 'Schedule follow-up' }).click();
      const scheduleDialog = page.getByRole('dialog').filter({ has: page.getByPlaceholder(/Activity title/i) });
      await expect(scheduleDialog).toBeVisible();
      await scheduleDialog.getByPlaceholder(/Activity title/i).fill(`TL003 Won follow-up ${scope.stamp}`);
      const createdPromise = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/customers/interactions' && response.request().method() === 'POST',
      );
      await scheduleDialog.getByRole('button', { name: /^Save (task|activity)$/ }).click();
      const created = await createdPromise;
      expect(created.status(), await created.text()).toBe(201);
      interactionId = ((await created.json()) as { id: string }).id;
      expect((created.request().postDataJSON() as { dealId?: string }).dealId, 'the follow-up is linked to the won deal').toBe(wonId);
      await expect(scheduleDialog).toBeHidden();
      const afterFollowUp = await readDeal(request, token, wonId);
      expect(afterFollowUp?.updatedAt, 'scheduling a follow-up on a won deal never writes the deal').toBe(before?.updatedAt);

      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await waitForPointerReady(page);
      const wonBefore = await wonThisQuarterCount(request, token);
      const puts = trackDealPuts(page);
      await expectDraggable(timelineCard(page, neighbourId));
      await waitForBoardIdle(page);
      await dragCardTo(page, timelineCard(page, neighbourId), timelineCell(page, adminUserId, 2));
      await expect.poll(() => closeDateOf(request, token, neighbourId), { timeout: 15_000 }).toBe(shiftCloseDate(today, 'week', 1));
      await expect.poll(() => puts.statuses.length, { timeout: 15_000 }).toBe(1);
      expect(puts.statuses.every((status) => status < 400)).toBe(true);
      expect(await wonThisQuarterCount(request, token), 'rescheduling an open deal leaves the quarter\'s won count unchanged').toBe(wonBefore);
      const wonAfter = await readDeal(request, token, wonId);
      expect(wonAfter?.updatedAt, 'the won deal next to the rescheduled one is untouched').toBe(before?.updatedAt);
    } finally {
      if (interactionId) {
        await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${interactionId}`, { token }).catch(() => undefined);
      }
      await cleanupTimelineScope(request, token, scope);
    }
  });
});
