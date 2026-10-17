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
 * rule"), which requires exactly one `eligibleCurrencies` entry (D-R4-27).
 * Step 8.7 added the "Eligible currencies" field to the promotion metadata
 * form (`promotionFormFields.tsx`'s Settings panel) — this spec now sets it
 * through that real field instead of pre-seeding `eligibleCurrencies` on the
 * fixture's `POST /api/promotions` call, so the test proves the UI gap QA
 * flagged (F1) is actually closed end to end.
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
      });
      promotionId = fixture.id;

      await login(page, 'admin');
      await page.goto(`/backend/promotions/${promotionId}`, { waitUntil: 'domcontentloaded' });

      // --- Set the eligible currency through the real "Eligible currencies"
      // field (Step 8.7, QA F1) before touching the tree, then reload so the
      // tree builder's independently-fetched `updatedAt` reflects the
      // metadata save and its own later PUT does not 409 on a stale value. --
      const eligibleCurrenciesField = page.locator('[data-crud-field-id="eligibleCurrencies"]');
      await expect(eligibleCurrenciesField).toBeVisible();
      await eligibleCurrenciesField.getByPlaceholder('Search...').fill('USD');
      await eligibleCurrenciesField.getByRole('button', { name: /^USD/ }).click();
      // CrudForm renders both a sticky and an inline submit button at once (same
      // established pattern TC-PROM-083 already disambiguates with .first()).
      await page.getByRole('button', { name: 'Save promotion' }).first().click();
      await expect(page.getByText('Promotion saved')).toBeVisible();

      await page.reload({ waitUntil: 'domcontentloaded' });

      await expect(page.getByText('Rules & Benefits')).toBeVisible();
      // The tree builder fetches the promotion's tree independently of the
      // metadata CrudForm above it — wait for its own loading state to clear.
      await expect(page.getByText('Loading rule tree...')).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(1);

      // --- Root group: one order_value rule ---------------------------------
      await page.getByRole('button', { name: 'Add rule' }).first().click();

      // Anchored + case-sensitive: a plain `hasText: 'Value'` string filter is
      // case-insensitive substring matching, so it also matches the rule-type
      // Select's own rendered text ("Rule type" + its selected option's label,
      // e.g. "Order value") now that Step 8.8 swapped that picker from a
      // ComboboxInput (selected text lives in an <input> value, not real DOM
      // text content) to a Select (SelectValue renders real text content).
      // Each field's own label starts with its exact field name, so anchoring
      // at the start keeps this scoped to the real "Value" field only.
      const valueFields = page.locator('label').filter({ hasText: /^Value/ });
      const operatorFields = page.locator('label').filter({ hasText: /^Operator/ });
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
      // The locale field used to be a free-text input; it is now a `Select`
      // constrained to the app's supported locales (QA F4).
      await page.getByRole('combobox', { name: 'Locale code (e.g. en)' }).click();
      await page.getByRole('option', { name: 'en', exact: true }).click();
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
