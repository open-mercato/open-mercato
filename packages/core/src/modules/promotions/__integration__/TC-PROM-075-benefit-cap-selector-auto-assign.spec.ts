import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createPromotionFixture, deletePromotionIfExists, uniqueStamp } from './helpers';

/**
 * TC-PROM-075: a capped benefit cannot be saved without a selector.
 *
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Implementation
 * Plan Phase 1 step 18.
 *
 * Step 1.8's own report (and `components/benefitLimits.ts`'s file-level
 * comment) states the write-path rejection — "a quantity cap with no
 * selector" — is made UNREACHABLE BY CONSTRUCTION in this UI:
 * `applyQuantityCapChange` auto-assigns the `cart_order` ("First added")
 * selector the instant an operator sets `maxQuantity`/`maxLines`, rather
 * than letting the operator submit an invalid combination and rejecting it
 * at Save time. This spec verifies that actual behavior (the "Which pieces"
 * selector appears with a default value the moment a cap is set, and that
 * default survives a save/reload) instead of the naive "blocked Save
 * button" framing the step description used, per the Step 1.10 brief's own
 * instruction to adjust the test to the real, correct UI behavior.
 */
test.describe('TC-PROM-075: capped benefit auto-assigns a selector', () => {
  test('setting a quantity cap on a benefit reveals and defaults the "Which pieces" selector, and it persists', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, { name: `QA PROM 075 ${stamp}` });
      promotionId = fixture.id;

      await login(page, 'admin');
      await page.goto(`/backend/promotions/${promotionId}`, { waitUntil: 'domcontentloaded' });

      await expect(page.getByText('Rules & Benefits')).toBeVisible();
      await expect(page.getByText('Loading rule tree...')).toHaveCount(0, { timeout: 20_000 });

      // Default benefit type is `product_discount` with `appliesTo: 'line'`
      // (`BENEFIT_APPLIES_TO.product_discount.default`), so the Limits row is
      // shown but starts uncapped — no "Which pieces" selector yet.
      await page.getByRole('button', { name: 'Add benefit' }).click();
      await expect(page.getByText('Max quantity')).toBeVisible();
      await expect(page.getByText('Which pieces')).toHaveCount(0);
      // The Nth-piece toggle is the uncapped mode's alternative control —
      // visible and enabled while no cap is set.
      await expect(page.getByText('Limit to the Nth piece/line')).toBeVisible();

      const maxQuantityInput = page.locator('label').filter({ hasText: 'Max quantity' }).locator('input');
      await maxQuantityInput.fill('3');
      await expect(maxQuantityInput).toHaveValue('3');

      // The moment a cap is set, the UI makes the omitted-selector state
      // unreachable: "Which pieces" appears, already defaulted to "First
      // added" — the operator never has a chance to leave it blank.
      const selectorField = page.locator('label').filter({ hasText: 'Which pieces' });
      await expect(selectorField).toBeVisible();
      await expect(selectorField.getByRole('combobox')).toContainText('First added');
      // The mutually-exclusive Nth toggle is now hidden entirely by construction
      // (`BenefitLimitsEditor` only renders it in the uncapped branch) — a capped
      // benefit can never also be in Nth-position mode.
      await expect(page.getByRole('checkbox', { name: 'Limit to the Nth piece/line' })).toHaveCount(0);

      // Pick a different, still-valid selector to prove the dropdown is a
      // real, persisted choice rather than a hardcoded label.
      await selectorField.getByRole('combobox').click();
      await page.getByRole('option', { name: 'Most expensive', exact: true }).click();
      await expect(selectorField.getByRole('combobox')).toContainText('Most expensive');

      // A benefit still needs a non-blank label before it can be saved. The
      // locale field used to be a free-text input; it is now a `Select`
      // constrained to the app's supported locales (Step 8.8, QA F4) — same
      // pattern TC-PROM-074 already proves.
      await page.getByRole('combobox', { name: 'Locale code (e.g. en)' }).click();
      await page.getByRole('option', { name: 'en', exact: true }).click();
      await page.getByRole('button', { name: 'Add locale' }).click();
      await page.getByPlaceholder('Label text').fill('Capped benefit');

      await page.getByRole('button', { name: 'Save rules' }).click();
      await expect(page.getByText('Rule tree saved').first()).toBeVisible();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Loading rule tree...')).toHaveCount(0, { timeout: 20_000 });

      await expect(page.locator('label').filter({ hasText: 'Max quantity' }).locator('input')).toHaveValue('3');
      await expect(page.locator('label').filter({ hasText: 'Which pieces' }).getByRole('combobox')).toContainText(
        'Most expensive',
      );
      // A valid-labels benefit's Labels section defaults to collapsed on load
      // (only an invalid/empty-labels benefit auto-expands it) — expand it to
      // read the persisted label back.
      await page.getByRole('button', { name: 'Expand Labels section' }).click();
      await expect(page.getByPlaceholder('Label text')).toHaveValue('Capped benefit');
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
