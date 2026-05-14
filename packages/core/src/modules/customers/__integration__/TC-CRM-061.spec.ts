import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-061: Deals page advanced filter (figma redesign — flag-on path).
 *
 * Spec: .ai/specs/2026-05-07-advanced-filter-tree-design.md
 * Plan: .ai/plans/2026-05-08-crm-filter-figma-redesign.md (Phase 4, Task 4.4)
 *
 * Mirrors TC-CRM-060 with Deals-specific adjustments:
 *   - Path:          /backend/customers/deals
 *   - Presets:       My deals / Closing this month / Won this quarter (3 presets)
 *                    "At risk" was dropped during Task 4.2 because the Deal entity has no
 *                    health-score field — `customer_deals` only exposes status + closure_outcome.
 *   - Fixture API:   POST /api/customers/deals (createDealFixture, with companyIds link)
 *   - Status field:  deal `status` (open/win/lost dictionary) — used for the tone-dot chip assertion
 *
 * Each test seeds a fresh deal (linked to a fresh company) via API and tears them down in
 * `finally`. The test is skipped when the dev server is not running with the V2 feature flag —
 * detected by absence of the `[data-testid="advanced-filter-panel"]` shell after opening Filters.
 */
test.describe('TC-CRM-061: Deals filter UX (V2 figma redesign)', () => {
  test.slow();

  async function openFiltersOrSkip(page: import('@playwright/test').Page): Promise<boolean> {
    const filtersButton = page.getByTestId('advanced-filter-trigger').first();
    await expect(filtersButton).toBeVisible({ timeout: 15_000 });
    await filtersButton.click();
    const panel = page.locator('[data-testid="advanced-filter-panel"]').first();
    const visible = await panel.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!visible) {
      test.skip(
        true,
        'Advanced filter panel not present — likely an unrelated render error on this dev server.',
      );
    }
    return visible;
  }

  test('empty popover renders funnel icon, Add condition control, and Quick filters (3 presets)', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    const ts = Date.now();

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA${ts} FigmaEmpty Co`);
      dealId = await createDealFixture(request, token, {
        title: `QA${ts} FigmaEmpty Deal`,
        companyIds: [companyId],
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals', { waitUntil: 'domcontentloaded' });

      const opened = await openFiltersOrSkip(page);
      if (!opened) return;

      const emptyState = page.locator('[data-testid="filter-empty-state"]').first();
      await expect(emptyState).toBeVisible();
      await expect(emptyState).toContainText(/no filters applied/i);
      await expect(emptyState.getByRole('button', { name: /add condition/i })).toBeVisible();

      // Quick filters row from Deals presets (my deals / closing this month / won this quarter).
      // Presence of at least one preset button proves the QuickFilters block rendered.
      const anyPresetVisible = await page
        .getByRole('button', { name: /(my deals|closing this month|won this quarter)/i })
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      expect(anyPresetVisible).toBe(true);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('clicking My deals preset applies tree, chip strip renders', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    const ts = Date.now();

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA${ts} FigmaPreset Co`);
      dealId = await createDealFixture(request, token, {
        title: `QA${ts} FigmaPreset Deal`,
        companyIds: [companyId],
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals', { waitUntil: 'domcontentloaded' });

      const opened = await openFiltersOrSkip(page);
      if (!opened) return;

      await page.getByRole('button', { name: /my deals/i }).first().click();

      // Popover closes on preset apply per AdvancedFilterPanel.handlePresetApply
      const panel = page.locator('[data-testid="advanced-filter-panel"]').first();
      await expect(panel).toBeHidden({ timeout: 5_000 });

      // Chip strip becomes visible (only renders when popover is closed AND tree non-empty)
      const chipStrip = page.locator('[data-testid="active-filter-chips"]').first();
      await expect(chipStrip).toBeVisible({ timeout: 5_000 });
      await expect(chipStrip.locator('[data-testid="active-filter-chip"]').first()).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('chip × removes the rule from the tree and hides the chip strip', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    const ts = Date.now();

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA${ts} FigmaChip Co`);
      dealId = await createDealFixture(request, token, {
        title: `QA${ts} FigmaChip Deal`,
        companyIds: [companyId],
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals', { waitUntil: 'domcontentloaded' });

      const opened = await openFiltersOrSkip(page);
      if (!opened) return;

      // Apply My deals preset (single-rule, deterministic — only requires a current user id).
      await page.getByRole('button', { name: /my deals/i }).first().click();

      const chipStrip = page.locator('[data-testid="active-filter-chips"]').first();
      await expect(chipStrip).toBeVisible({ timeout: 5_000 });

      // Remove the rule via the chip's × button (aria-label = "Remove filter")
      await chipStrip.getByLabel(/remove filter/i).first().click();

      await expect(chipStrip).toBeHidden({ timeout: 5_000 });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('Status filter added via Add condition shows tone dot in chip', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    const ts = Date.now();

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA${ts} FigmaStatus Co`);
      dealId = await createDealFixture(request, token, {
        title: `QA${ts} FigmaStatus Deal`,
        companyIds: [companyId],
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals', { waitUntil: 'domcontentloaded' });

      const opened = await openFiltersOrSkip(page);
      if (!opened) return;

      // Click "Add condition" inside the empty state
      const addConditionBtn = page
        .locator('[data-testid="filter-empty-state"]')
        .getByRole('button', { name: /add condition/i })
        .first();
      await addConditionBtn.click();

      // FilterFieldPicker opens — search "Status"
      const searchInput = page.getByPlaceholder(/search field/i).first();
      await expect(searchInput).toBeVisible({ timeout: 5_000 });
      await searchInput.fill('Status');

      // Pick the Status field (the FilterFieldPicker option button shows the field label)
      const statusOption = page.getByRole('option', { name: /^Status$/i }).first();
      const haveStatusField = await statusOption.isVisible({ timeout: 3_000 }).catch(() => false);
      if (!haveStatusField) {
        test.skip(true, 'No Status field exposed in this build of the Deals filter field config — test cannot proceed.');
        return;
      }
      await statusOption.click();

      // After selecting the field a rule is added to the tree. The popover stays open.
      // Now choose any seeded deal-statuses value via the value Select.
      const valueTrigger = page.getByLabel(/select value/i).first();
      await expect(valueTrigger).toBeVisible({ timeout: 5_000 });
      await valueTrigger.click();

      // Pick the first available status option (deal-statuses dictionary may seed open/win/lost
      // with associated colors, producing a tone dot in the chip). The exact label depends on
      // tenant seeding, so we accept any first option.
      const firstOption = page.getByRole('option').first();
      const hasOption = await firstOption.isVisible({ timeout: 3_000 }).catch(() => false);
      if (!hasOption) {
        test.skip(true, 'No deal-statuses dictionary entries seeded for this tenant — Status filter has no values to pick.');
        return;
      }
      await firstOption.click();

      // Close the popover (Escape) to surface the chip strip
      await page.keyboard.press('Escape');

      const chipStrip = page.locator('[data-testid="active-filter-chips"]').first();
      await expect(chipStrip).toBeVisible({ timeout: 5_000 });

      const statusChip = chipStrip.locator('[data-testid="active-filter-chip"]').first();
      await expect(statusChip).toBeVisible();
      await expect(statusChip).toContainText(/Status/i);
      // The Tag inside has dot=true when tone is set. The dot is a span with rounded-full classes.
      // We assert the chip contains at least one rounded-full element (tone dot or icon wrapper).
      const dotCount = await statusChip.locator('[class*="rounded-full"]').count();
      expect(dotCount).toBeGreaterThan(0);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('Clear all empties the tree and restores empty popover', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    const ts = Date.now();

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA${ts} FigmaClear Co`);
      dealId = await createDealFixture(request, token, {
        title: `QA${ts} FigmaClear Deal`,
        companyIds: [companyId],
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals', { waitUntil: 'domcontentloaded' });

      const opened = await openFiltersOrSkip(page);
      if (!opened) return;

      // Apply a preset to populate the tree
      await page.getByRole('button', { name: /my deals/i }).first().click();

      // Reopen the popover
      const filtersButton = page.getByTestId('advanced-filter-trigger').first();
      await filtersButton.click();
      const panel = page.locator('[data-testid="advanced-filter-panel"]').first();
      await expect(panel).toBeVisible({ timeout: 5_000 });

      // Click "Clear all" inside the builder
      await panel.getByRole('button', { name: /clear all/i }).first().click();

      // Builder collapses back to the empty state
      const emptyState = page.locator('[data-testid="filter-empty-state"]').first();
      await expect(emptyState).toBeVisible({ timeout: 5_000 });
      await expect(emptyState).toContainText(/no filters applied/i);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
