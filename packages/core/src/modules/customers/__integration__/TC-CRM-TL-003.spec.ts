import { test, expect, type Locator, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
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
      await page.keyboard.press('Escape').catch(() => undefined);
      expect(new URL(page.url()).searchParams.get('from'), 'the window stays put').toBe(urlBefore.searchParams.get('from'));
      await showDeal.focus();
      await expect(showDeal).toBeFocused();
      await showDeal.click();
      await expect(timelineCard(page, movedId)).toBeVisible({ timeout: 30_000 });

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
      await expect(page).not.toHaveURL(/[?&]deal=/);
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
      await expect(card).not.toHaveAttribute('aria-roledescription', /draggable/i);
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
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-003 Closed');
      const wonId = await addTimelineDeal(request, token, scope, {
        title: `TL003 Won ${scope.stamp}`,
        date: today,
        ownerUserId: adminUserId,
        status: 'win',
      });
      const before = await readDeal(request, token, wonId);
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}&closed=all`);
      const card = timelineCard(page, wonId);
      await expect(card).toBeVisible();
      await expect(card, 'closed cards explain why they cannot be rescheduled').toHaveAttribute('title', /.+/);
      await expect(card).not.toHaveAttribute('aria-roledescription', /draggable/i);
      await dragCardTo(page, card, timelineCell(page, adminUserId, 2));
      await expect(timelineCell(page, adminUserId, 1).locator(`[data-deal-id="${wonId}"]`)).toBeVisible();
      expect(await closeDateOf(request, token, wonId)).toBe(today);

      await timelineCard(page, wonId).click({ force: true });
      const drawer = page.getByTestId('timeline-deal-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Schedule follow-up' })).toBeVisible();
      for (const name of ['Change close date', 'Change stage', 'Mark won', 'Mark lost']) {
        await expect(drawer.getByRole('button', { name }), `${name} hidden for a won deal`).toHaveCount(0);
      }
      const after = await readDeal(request, token, wonId);
      expect(after?.updatedAt, 'viewing a closed deal never writes it').toBe(before?.updatedAt);
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });
});
