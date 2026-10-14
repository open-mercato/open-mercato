import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createPromotionFixture, deletePromotionIfExists, uniqueStamp } from './helpers';

/**
 * TC-PROM-074: Rule Group Tree Builder save/reload round trip through the
 * real admin UI (browser-driven, not direct API calls).
 *
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Implementation
 * Plan Phase 1 step 18 — "tree builder save/reload with nested groups and
 * benefits". Step 1.9's `TC-PROM-002` already proves the `PUT
 * /api/promotions/[id]/tree` contract itself round-trips correctly; this
 * spec proves the *UI* (`RuleTreeBuilder`/`RuleGroupNode`/`RuleCard`/
 * `BenefitCard`, Steps 1.7/1.8) builds the exact same payload from real
 * clicks/fills and that a fresh page load renders the persisted tree back
 * identically — a bug in `toServerTree`/`fromServerTree` or in a reducer
 * action would show up here even though the write-path contract test stays
 * green.
 *
 * Uses `order_value` rules (the default type `RuleCard` offers on "Add
 * rule"), so the fixture promotion is created with a single
 * `eligibleCurrencies` entry up front (D-R4-27 — an order_value rule
 * requires exactly one eligible currency).
 */
test.describe('TC-PROM-074: tree builder save/reload with nested groups and benefits', () => {
  test('a rule, a benefit, and a nested child group with its own rule all round-trip through the UI', async ({ page, request }) => {
    test.setTimeout(120_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, {
        name: `QA PROM 074 ${stamp}`,
        eligibleCurrencies: ['USD'],
      });
      promotionId = fixture.id;

      await login(page, 'admin');
      await page.goto(`/backend/promotions/${promotionId}`, { waitUntil: 'domcontentloaded' });

      await expect(page.getByText('Rules & Benefits')).toBeVisible();
      // The tree builder fetches the promotion's tree independently of the
      // metadata CrudForm above it — wait for its own loading state to clear.
      await expect(page.getByText('Loading rule tree...')).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(1);

      // --- Root group: one order_value rule ---------------------------------
      await page.getByRole('button', { name: 'Add rule' }).first().click();

      const valueFields = page.locator('label').filter({ hasText: 'Value' });
      const operatorFields = page.locator('label').filter({ hasText: 'Operator' });
      const taxInclusiveCheckboxes = page.getByRole('checkbox', { name: 'Tax inclusive' });

      await expect(valueFields).toHaveCount(1);
      const rootValueInput = valueFields.nth(0).locator('input');
      await rootValueInput.fill('150');
      await expect(rootValueInput).toHaveValue('150');

      await operatorFields.nth(0).getByRole('combobox').click();
      await page.getByRole('option', { name: 'Greater than', exact: true }).click();
      await expect(operatorFields.nth(0).getByRole('combobox')).toContainText('Greater than');

      await taxInclusiveCheckboxes.nth(0).click();
      await expect(taxInclusiveCheckboxes.nth(0)).toBeChecked();

      // --- A nested child group with its own order_value rule ---------------
      await page.getByRole('button', { name: 'Add sub-group' }).first().click();
      await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(2);

      await page.getByRole('button', { name: 'Add rule' }).nth(1).click();
      await expect(valueFields).toHaveCount(2);

      const childValueInput = valueFields.nth(1).locator('input');
      await childValueInput.fill('77');
      await expect(childValueInput).toHaveValue('77');
      // Child rule's operator is left at its default ("Equals") to prove the
      // default round-trips too, not only an operator the user touched.
      await expect(operatorFields.nth(1).getByRole('combobox')).toContainText('Equals');

      // --- Root group: one benefit (default product_discount) ---------------
      await page.getByRole('button', { name: 'Add benefit' }).first().click();
      await expect(valueFields).toHaveCount(3);

      const benefitValueInput = valueFields.nth(2).locator('input');
      await benefitValueInput.fill('25');
      await expect(benefitValueInput).toHaveValue('25');

      const discountTypeFields = page.locator('label').filter({ hasText: 'Discount type' });
      await expect(discountTypeFields).toHaveCount(1);
      await discountTypeFields.nth(0).getByRole('combobox').click();
      await page.getByRole('option', { name: 'Fixed amount', exact: true }).click();
      await expect(discountTypeFields.nth(0).getByRole('combobox')).toContainText('Fixed amount');

      // A benefit cannot be saved without at least one non-blank label.
      await expect(page.getByText('At least one label is required before this benefit can be saved.')).toBeVisible();
      await page.getByPlaceholder('Locale code (e.g. en)').fill('en');
      await page.getByRole('button', { name: 'Add locale' }).click();
      await page.getByPlaceholder('Label text').fill('Fixed $25 off');
      await expect(page.getByPlaceholder('Label text')).toHaveValue('Fixed $25 off');

      // --- Save, then prove the round trip via a real browser reload --------
      await expect(page.getByText('Unsaved changes')).toBeVisible();
      await page.getByRole('button', { name: 'Save rules' }).click();
      await expect(page.getByText('Rule tree saved').first()).toBeVisible();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Loading rule tree...')).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(2);

      await expect(valueFields).toHaveCount(3);
      await expect(valueFields.nth(0).locator('input')).toHaveValue('150');
      await expect(operatorFields.nth(0).getByRole('combobox')).toContainText('Greater than');
      await expect(taxInclusiveCheckboxes.nth(0)).toBeChecked();

      await expect(valueFields.nth(1).locator('input')).toHaveValue('77');
      await expect(operatorFields.nth(1).getByRole('combobox')).toContainText('Equals');

      await expect(valueFields.nth(2).locator('input')).toHaveValue('25');
      await expect(discountTypeFields.nth(0).getByRole('combobox')).toContainText('Fixed amount');
      // A valid-labels benefit's Labels section defaults to collapsed on load
      // (only an invalid/empty-labels benefit auto-expands it) — expand it to
      // read the persisted label back.
      await page.getByRole('button', { name: 'Expand Labels section' }).click();
      await expect(page.getByPlaceholder('Label text')).toHaveValue('Fixed $25 off');

      await expect(page.getByText('All changes saved')).toBeVisible();
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
