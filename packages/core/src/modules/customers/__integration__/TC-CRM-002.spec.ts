import { expect, test, type Locator, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * Workaround for the DS v2 Input primitive focus race that breaks Playwright `.fill()`
 * when multiple fields are filled in quick succession. The wrapper-div + focus-within
 * styling changed focus/blur sequencing — `.fill()` can land typed characters in the
 * previously focused input. Click forces focus, an explicit clear handles existing
 * values, and `keyboard.type` walks key events through the browser focus pipeline.
 */
async function safeFill(page: Page, locator: Locator, value: string): Promise<void> {
  await locator.click({ force: true });
  await locator.focus();
  await locator.press('ControlOrMeta+a');
  await locator.press('Delete');
  await page.keyboard.type(value);
  await expect(locator).toHaveValue(value);
}

/**
 * TC-CRM-002: Company Creation Validation Errors
 * Source: .ai/qa/scenarios/TC-CRM-002-company-creation-validation.md
 */
test.describe('TC-CRM-002: Company Creation Validation Errors', () => {
  test('should block invalid input, show field errors, then allow create after correction', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const companyName = `QA TC-CRM-002 ${Date.now()}`;

    try {
      token = await getAuthToken(request);

      await login(page, 'admin');
      await page.goto('/backend/customers/companies/create');

      await page.getByRole('button', { name: 'Create Company' }).first().click();
      await expect(page).toHaveURL(/\/backend\/customers\/companies\/create$/i);

      // Sequential fills on the DS v2 Input primitive race Playwright `.fill()` and
      // cross-write characters between fields. `safeFill` walks key events through the
      // explicit click → focus → clear → type → assert pipeline (memory option A).
      const displayNameInput = page.locator('[data-crud-field-id="displayName"] input');
      const emailInput = page.locator('[data-crud-field-id="primaryEmail"] input');
      const websiteInput = page.locator('[data-crud-field-id="websiteUrl"] input');

      await safeFill(page, displayNameInput, companyName);
      await safeFill(page, emailInput, 'invalid-email');
      await safeFill(page, websiteInput, 'notaurl');
      await page.getByRole('button', { name: 'Create Company' }).first().click();

      await expect(page.getByText('Invalid email address')).toBeVisible();
      await expect(page.getByText('Invalid URL')).toBeVisible();

      await safeFill(page, emailInput, 'qa+crm002@example.com');
      await safeFill(page, websiteInput, 'https://example.com');
      await page.getByRole('button', { name: 'Create Company' }).first().click();

      await expect(page).toHaveURL(/\/backend\/customers\/companies-v2\/[0-9a-f-]{36}$/i);
      await expect(page.getByText(companyName, { exact: true }).first()).toBeVisible();

      const idMatch = page.url().match(/\/backend\/customers\/companies-v2\/([0-9a-f-]{36})$/i);
      companyId = idMatch?.[1] ?? null;
      expect(companyId, 'Expected created company id in detail URL').toBeTruthy();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
