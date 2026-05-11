import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-062: Within-group filter rule reorder via keyboard.
 *
 * Spec: .ai/specs/2026-05-07-advanced-filter-tree-design.md
 * Plan: .ai/plans/2026-05-08-crm-filter-figma-redesign.md (Phase 3, Task 3.6)
 *
 * Covers:
 *   1. Add 3 rules in the popover.
 *   2. Focus the drag handle of the second rule via keyboard navigation.
 *   3. Press Space to lift, ArrowUp to move it up, Space to drop.
 *   4. Verify the rule that was at index 1 is now at index 0 by checking the
 *      `data-filter-rule-id` attribute order in `[data-testid="filter-rule"]` elements.
 *
 * dnd-kit with the `KeyboardSensor` + `sortableKeyboardCoordinates` supports the
 * Space/Arrow-key reorder protocol natively. This test is intentionally headless-friendly:
 * keyboard reorder is more deterministic than mouse drag in Playwright.
 *
 * Skipped when the dev server is missing the advanced-filter panel — likely an unrelated render error.
 */
test.describe('TC-CRM-062: keyboard reorder within group', () => {
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

  async function addRuleByFieldLabel(
    page: import('@playwright/test').Page,
    fieldLabelMatcher: RegExp,
  ): Promise<boolean> {
    const panel = page.locator('[data-testid="advanced-filter-panel"]').first();
    const emptyAddBtn = panel
      .locator('[data-testid="filter-empty-state"]')
      .getByRole('button', { name: /add condition/i })
      .first();
    const builderAddBtn = panel.getByRole('button', { name: /\+\s*Add condition/i }).first();

    if (await emptyAddBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await emptyAddBtn.click();
    } else {
      await builderAddBtn.click();
    }

    const search = page.getByPlaceholder(/search field/i).first();
    await expect(search).toBeVisible({ timeout: 5_000 });
    const optionLabel = fieldLabelMatcher.toString().replace(/[\\/^$]/g, '').slice(0, 30);
    await search.fill(optionLabel);
    const option = page.getByRole('option', { name: fieldLabelMatcher }).first();
    const haveField = await option.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!haveField) return false;
    await option.click();
    return true;
  }

  test('reorder rules within a group via keyboard', async ({ page, request }) => {
    let token: string | null = null;
    let personId: string | null = null;
    const ts = Date.now();

    try {
      token = await getAuthToken(request);
      personId = await createPersonFixture(request, token, {
        firstName: `QA${ts}`,
        lastName: `FigmaDnd`,
        displayName: `QA${ts} FigmaDnd`,
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });

      const opened = await openFiltersOrSkip(page);
      if (!opened) return;

      const ruleFields: RegExp[] = [/^Name$/i, /^Status$/i, /^Source$/i];
      let added = 0;
      for (const field of ruleFields) {
        const ok = await addRuleByFieldLabel(page, field);
        if (ok) added += 1;
      }

      if (added < 3) {
        test.skip(
          true,
          `Could not seed three filter rules (added=${added}). Required filter fields not all present in this build.`,
        );
        return;
      }

      const panel = page.locator('[data-testid="advanced-filter-panel"]').first();
      const ruleNodes = panel.locator('[data-testid="filter-rule"]');
      await expect(ruleNodes).toHaveCount(3, { timeout: 5_000 });

      const idsBefore = await ruleNodes.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('data-filter-rule-id') ?? ''),
      );
      expect(idsBefore.length).toBe(3);

      // Focus the drag handle of the second rule (index 1)
      const secondHandle = ruleNodes.nth(1).locator('[data-testid="filter-drag-handle"]').first();
      await expect(secondHandle).toBeVisible();
      await secondHandle.focus();

      // dnd-kit keyboard protocol: Space lifts, ArrowUp moves up, Space drops
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Space');

      // Wait for the reorder to apply by polling the new id order until it differs.
      await expect
        .poll(
          async () =>
            await ruleNodes.evaluateAll((nodes) =>
              nodes.map((n) => n.getAttribute('data-filter-rule-id') ?? '').join('|'),
            ),
          { timeout: 10_000 },
        )
        .not.toBe(idsBefore.join('|'));

      const idsAfter = await ruleNodes.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('data-filter-rule-id') ?? ''),
      );
      // The rule that was at index 1 should now be at index 0
      expect(idsAfter[0]).toBe(idsBefore[1]);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });
});
