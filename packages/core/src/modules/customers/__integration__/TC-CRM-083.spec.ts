import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test';
import {
  createCompanyFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  createDealFixture,
  deleteEntityIfExists,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-083: Deals list redesign UI (`/backend/customers/deals`).
 * Source spec: .ai/specs/2026-06-08-deals-list-redesign.md ("Integration Test Coverage" → UI paths).
 *
 * Verifies the redesigned list renders end to end:
 * - The KPI strip (`DealsKpiStrip`) shows the four metric tabs — Pipeline value, Active deals,
 *   Won, Win rate — and a delta chip (comparable or neutral zero-baseline state).
 * - The restyled cells render: a `StatusBadge` (dictionary label "Open"), an OWNER `Avatar` + name,
 *   and a STAGE name, on a seeded row.
 * - No regression: the search box, the row-actions (⋮) menu, and the advanced-filter ("Filters")
 *   trigger are all present.
 * - The KPI strip works against the real charts: opening and switching metrics, keyboard navigation
 *   of the tabs, line and bar rendering per metric, a period refetch, collapse and reopen with the
 *   state kept across a reload, and recovery after a failed period refetch (stubbed with `page.route`).
 *
 * Self-contained: a deal (owned by the admin, with a known stage + open status) is seeded via API in
 * `beforeAll` so a deterministic row exists to assert on regardless of demo data, and every fixture
 * is cleaned up in `afterAll` (deal → stage → pipeline → company, FK-safe order).
 */

const stamp = Date.now();
const stageLabel = `TC-CRM-083 Stage ${stamp}`;
const dealTitle = `QA TC-CRM-083 Deal ${stamp}`;

let token: string | null = null;
let companyId: string | null = null;
let pipelineId: string | null = null;
let stageId: string | null = null;
let dealId: string | null = null;

const SUMMARY_PATH = '/api/customers/deals/summary';
const KPI_ERROR = "Couldn't load deal metrics";

function isSummaryRequest(range: string): (url: URL) => boolean {
  return (url) => url.pathname === SUMMARY_PATH && url.searchParams.get('range') === range;
}

function waitForSummary(page: Page, range: string) {
  const matchesRange = isSummaryRequest(range);
  return page.waitForResponse((response) => matchesRange(new URL(response.url())));
}

async function failSummary(route: Route): Promise<void> {
  await route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'TC-CRM-083 forced failure' }),
  });
}

async function withFailingSummary(page: Page, range: string, run: () => Promise<void>): Promise<void> {
  const matchesRange = isSummaryRequest(range);
  await page.route(matchesRange, failSummary);
  try {
    await run();
  } finally {
    await page.unroute(matchesRange, failSummary);
  }
}

test.describe('TC-CRM-083: Deals list redesign UI', () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
    token = await getAuthToken(request, 'admin');
    const scope = getTokenScope(token);
    companyId = await createCompanyFixture(request, token, `TC-CRM-083 Co ${stamp}`);
    pipelineId = await createPipelineFixture(request, token, { name: `TC-CRM-083 Pipe ${stamp}` });
    stageId = await createPipelineStageFixture(request, token, { pipelineId, label: stageLabel, order: 0 });
    dealId = await createDealFixture(request, token, {
      title: dealTitle,
      companyIds: [companyId],
      pipelineId,
      pipelineStageId: stageId,
      status: 'open',
      valueAmount: 12000,
      valueCurrency: 'USD',
      // Own the deal so the OWNER cell resolves to an avatar + name for the logged-in admin.
      ownerUserId: scope.userId,
    });
  });

  test.afterAll(async ({ request }: { request: APIRequestContext }) => {
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
    await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
    await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
  });

  test('renders the KPI strip, restyled cells, and keeps search / row-actions / filters', async ({ page }) => {
    test.slow();

    await login(page, 'admin');
    await page.goto('/backend/customers/deals', { waitUntil: 'domcontentloaded' });

    // List is ready when the page heading and the search box are visible.
    await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible({ timeout: 30_000 });
    const searchBox = page.getByPlaceholder(/Search by title/i);
    await expect(searchBox, 'search box should be present (no regression)').toBeVisible({ timeout: 30_000 });

    // --- KPI strip: the four card titles render (they show in loading + loaded states) ---
    await expect(page.getByText('Pipeline value', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Active deals', { exact: true })).toBeVisible();
    await expect(page.getByText('Won', { exact: true })).toBeVisible();
    await expect(page.getByText('Win rate', { exact: true })).toBeVisible();

    // A delta chip carries either the comparable-period title or the neutral zero-baseline title.
    // Poll so we wait through the loading state.
    const deltaChip = page.locator('[title="Compared to previous period"], [title="No comparable change"]');
    await expect(deltaChip.first(), 'at least one KPI delta chip should render').toBeVisible({ timeout: 30_000 });

    // --- Table cells: focus assertions on the deterministic seeded row ---
    await searchBox.fill(dealTitle);
    const dealRow = page.locator('tr').filter({ hasText: dealTitle }).first();
    await expect(dealRow, 'seeded deal row should appear after searching by title').toBeVisible({ timeout: 30_000 });

    // STATUS badge → dictionary label "Open" (seeded status='open').
    await expect(dealRow.getByText('Open', { exact: true }), 'status badge should render the "Open" label').toBeVisible();

    // STAGE name → the dictionary label for the seeded stage.
    await expect(dealRow.getByText(stageLabel, { exact: true }), 'stage name cell should render the seeded stage label').toBeVisible();

    // OWNER → an avatar plus the resolved owner name. The `Avatar` primitive renders a
    // `<div role="img" aria-label="{name}">`; the owner column resolves owner_user_id → a non-empty
    // name (or the id as a fallback), so a row owned by the admin always shows an avatar (role=img,
    // the only one in the row — DEAL uses a lucide SVG, not role=img) plus a visible name span.
    const ownerAvatar = dealRow.getByRole('img').first();
    await expect(ownerAvatar, 'owner avatar (role=img) should render for the owned deal row').toBeVisible();
    const ownerName = await ownerAvatar.getAttribute('aria-label');
    expect(ownerName && ownerName.trim().length > 0, 'owner avatar should carry a non-empty name').toBe(true);
    await expect(dealRow.getByText(ownerName!.trim(), { exact: true }).first(), 'owner name should render next to the avatar').toBeVisible();

    // --- No regression: row-actions (⋮) trigger + advanced-filter ("Filters") trigger exist ---
    const rowActionsTrigger = dealRow.getByRole('button', { name: /Open actions/i }).first();
    await expect(rowActionsTrigger, 'row-actions (⋮) trigger should be present').toBeVisible();

    const filtersTrigger = page.getByRole('button', { name: /Filters/i }).first();
    await expect(filtersTrigger, 'advanced-filter trigger should be present').toBeVisible();
  });

  test('drives the KPI tabs, real charts, period refetch, collapse and failed-refetch recovery', async ({ page }) => {
    test.slow();

    await login(page, 'admin');
    await page.goto('/backend/customers/deals', { waitUntil: 'domcontentloaded' });

    const tabList = page.getByRole('tablist', { name: 'Deal metrics' });
    const pipelineTab = tabList.getByRole('tab', { name: /^Pipeline value/ });
    const activeDealsTab = tabList.getByRole('tab', { name: /^Active deals/ });
    const wonTab = tabList.getByRole('tab', { name: /^Won/ });
    const winRateTab = tabList.getByRole('tab', { name: /^Win rate/ });
    const panel = page.locator('#deals-kpi-panel');
    // The strip's line chart draws a filled area, so its series is a Recharts Area, not a Line.
    const lineSeries = panel.locator('.recharts-area');
    const barSeries = panel.locator('.recharts-bar');
    const chartType = page.getByRole('radiogroup', { name: 'Chart type' });
    const period = page.getByRole('radiogroup', { name: 'Period' });
    const periodOption = (label: string) => period.getByRole('radio', { name: label, exact: true });
    const errorMessage = page.getByText(KPI_ERROR, { exact: true });

    const expectLineChart = async () => {
      await expect(lineSeries).toHaveCount(1, { timeout: 30_000 });
      await expect(barSeries).toHaveCount(0);
      await expect(chartType.getByRole('radio', { name: 'Line', exact: true })).toBeChecked();
    };
    const expectBarChart = async () => {
      await expect(barSeries).toHaveCount(1, { timeout: 30_000 });
      await expect(lineSeries).toHaveCount(0);
      await expect(chartType.getByRole('radio', { name: 'Bars', exact: true })).toBeChecked();
    };
    const expectSelectedTab = async (tab: Locator, metric: string) => {
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(panel).toHaveAttribute('aria-labelledby', `deals-kpi-tab-${metric}`);
    };

    // --- Starts folded to the metric row, with the period control still available ---
    await expect(tabList.getByRole('tab')).toHaveCount(4, { timeout: 30_000 });
    await expect(pipelineTab).toHaveAttribute('aria-selected', 'true');
    await expect(pipelineTab).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    await expect(chartType).toBeHidden();
    await expect(periodOption('6M')).toBeChecked();

    // --- Opening the active metric shows its real chart and the stage rows the seeded deal fills ---
    await pipelineTab.click();
    await expect(pipelineTab).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.locator('.recharts-surface').first()).toBeVisible({ timeout: 30_000 });
    await expectSelectedTab(pipelineTab, 'pipeline');
    await expectLineChart();
    await expect(panel.getByText(/^\d+ deals?$/).first(), 'stage row should show its deal count').toBeVisible();

    // --- Each metric opens on its own default chart type ---
    await activeDealsTab.click();
    await expectSelectedTab(activeDealsTab, 'active');
    await expect(pipelineTab).toHaveAttribute('aria-selected', 'false');
    await expectBarChart();
    await wonTab.click();
    await expectSelectedTab(wonTab, 'won');
    await expectBarChart();
    await winRateTab.click();
    await expectSelectedTab(winRateTab, 'winRate');
    await expectLineChart();

    // --- The chart type is kept per metric ---
    await chartType.getByRole('radio', { name: 'Bars', exact: true }).click();
    await expectBarChart();
    await pipelineTab.click();
    await expectSelectedTab(pipelineTab, 'pipeline');
    await expectLineChart();
    await winRateTab.click();
    await expectSelectedTab(winRateTab, 'winRate');
    await expectBarChart();
    await chartType.getByRole('radio', { name: 'Line', exact: true }).click();
    await expectLineChart();
    await pipelineTab.click();
    await expectSelectedTab(pipelineTab, 'pipeline');

    // --- Keyboard: arrows wrap, Home and End jump, focus follows the selection ---
    await pipelineTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(activeDealsTab).toBeFocused();
    await expectSelectedTab(activeDealsTab, 'active');
    await expect(activeDealsTab).toHaveAttribute('tabindex', '0');
    await expect(pipelineTab).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowLeft');
    await expect(pipelineTab).toBeFocused();
    await expectSelectedTab(pipelineTab, 'pipeline');
    await page.keyboard.press('ArrowLeft');
    await expect(winRateTab).toBeFocused();
    await expectSelectedTab(winRateTab, 'winRate');
    await page.keyboard.press('Home');
    await expect(pipelineTab).toBeFocused();
    await expectSelectedTab(pipelineTab, 'pipeline');
    await page.keyboard.press('End');
    await expect(winRateTab).toBeFocused();
    await expectSelectedTab(winRateTab, 'winRate');
    await page.keyboard.press('Home');
    await expect(pipelineTab).toBeFocused();
    await expectSelectedTab(pipelineTab, 'pipeline');

    // --- Period refetch: the summary is requested for the new window and the chart follows it ---
    const threeMonthSummary = waitForSummary(page, '3m');
    await periodOption('3M').click();
    const threeMonthResponse = await threeMonthSummary;
    expect(threeMonthResponse.ok(), '3M summary should load').toBe(true);
    const threeMonthBody = (await threeMonthResponse.json()) as { range: string; pipelineValue: { series: unknown[] } };
    expect(threeMonthBody.range).toBe('3m');
    expect(threeMonthBody.pipelineValue.series).toHaveLength(3);
    await expect(periodOption('3M')).toBeChecked();
    await expect(panel.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-label')).toHaveCount(3, { timeout: 30_000 });

    // --- A failed refetch keeps the previous numbers, and the control names their window ---
    await withFailingSummary(page, '12m', async () => {
      const failedSummary = waitForSummary(page, '12m');
      await periodOption('12M').click();
      expect((await failedSummary).status()).toBe(500);
      await expect(errorMessage).toBeVisible();
      await expect(periodOption('3M')).toBeChecked();
      await expect(periodOption('12M')).not.toBeChecked();
      await expect(tabList.getByRole('tab')).toHaveCount(4);
      await expectLineChart();
    });

    // --- Choosing the failed period again retries it and clears the error ---
    const recoveredSummary = waitForSummary(page, '12m');
    await periodOption('12M').click();
    expect((await recoveredSummary).ok(), '12M summary should load once the stub is gone').toBe(true);
    await expect(errorMessage).toBeHidden();
    await expect(periodOption('12M')).toBeChecked();

    // --- The Retry button recovers the same way ---
    await withFailingSummary(page, '6m', async () => {
      const failedSummary = waitForSummary(page, '6m');
      await periodOption('6M').click();
      expect((await failedSummary).status()).toBe(500);
      await expect(errorMessage).toBeVisible();
      await expect(periodOption('12M')).toBeChecked();
    });
    const retriedSummary = waitForSummary(page, '6m');
    await errorMessage.locator('..').getByRole('button', { name: 'Retry', exact: true }).click();
    expect((await retriedSummary).ok(), '6M summary should load on retry').toBe(true);
    await expect(errorMessage).toBeHidden();
    await expect(periodOption('6M')).toBeChecked();

    // --- Clicking the active metric folds the panel; the fold survives a reload ---
    await pipelineTab.click();
    await expect(pipelineTab).toHaveAttribute('aria-expanded', 'false');
    await expect(pipelineTab).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toBeHidden();
    await expect(period).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(pipelineTab).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 });
    await expect(panel).toBeHidden();

    // --- Reopening restores the chart, and the open state survives a reload too ---
    await pipelineTab.click();
    await expect(pipelineTab).toHaveAttribute('aria-expanded', 'true');
    await expectLineChart();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(pipelineTab).toHaveAttribute('aria-expanded', 'true', { timeout: 30_000 });
    await expectLineChart();
  });
});
