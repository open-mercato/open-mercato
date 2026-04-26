import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

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

      // Target by field id rather than placeholder — placeholder lookup
      // was racing onto the wrong input under DS v2 (notaurl ended up in
      // the email field instead of website on CI screenshots).
      //
      // After each .fill(), assert toHaveValue() to flush the controlled
      // state in CrudForm's TextInput before the next action. The DS v2
      // Input primitive added a wrapper-div + focus-within styling, which
      // changed focus/blur event sequencing — fast sequential fills can
      // race the React batched setState/useEffect(value) sync chain and
      // cross-write between fields without this guard.
      const displayNameInput = page.locator('[data-crud-field-id="displayName"] input');
      const emailInput = page.locator('[data-crud-field-id="primaryEmail"] input');
      const websiteInput = page.locator('[data-crud-field-id="websiteUrl"] input');

      await displayNameInput.fill(companyName);
      await expect(displayNameInput).toHaveValue(companyName);
      await emailInput.fill('invalid-email');
      await expect(emailInput).toHaveValue('invalid-email');
      await websiteInput.fill('notaurl');
      await expect(websiteInput).toHaveValue('notaurl');
      await page.getByRole('button', { name: 'Create Company' }).first().click();

      await expect(page.getByText('Invalid email address')).toBeVisible();
      await expect(page.getByText('Invalid URL')).toBeVisible();

      await emailInput.fill('qa+crm002@example.com');
      await expect(emailInput).toHaveValue('qa+crm002@example.com');
      await websiteInput.fill('https://example.com');
      await expect(websiteInput).toHaveValue('https://example.com');
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
