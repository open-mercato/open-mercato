import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { createDealFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  addBuckets,
  addDays,
  alignToBucketStart,
  bucketIndexFor,
  buildTimelineColumns,
  defaultTimelineFrom,
  toUtcDateKey,
} from '@open-mercato/core/modules/customers/lib/dealsTimeline';
import { buildDealsListHref } from '@open-mercato/core/modules/customers/lib/dealsListHref';
import {
  TIMELINE_PAGE,
  addTimelineDeal,
  cleanupTimelineScope,
  createTimelineScope,
  dismissDevRuntimeNotice,
  installDevNoticeHandler,
  loginWithCredentials,
  openTimeline,
  readDeal,
  readDateKey,
  timelineCard,
  timelineCell,
  type TimelineFixtureScope,
} from './helpers/timelineFixtures';
import { expectFocusedDeal, utcMonthDayLabel } from './helpers/timelineUi';

/**
 * TC-CRM-TL-002: Deals timeline page, read-only (UI)
 * Spec: .ai/specs/2026-10-26-deals-close-date-timeline.md → Integration Test Coverage (TC-CRM-TL-002)
 *
 * Fixtures live in a dedicated pipeline and every page visit filters on it (`pipelineId=` in the
 * URL), which keeps seeded/demo deals out of the board. With the default week window the columns are
 * last week (0), this week (1) and the following weeks (2..4).
 */

const PASSWORD = 'Secret123!';

function todayKey(): string {
  return toUtcDateKey(new Date()) as string;
}

async function deleteTimelinePerspectives(request: APIRequestContext, token: string, prefix: string): Promise<void> {
  const response = await apiRequest(request, 'GET', '/api/perspectives/customers.deals.timeline', { token });
  if (!response.ok()) return;
  const body = await readJsonSafe<{ perspectives?: Array<{ id: string; name: string }> }>(response);
  for (const perspective of body?.perspectives ?? []) {
    if (!perspective.name.startsWith(prefix)) continue;
    await apiRequest(request, 'DELETE', `/api/perspectives/customers.deals.timeline/${perspective.id}`, { token }).catch(
      () => undefined,
    );
  }
}

async function switchOrganization(page: Page, name: string): Promise<void> {
  await expect(page.locator('button[aria-label^="Organization:"]')).toBeAttached({ timeout: 30_000 });
  await page.evaluate(() => {
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label^="Organization:"]');
    if (!trigger) throw new Error('[internal] organization switcher not found');
    trigger.click();
  });
  await expect
    .poll(() =>
      page.evaluate(
        (optionName) =>
          Array.from(document.querySelectorAll<HTMLButtonElement>('[data-radix-popper-content-wrapper] button')).some(
            (button) => button.textContent?.trim() === optionName,
          ),
        name,
      ),
    )
    .toBe(true);
  await page.evaluate((optionName) => {
    const option = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-radix-popper-content-wrapper] button'),
    ).find((button) => button.textContent?.trim() === optionName);
    if (!option) throw new Error('[internal] organization option not found');
    option.click();
  }, name);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector<HTMLButtonElement>('button[aria-label^="Organization:"]')?.getAttribute('aria-label') ?? '',
      ),
    )
    .toContain(name);
}

async function saveTimelineView(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByPlaceholder(/view name/i).fill(name);
  await page.getByRole('button', { name: 'Create view' }).click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible({ timeout: 30_000 });
}

test.describe('TC-CRM-TL-002: deals timeline page (read-only)', () => {
  test('tab, cards, grouping and the +N more popover', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002');
      const mainId = await addTimelineDeal(request, token, scope, {
        title: `TL002 Main ${scope.stamp}`,
        date: today,
        ownerUserId: adminUserId,
        valueAmount: 4321,
      });
      const busyDate = addBuckets(today, 'week', 1);
      for (let index = 0; index < 5; index += 1) {
        await addTimelineDeal(request, token, scope, {
          title: `TL002 Busy ${index} ${scope.stamp}`,
          date: busyDate,
          ownerUserId: adminUserId,
        });
      }

      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await page.goto('/backend/customers/deals', { waitUntil: 'domcontentloaded' });
      const timelineTab = page.getByRole('tab', { name: 'Timeline' });
      await expect(timelineTab).toBeVisible({ timeout: 30_000 });
      await timelineTab.click();
      await page.waitForURL(/\/backend\/customers\/deals\/timeline/);
      await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');

      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      const thisWeekCell = timelineCell(page, adminUserId, 1);
      await expect(thisWeekCell).toBeVisible();
      await expect(page.getByRole('columnheader').nth(2)).toContainText(/this week/i);
      const busyCell = timelineCell(page, adminUserId, 2);
      await expect(busyCell.locator('[data-timeline-card]')).toHaveCount(3);
      const mainCard = thisWeekCell.locator(`[data-timeline-card][data-deal-id="${mainId}"]`);
      await expect(mainCard).toBeVisible();
      await expect(mainCard).toContainText(`TL002 Main ${scope.stamp}`);
      await expect(mainCard).toContainText(/4,321/);
      await expect(mainCard).toContainText(utcMonthDayLabel(today));

      const moreButton = busyCell.getByRole('button', { name: /\+2 more/i });
      await expect(moreButton).toBeVisible();
      await moreButton.click();
      const popover = page.getByRole('dialog').last();
      await expect(popover.getByText(new RegExp(`TL002 (Main|Busy \\d) ${scope.stamp}`))).toHaveCount(5);
      await page.keyboard.press('Escape');

      await page.getByRole('radio', { name: 'Month' }).click();
      await expect(page).toHaveURL(/bucket=month/);
      await page.getByRole('radio', { name: 'Stage' }).click();
      await expect(page).toHaveURL(/groupBy=stage/);
      await expect(page).toHaveURL(/bucket=month/);
      const monthColumns = buildTimelineColumns('month', defaultTimelineFrom('month', today), 4, today);
      const monthIndex = bucketIndexFor(today, monthColumns);
      await expect(timelineCell(page, scope.stageIds[0], monthIndex).locator(`[data-deal-id="${mainId}"]`)).toBeVisible();
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('changing two controls in quick succession keeps both in the URL', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Rapid');
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      await page.getByRole('radio', { name: 'Month' }).click();
      await page.getByRole('radio', { name: 'Stage' }).click();
      await expect(page).toHaveURL(/groupBy=stage/);
      await expect(page, 'the bucket change must survive the immediately following grouping change').toHaveURL(
        /bucket=month/,
      );
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('undated link opens the List with the counted deals, and dating one moves it onto the board', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    const nextWeekDate = addBuckets(today, 'week', 1);
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Undated');
      const datedId = await addTimelineDeal(request, token, scope, {
        title: `TL002U Dated ${scope.stamp}`,
        date: today,
        ownerUserId: adminUserId,
      });
      const searchToken = `tlundated${scope.stamp.toString(36)}`;
      const openUndatedTitle = `TL002U Open undated ${searchToken}`;
      const wonUndatedTitle = `TL002U Won undated ${searchToken}`;
      const openUndatedId = await addTimelineDeal(request, token, scope, {
        title: openUndatedTitle,
        ownerUserId: adminUserId,
      });
      await addTimelineDeal(request, token, scope, { title: wonUndatedTitle, ownerUserId: adminUserId, status: 'win' });
      await expect
        .poll(
          async () => {
            const response = await apiRequest(
              request,
              'GET',
              `/api/customers/deals/timeline?pipelineId=${scope?.pipelineId}&search=${searchToken}&excludeClosed=true`,
              { token },
            );
            const body = await readJsonSafe<{ undatedCount?: number }>(response);
            return body?.undatedCount ?? -1;
          },
          { timeout: 30_000, message: 'the search index picks up the undated fixtures' },
        )
        .toBe(1);

      await installDevNoticeHandler(page);
      await login(page, 'admin');
      const timelineQuery = `pipelineId=${scope.pipelineId}`;
      await openTimeline(page, `${timelineQuery}&search=${searchToken}`);
      const undatedLink = page.getByRole('link', { name: /^1 deals? (has|have) no close date/i });
      await expect(undatedLink).toBeVisible({ timeout: 30_000 });
      await undatedLink.click();
      await page.waitForURL(/\/backend\/customers\/deals\?/);
      await expect(page).toHaveURL(/hasExpectedCloseAt=false/);
      const listUrl = new URL(page.url());
      expect(listUrl.searchParams.get('search'), 'the undated link carries the timeline search into the List').toBe(searchToken);
      const filterEntries = Array.from(listUrl.searchParams.entries())
        .filter(([key]) => key.startsWith('filter['))
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
      expect(filterEntries, 'the List gets the closed-set status condition').toMatch(/\[field\]=status/);
      expect(filterEntries).toMatch(/\[op\]=is_none_of/);
      expect(filterEntries).toMatch(/win/);
      await expect(page.getByRole('searchbox', { name: /^Search by title/i }), 'the List search input shows the token').toHaveValue(searchToken, {
        timeout: 30_000,
      });
      await expect(page.getByText('No close date').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(openUndatedTitle)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(wonUndatedTitle)).toHaveCount(0);

      await page.getByText(openUndatedTitle).first().click();
      await page.waitForURL(new RegExp(`/backend/customers/deals/${openUndatedId}`), { timeout: 30_000 });
      await dismissDevRuntimeNotice(page);
      await expect(page.getByText(openUndatedTitle).first()).toBeVisible({ timeout: 30_000 });
      const dealRecord = await readDeal(request, token, openUndatedId);
      const updateResponse = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: { id: openUndatedId, expectedCloseAt: `${nextWeekDate}T00:00:00.000Z` },
        headers: dealRecord?.updatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': String(dealRecord.updatedAt) } : undefined,
      });
      expect(updateResponse.status(), await updateResponse.text()).toBe(200);
      await expect
        .poll(async () => readDateKey(await readDeal(request, token, openUndatedId), 'expectedCloseAt', 'expected_close_at'), {
          timeout: 20_000,
        })
        .toBe(nextWeekDate);

      await openTimeline(page, timelineQuery);
      await expect(timelineCard(page, datedId)).toBeVisible();
      await expect(timelineCell(page, adminUserId, 2).locator(`[data-deal-id="${openUndatedId}"]`)).toBeVisible();
      await expect(page.getByRole('link', { name: /no close date/i })).toHaveCount(0);
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('saved views round-trip grouping, columns, the closed toggle and filters', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    let scope: TimelineFixtureScope | null = null;
    const viewName = `TC-CRM-TL-002 View ${Date.now()}`;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Views');
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}&groupBy=stage&bucket=month&closed=all`);
      await page.getByRole('button', { name: 'Save view' }).click();
      await page.getByPlaceholder(/view name/i).fill(viewName);
      await page.getByRole('button', { name: 'Create view' }).click();
      await expect(page.getByRole('button', { name: viewName })).toBeVisible();

      await page.goto(TIMELINE_PAGE, { waitUntil: 'domcontentloaded' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const chip = page.getByRole('button', { name: viewName });
      await expect(chip).toBeVisible({ timeout: 30_000 });
      await chip.click();
      await expect(page).toHaveURL(new RegExp(`pipelineId=${scope.pipelineId}`));
      await expect(page).toHaveURL(/groupBy=stage/);
      await expect(page).toHaveURL(/bucket=month/);
      await expect(page).toHaveURL(/closed=all/);
      await expect(page.getByRole('radio', { name: 'Stage' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('radio', { name: 'All deals' })).toHaveAttribute('aria-checked', 'true');
    } finally {
      await deleteTimelinePerspectives(request, token, 'TC-CRM-TL-002 View');
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('New deal returns to the same window, and the period List link keeps the half-open range', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const today = todayKey();
    const futureQuarter = addBuckets(today, 'quarter', 2);
    const monthStart = addBuckets(today, 'month', 2);
    const nextMonthStart = addBuckets(monthStart, 'month', 1);
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Context');
      const inMonthTitle = `TL002C In month ${scope.stamp}`;
      const boundaryTitle = `TL002C Boundary ${scope.stamp}`;
      await addTimelineDeal(request, token, scope, { title: inMonthTitle, date: addDays(monthStart, 9) });
      await addTimelineDeal(request, token, scope, { title: boundaryTitle, date: nextMonthStart });

      await installDevNoticeHandler(page);
      await login(page, 'admin');
      const query = `bucket=quarter&groupBy=stage&from=${futureQuarter}&pipelineId=${scope.pipelineId}`;
      await openTimeline(page, query);
      const before = new URL(page.url());
      await page.getByRole('link', { name: 'New deal' }).click();
      await page.waitForURL(/\/backend\/customers\/deals\/create/);
      await page.getByRole('link', { name: /^cancel$/i }).or(page.getByRole('button', { name: /^cancel$/i })).first().click();
      await page.waitForURL(/\/backend\/customers\/deals\/timeline/);
      const after = new URL(page.url());
      for (const key of ['bucket', 'groupBy', 'from', 'pipelineId']) {
        expect(after.searchParams.get(key), `returnTo keeps ${key}`).toBe(before.searchParams.get(key));
      }

      const href = buildDealsListHref({
        status: [],
        pipelineId: scope.pipelineId,
        ownerUserId: [],
        personId: [],
        companyId: [],
        excludeClosed: true,
        closeDateRange: { from: monthStart, to: nextMonthStart },
      });
      await page.goto(href, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(inMonthTitle)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(boundaryTitle)).toHaveCount(0);
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('closed toggle and Status stay consistent; filters survive Today and reset on Clear', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const superToken = await getAuthToken(request, 'superadmin');
    const adminUserId = getTokenScope(token).userId;
    const otherOwnerId = getTokenScope(superToken).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Closed');
      const openId = await addTimelineDeal(request, token, scope, {
        title: `TL002X Open ${scope.stamp}`,
        date: today,
        ownerUserId: adminUserId,
      });
      const wonId = await addTimelineDeal(request, token, scope, {
        title: `TL002X Won ${scope.stamp}`,
        date: today,
        ownerUserId: adminUserId,
        status: 'win',
      });

      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      await expect(timelineCard(page, openId)).toBeVisible();
      await expect(timelineCard(page, wonId)).toHaveCount(0);
      await expect(page.getByRole('radio', { name: 'Hide closed deals' })).toHaveAttribute('aria-checked', 'true');

      await page.getByRole('radio', { name: 'All deals' }).click();
      await expect(timelineCard(page, wonId)).toBeVisible();
      await expect(timelineCard(page, wonId)).toContainText(/won/i);

      await page.getByRole('radio', { name: 'Hide closed deals' }).click();
      await expect(timelineCard(page, wonId)).toHaveCount(0);
      await page.getByRole('button', { name: /^Status:/ }).click();
      await page.getByRole('button', { name: /^(Win|Won)$/ }).click();
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(page.getByRole('radio', { name: 'All deals' })).toHaveAttribute('aria-checked', 'true');
      await expect(timelineCard(page, wonId)).toBeVisible();

      await page.getByRole('radio', { name: 'Hide closed deals' }).click();
      await expect(page.getByRole('button', { name: /^Status:/ })).toHaveAttribute('aria-pressed', 'false');
      await expect(timelineCard(page, wonId)).toHaveCount(0);

      await page.getByRole('radio', { name: 'All deals' }).click();
      await expect(page).toHaveURL(/closed=all/);
      await page.getByRole('button', { name: 'Today' }).click();
      await expect(page).toHaveURL(new RegExp(`pipelineId=${scope.pipelineId}`));
      await expect(page.getByRole('radio', { name: 'All deals' })).toHaveAttribute('aria-checked', 'true');

      await page.getByRole('button', { name: 'Clear filters' }).first().click();
      await expect(page.getByRole('radio', { name: 'Hide closed deals' })).toHaveAttribute('aria-checked', 'true');
      await expect(page).not.toHaveURL(/closed=all/);
      await expect(page).not.toHaveURL(/pipelineId=/);

      await openTimeline(page, `pipelineId=${scope.pipelineId}&ownerUserId=${otherOwnerId}`, { expectGrid: false });
      await expect(page.getByText('No deals close in this period')).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Hide closed deals' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Status:/ })).toBeVisible();
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('board scrolls horizontally at 1024px with readable cards and pinned lane names', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Layout');
      const dealId = await addTimelineDeal(request, token, scope, {
        title: `TL002L Layout ${scope.stamp}`,
        date: today,
        ownerUserId: adminUserId,
      });
      await page.setViewportSize({ width: 1024, height: 800 });
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      const card = timelineCard(page, dealId);
      await expect(card).toBeVisible();
      await expect(card.getByText(utcMonthDayLabel(today))).toBeVisible();

      const grid = page.getByRole('grid');
      const scrollMetrics = await grid.evaluate((element) => {
        let node: HTMLElement | null = element as HTMLElement;
        while (node && node.scrollWidth <= node.clientWidth) node = node.parentElement;
        if (!node) return null;
        node.scrollLeft = node.scrollWidth;
        return { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollLeft: node.scrollLeft };
      });
      expect(scrollMetrics, 'the board has a horizontally scrollable container').not.toBeNull();
      expect(scrollMetrics!.scrollLeft, 'the board scrolled right').toBeGreaterThan(0);
      const laneHeader = page.locator(`[data-timeline-lane="${adminUserId}"] > *`).first();
      const box = await laneHeader.boundingBox();
      expect(box, 'lane header is rendered').not.toBeNull();
      expect(box!.x + box!.width, 'lane header stays inside the viewport after scrolling').toBeGreaterThan(0);
      expect(box!.x, 'lane header is pinned to the left edge').toBeLessThan(1024);
      await expect(laneHeader).toBeInViewport();
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('lane totals stay inside the lane column at 1440 and 390 px, and a phone opens on the current column', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Totals');
      const dealId = await addTimelineDeal(request, token, scope, {
        title: `TL002T Large ${scope.stamp}`,
        date: today,
        ownerUserId: adminUserId,
        valueAmount: 1234567.89,
      });
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await openTimeline(page, `pipelineId=${scope.pipelineId}`);
        const rowHeader = page.locator(`[data-timeline-lane="${adminUserId}"] [role="rowheader"]`);
        await expect(rowHeader.getByTestId('timeline-amounts')).toBeVisible();
        const overflow = await rowHeader.evaluate((header) => {
          const headerRect = header.getBoundingClientRect();
          const escapes = Array.from(header.querySelectorAll<HTMLElement>('dt, dd, span'))
            .filter((element) => element.getClientRects().length > 0 && !element.classList.contains('sr-only'))
            .filter((element) => element.getBoundingClientRect().right > headerRect.right + 0.5)
            .map((element) => element.textContent ?? '');
          const text = header.querySelector<HTMLElement>('[data-testid="timeline-lane-header-text"]');
          return { escapes, textOverflows: text ? text.scrollWidth > text.clientWidth + 1 : true };
        });
        expect(overflow.escapes, `no lane text crosses the lane column border at ${viewport.width}px`).toEqual([]);
        expect(overflow.textOverflows, `the lane header text fits its column at ${viewport.width}px`).toBe(false);

        if (viewport.width === 390) {
          const placement = await page.getByRole('grid').evaluate((grid) => {
            const current = grid.querySelector<HTMLElement>('[data-current-column="true"]');
            const lane = grid.querySelector<HTMLElement>('[data-lane-header-column="true"]');
            if (!current || !lane) return null;
            const gridRect = grid.getBoundingClientRect();
            const currentRect = current.getBoundingClientRect();
            return {
              startsAfterLane: currentRect.left >= lane.getBoundingClientRect().right - 1,
              startsInsideGrid: currentRect.left < gridRect.right - 1,
            };
          });
          expect(placement, 'the current column header is rendered').not.toBeNull();
          expect(placement!.startsAfterLane, 'the current column is not hidden behind the pinned lane column').toBe(true);
          expect(placement!.startsInsideGrid, 'the current column is visible without scrolling at 390px').toBe(true);
          await expect(timelineCard(page, dealId)).toBeVisible();
          const pageScrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
          expect(await pageScrollWidth(), 'only the grid scrolls sideways on a phone, not the page').toBeLessThanOrEqual(390);
          for (const control of ['Previous', 'Today', 'Next']) {
            await page.getByRole('button', { name: control, exact: true }).first().click();
            await expect(page.locator('[role="grid"][aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });
            expect(await pageScrollWidth(), `no page-level horizontal scroll after ${control} at 390px`).toBeLessThanOrEqual(390);
          }
        }
      }
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('stage view hides empty stages until asked; overdue and undated are quiet counters, not alerts', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Stages', 4);
      await addTimelineDeal(request, token, scope, { title: `TL002S Current ${scope.stamp}`, date: today, ownerUserId: adminUserId });
      const overdueDate = addDays(today, -45);
      await addTimelineDeal(request, token, scope, { title: `TL002S Overdue ${scope.stamp}`, date: overdueDate, ownerUserId: adminUserId });
      await addTimelineDeal(request, token, scope, { title: `TL002S Undated ${scope.stamp}`, ownerUserId: adminUserId });
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}&groupBy=stage`);

      await expect(page.locator(`[data-timeline-lane="${scope.stageIds[0]}"]`)).toBeVisible();
      for (const emptyStage of scope.stageIds.slice(1)) {
        await expect(page.locator(`[data-timeline-lane="${emptyStage}"]`), 'empty stages are hidden by default').toHaveCount(0);
      }
      const toggle = page.getByTestId('timeline-empty-stages-toggle');
      await expect(toggle).toHaveText(/Show empty stages \(3\)/);
      await toggle.click();
      await expect(page).toHaveURL(/emptyStages=show/);
      await expect(page.locator(`[data-timeline-lane="${scope.stageIds[3]}"]`)).toBeVisible();
      await expect(toggle).toHaveText(/Hide empty stages/);
      await toggle.click();
      await expect(page).not.toHaveURL(/emptyStages=show/);
      await expect(page.locator(`[data-timeline-lane="${scope.stageIds[3]}"]`)).toHaveCount(0);

      const overdue = page.getByTestId('timeline-overdue-before');
      const undated = page.getByTestId('timeline-undated');
      await expect(overdue).toBeVisible();
      await expect(undated).toBeVisible();
      await expect(overdue.locator('xpath=ancestor::*[@data-slot="alert"]')).toHaveCount(0);
      await expect(undated.locator('xpath=ancestor::*[@data-slot="alert"]')).toHaveCount(0);
      const alertsAboveGrid = await page.getByRole('grid').evaluate((grid) => {
        const board = grid.parentElement;
        if (!board) return -1;
        let count = 0;
        for (const child of Array.from(board.children)) {
          if (child === grid) break;
          if (child.matches('[data-slot="alert"]') || child.querySelector('[data-slot="alert"]')) count += 1;
        }
        return count;
      });
      expect(alertsAboveGrid, 'with no recent action no alert sits above the grid').toBe(0);
      await expect(undated).toHaveAttribute('href', /hasExpectedCloseAt=false/);
      await overdue.click();
      await expect(page).toHaveURL(new RegExp(`from=${alignToBucketStart(overdueDate, 'week')}`));
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('deal drawer: URL state, focus, Back, links and popover rows', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Drawer');
      for (let index = 0; index < 4; index += 1) {
        await addTimelineDeal(request, token, scope, {
          title: `TL002D Deal ${index} ${scope.stamp}`,
          date: today,
          ownerUserId: adminUserId,
        });
      }

      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      const drawer = page.getByTestId('timeline-deal-drawer');
      const busyCell = timelineCell(page, adminUserId, 1);
      const visibleCardId = (await busyCell.locator('[data-timeline-card]').first().getAttribute('data-deal-id')) as string;
      const targetCard = timelineCard(page, visibleCardId);

      await targetCard.click();
      await expect(drawer).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`deal=${visibleCardId}`));
      await expect(drawer.getByTestId('timeline-drawer-days-in-stage')).toBeVisible();
      await expect(drawer.getByTestId('timeline-drawer-open-activities')).toBeVisible();
      await expect(drawer.getByText('Open', { exact: true }), 'status badge next to the stage').toBeVisible();

      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expectFocusedDeal(page, visibleCardId);

      await targetCard.click();
      await expect(drawer).toBeVisible();
      await page.goBack();
      await expect(drawer).toBeHidden();
      await expect(page).not.toHaveURL(/deal=/);
      await expect(page).toHaveURL(new RegExp(`pipelineId=${scope.pipelineId}`));

      await targetCard.click();
      await expect(drawer).toBeVisible();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(drawer).toBeVisible({ timeout: 30_000 });
      await dismissDevRuntimeNotice(page);
      const withDrawerUrl = page.url();

      await drawer.getByRole('link', { name: scope.companyName }).click();
      await page.waitForURL(new RegExp(`/backend/customers/companies-v2/${scope.companyId}`));
      await page.goBack();
      await page.waitForURL(/\/backend\/customers\/deals\/timeline/);
      expect(page.url()).toBe(withDrawerUrl);
      await expect(drawer).toBeVisible({ timeout: 30_000 });

      await drawer.getByRole('link', { name: scope.personName }).click();
      await page.waitForURL(new RegExp(`/backend/customers/people-v2/${scope.personId}`));
      await page.goBack();
      await page.waitForURL(/\/backend\/customers\/deals\/timeline/);
      await expect(drawer).toBeVisible({ timeout: 30_000 });

      await drawer.getByRole('heading').getByRole('link').click();
      await page.waitForURL(new RegExp(`/backend/customers/deals/${visibleCardId}`));
      await page.goBack();
      await page.waitForURL(/\/backend\/customers\/deals\/timeline/);
      await expect(drawer).toBeVisible({ timeout: 30_000 });
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();

      const shownIds = await busyCell
        .locator('[data-timeline-card]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-deal-id')));
      const hiddenId = scope.dealIds.find((id) => !shownIds.includes(id)) as string;
      const hiddenTitle = String((await readDeal(request, token, hiddenId))?.title ?? '');
      await busyCell.getByRole('button', { name: /\+1 more/i }).click();
      await page.getByRole('dialog').last().getByText(hiddenTitle).click();
      await expect(drawer).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`deal=${hiddenId}`));
      await expect(drawer.locator('[data-slot="drawer-title"]')).toContainText(hiddenTitle);
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('?deal= with an unknown id keeps the drawer closed and drops the param', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    let scope: TimelineFixtureScope | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Unknown');
      const dealId = await addTimelineDeal(request, token, scope, {
        title: `TL002X Deal ${scope.stamp}`,
        date: todayKey(),
        ownerUserId: adminUserId,
      });
      const unknownId = crypto.randomUUID();
      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}&deal=${unknownId}`);
      await expect(timelineCard(page, dealId)).toBeVisible();
      await expect(page, 'the unresolvable deal param is dropped').not.toHaveURL(/[?&]deal=/, { timeout: 30_000 });
      await expect(page.getByTestId('timeline-deal-drawer')).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`pipelineId=${scope.pipelineId}`));
    } finally {
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('switching organization with the drawer open drops the previous organization\'s deal', async ({ page, request }) => {
    test.setTimeout(300_000);
    const stamp = Date.now();
    const adminToken = await getAuthToken(request, 'admin');
    const superToken = await getAuthToken(request, 'superadmin');
    const { tenantId, organizationId: orgAId } = getTokenContext(adminToken);
    const adminUserId = getTokenScope(adminToken).userId;
    const viewerEmail = `tc-crm-tl-002-scope-${stamp}@example.com`;
    const orgBUserEmail = `tc-crm-tl-002-scope-b-${stamp}@example.com`;
    const orgBName = `TC-CRM-TL-002 Org B ${stamp}`;
    let scope: TimelineFixtureScope | null = null;
    let orgBId: string | null = null;
    let viewerId: string | null = null;
    let orgBUserId: string | null = null;
    let orgBUserToken: string | null = null;
    let orgBDealId: string | null = null;
    try {
      scope = await createTimelineScope(request, adminToken, 'TC-CRM-TL-002 Scope');
      const orgADealTitle = `TL002S Org A Deal ${stamp}`;
      const orgADealId = await addTimelineDeal(request, adminToken, scope, {
        title: orgADealTitle,
        date: todayKey(),
        ownerUserId: adminUserId,
      });
      orgBId = await createOrganizationFixture(request, superToken, { name: orgBName, tenantId });
      orgBUserId = await createUserFixture(request, superToken, {
        email: orgBUserEmail,
        password: PASSWORD,
        organizationId: orgBId,
        roles: [],
      });
      await setUserAclVisibility(request, superToken, { userId: orgBUserId, organizations: null, features: ['customers.*'] });
      orgBUserToken = await getAuthToken(request, orgBUserEmail, PASSWORD);
      orgBDealId = await createDealFixture(request, orgBUserToken, {
        title: `TL002S Org B Deal ${stamp}`,
        status: 'open',
        expectedCloseAt: `${todayKey()}T00:00:00.000Z`,
        ownerUserId: orgBUserId,
      });
      viewerId = await createUserFixture(request, superToken, {
        email: viewerEmail,
        password: PASSWORD,
        organizationId: orgAId,
        roles: [],
      });
      await setUserAclVisibility(request, superToken, {
        userId: viewerId,
        organizations: [orgAId, orgBId],
        features: ['customers.*'],
      });

      await installDevNoticeHandler(page);
      await loginWithCredentials(page, viewerEmail, PASSWORD);
      await openTimeline(page, `bucket=quarter&deal=${orgADealId}`);
      const drawer = page.getByTestId('timeline-deal-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer).toContainText(orgADealTitle);
      await expect(timelineCard(page, orgADealId)).toBeAttached();

      const timelineRoute = '**/api/customers/deals/timeline?*';
      const { promise: resumeTimeline, resolve: releaseTimeline } = Promise.withResolvers<void>();
      let timelineRequestHeld = false;
      await page.route(timelineRoute, async (route) => {
        timelineRequestHeld = true;
        await resumeTimeline;
        await route.continue();
      });
      try {
        await switchOrganization(page, orgBName);
        await expect.poll(() => timelineRequestHeld).toBe(true);
        await expect(page, 'the previous organization\'s deal param is dropped').not.toHaveURL(/[?&]deal=/, {
          timeout: 30_000,
        });
        await expect(drawer).toBeHidden();
        await expect(page.getByRole('grid', { name: 'Deals Timeline' })).toHaveAttribute('aria-busy', 'true');
        await expect(page.getByText(orgADealTitle), 'org A data stays hidden while org B is loading').toHaveCount(0);
      } finally {
        releaseTimeline();
      }
      await expect(timelineCard(page, orgBDealId)).toBeVisible({ timeout: 30_000 });
    } finally {
      if (orgBUserToken) await deleteEntityIfExists(request, orgBUserToken, '/api/customers/deals', orgBDealId);
      await deleteUserIfExists(request, superToken, viewerId);
      await deleteUserIfExists(request, superToken, orgBUserId);
      await cleanupTimelineScope(request, adminToken, scope);
      await deleteOrganizationIfExists(request, superToken, orgBId);
    }
  });

  test('saved views follow the organization switch: chips, apply, rename and delete stay in their organization', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const stamp = Date.now();
    const adminToken = await getAuthToken(request, 'admin');
    const superToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenContext(adminToken);
    const orgAName = `TC-CRM-TL-002 Views Org A ${stamp}`;
    const orgBName = `TC-CRM-TL-002 Views Org B ${stamp}`;
    const ownerAEmail = `tc-crm-tl-002-views-a-${stamp}@example.com`;
    const ownerBEmail = `tc-crm-tl-002-views-b-${stamp}@example.com`;
    const viewA = `TL002V A ${stamp}`;
    const viewB = `TL002V B ${stamp}`;
    const viewBRenamed = `TL002V B renamed ${stamp}`;
    let orgAId: string | null = null;
    let orgBId: string | null = null;
    let ownerAId: string | null = null;
    let ownerBId: string | null = null;
    let ownerAToken: string | null = null;
    let ownerBToken: string | null = null;
    let dealAId: string | null = null;
    let dealBId: string | null = null;
    try {
      orgAId = await createOrganizationFixture(request, superToken, { name: orgAName, tenantId });
      orgBId = await createOrganizationFixture(request, superToken, { name: orgBName, tenantId });
      ownerAId = await createUserFixture(request, superToken, { email: ownerAEmail, password: PASSWORD, organizationId: orgAId, roles: [] });
      ownerBId = await createUserFixture(request, superToken, { email: ownerBEmail, password: PASSWORD, organizationId: orgBId, roles: [] });
      await setUserAclVisibility(request, superToken, { userId: ownerAId, organizations: null, features: ['customers.*'] });
      await setUserAclVisibility(request, superToken, { userId: ownerBId, organizations: null, features: ['customers.*'] });
      ownerAToken = await getAuthToken(request, ownerAEmail, PASSWORD);
      ownerBToken = await getAuthToken(request, ownerBEmail, PASSWORD);
      dealAId = await createDealFixture(request, ownerAToken, {
        title: `TL002V Org A Deal ${stamp}`,
        status: 'open',
        expectedCloseAt: `${todayKey()}T00:00:00.000Z`,
        ownerUserId: ownerAId,
      });
      dealBId = await createDealFixture(request, ownerBToken, {
        title: `TL002V Org B Deal ${stamp}`,
        status: 'open',
        expectedCloseAt: `${todayKey()}T00:00:00.000Z`,
        ownerUserId: ownerBId,
      });
      await installDevNoticeHandler(page);
      await login(page, 'superadmin');
      await openTimeline(page, 'bucket=quarter');
      await switchOrganization(page, orgAName);
      await expect(timelineCard(page, dealAId)).toBeVisible({ timeout: 30_000 });
      await saveTimelineView(page, viewA);

      await switchOrganization(page, orgBName);
      await expect(page.getByRole('button', { name: viewA, exact: true }), 'org A views leave with org A').toHaveCount(0);
      await expect(timelineCard(page, dealBId)).toBeVisible({ timeout: 30_000 });
      await page.getByRole('radio', { name: 'Stage' }).click();
      await expect(page).toHaveURL(/groupBy=stage/);
      await saveTimelineView(page, viewB);
      await expect(page.getByRole('button', { name: viewA, exact: true })).toHaveCount(0);

      await page.getByRole('radio', { name: 'Owner' }).click();
      await expect(page).not.toHaveURL(/groupBy=stage/);
      await page.getByRole('button', { name: viewB, exact: true }).click();
      await expect(page, 'applying an org B view restores its grouping').toHaveURL(/groupBy=stage/);

      const viewBChip = page.getByRole('button', { name: viewB, exact: true }).locator('xpath=..');
      await viewBChip.getByRole('button', { name: 'View options' }).click();
      await page.getByRole('dialog').last().getByRole('button', { name: 'Rename' }).click();
      const renameInput = page.getByRole('group', { name: 'Saved views' }).locator('input');
      await renameInput.fill(viewBRenamed);
      await renameInput.press('Enter');
      await expect(page.getByRole('button', { name: viewBRenamed, exact: true })).toBeVisible({ timeout: 30_000 });

      await switchOrganization(page, orgAName);
      await expect(page.getByRole('button', { name: viewA, exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: viewBRenamed, exact: true }), 'org B views stay in org B').toHaveCount(0);
      const viewAChip = page.getByRole('button', { name: viewA, exact: true }).locator('xpath=..');
      await viewAChip.getByRole('button', { name: 'View options' }).click();
      await page.getByRole('dialog').last().getByRole('button', { name: 'Delete' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByRole('button', { name: viewA, exact: true })).toHaveCount(0, { timeout: 30_000 });

      await switchOrganization(page, orgBName);
      await expect(
        page.getByRole('button', { name: viewBRenamed, exact: true }),
        'deleting the org A view leaves the renamed org B view intact',
      ).toBeVisible({ timeout: 30_000 });
      const renamedChip = page.getByRole('button', { name: viewBRenamed, exact: true }).locator('xpath=..');
      await renamedChip.getByRole('button', { name: 'View options' }).click();
      await page.getByRole('dialog').last().getByRole('button', { name: 'Delete' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByRole('button', { name: viewBRenamed, exact: true })).toHaveCount(0, { timeout: 30_000 });
    } finally {
      if (ownerAToken) await deleteEntityIfExists(request, ownerAToken, '/api/customers/deals', dealAId);
      if (ownerBToken) await deleteEntityIfExists(request, ownerBToken, '/api/customers/deals', dealBId);
      await deleteUserIfExists(request, superToken, ownerAId);
      await deleteUserIfExists(request, superToken, ownerBId);
      await deleteOrganizationIfExists(request, superToken, orgAId);
      await deleteOrganizationIfExists(request, superToken, orgBId);
    }
  });

  test('deal drawer: Schedule follow-up creates a scheduled interaction for the deal', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const adminUserId = getTokenScope(token).userId;
    const today = todayKey();
    let scope: TimelineFixtureScope | null = null;
    let interactionId: string | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 FollowUp');
      const dealId = await addTimelineDeal(request, token, scope, {
        title: `TL002F Deal ${scope.stamp}`,
        date: today,
        ownerUserId: adminUserId,
      });

      await installDevNoticeHandler(page);
      await login(page, 'admin');
      await openTimeline(page, `pipelineId=${scope.pipelineId}`);
      const drawer = page.getByTestId('timeline-deal-drawer');
      await timelineCard(page, dealId).click();
      await expect(drawer).toBeVisible();
      const openActivities = drawer.getByTestId('timeline-drawer-open-activities');
      await expect(openActivities).toBeVisible();
      const initialCount = Number((await openActivities.textContent())?.trim() ?? '0');

      await drawer.getByRole('button', { name: 'Schedule follow-up' }).click();
      const scheduleDialog = page.getByRole('dialog').filter({ has: page.getByPlaceholder(/Activity title/i) });
      await expect(scheduleDialog).toBeVisible();
      await scheduleDialog.getByPlaceholder(/Activity title/i).fill(`TL002F Follow-up ${scope.stamp}`);
      const saveButton = scheduleDialog.getByRole('button', { name: /^Save (task|activity)$/ });
      await expect(saveButton, 'the follow-up dialog Save button is not covered by the drawer').toBeInViewport();
      const createdPromise = page.waitForResponse(
        (response) => response.url().includes('/api/customers/interactions') && response.request().method() === 'POST',
      );
      await saveButton.click({ timeout: 10_000 });
      const created = await createdPromise;
      expect(created.status(), await created.text()).toBe(201);
      interactionId = ((await created.json()) as { id: string }).id;
      const createdPayload = created.request().postDataJSON() as { dealId?: string; scheduledAt?: string };
      expect(createdPayload.dealId, 'follow-up is linked to the deal').toBe(dealId);
      const readBack = await apiRequest(request, 'GET', `/api/customers/interactions?id=${interactionId}`, { token });
      const readBody = await readJsonSafe<{ items?: Array<{ dealId?: string; scheduledAt?: string }> }>(readBack);
      const interaction = readBody?.items?.[0];
      expect(interaction?.dealId, 'API returns the follow-up with the deal id').toBe(dealId);
      expect(toUtcDateKey(interaction?.scheduledAt ?? null)).toBe(toUtcDateKey(createdPayload.scheduledAt ?? null));
      expect(interaction?.scheduledAt, 'the follow-up is scheduled, not just logged').toBeTruthy();
      await expect(openActivities).toHaveText(String(initialCount + 1), { timeout: 15_000 });
    } finally {
      if (interactionId) {
        await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${interactionId}`, { token }).catch(() => undefined);
      }
      await cleanupTimelineScope(request, token, scope);
    }
  });

  test('a user without customers.companies.view sees the company as plain text', async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await getAuthToken(request, 'admin');
    const { organizationId, tenantId } = getTokenContext(token);
    const today = todayKey();
    const email = `tc-crm-tl-002-nocompany-${Date.now()}@example.com`;
    let scope: TimelineFixtureScope | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      scope = await createTimelineScope(request, token, 'TC-CRM-TL-002 Plain');
      const dealId = await addTimelineDeal(request, token, scope, { title: `TL002P Deal ${scope.stamp}`, date: today });
      roleId = await createRoleFixture(request, token, { name: `TC-CRM-TL-002 Viewer ${scope.stamp}`, tenantId });
      userId = await createUserFixture(request, token, {
        email,
        password: PASSWORD,
        organizationId,
        roles: [roleId],
        name: 'TC-CRM-TL-002 Viewer',
      });
      await setUserAclVisibility(request, token, {
        userId,
        organizations: [organizationId],
        features: ['customers.deals.view', 'customers.people.view'],
      });

      await installDevNoticeHandler(page);
      await loginWithCredentials(page, email, PASSWORD);
      await page.goto(`${TIMELINE_PAGE}?pipelineId=${scope.pipelineId}&deal=${dealId}`, { waitUntil: 'domcontentloaded' });
      const drawer = page.getByTestId('timeline-deal-drawer');
      await expect(drawer).toBeVisible({ timeout: 30_000 });
      await expect(drawer.getByText(scope.companyName)).toBeVisible();
      await expect(drawer.getByRole('link', { name: scope.companyName })).toHaveCount(0);
      await expect(drawer.getByRole('link', { name: scope.personName })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Change close date' })).toHaveCount(0);
      await expect(drawer.getByRole('button', { name: 'Mark won' })).toHaveCount(0);
    } finally {
      await deleteUserIfExists(request, token, userId);
      await deleteRoleIfExists(request, token, roleId);
      await cleanupTimelineScope(request, token, scope);
    }
  });
});
