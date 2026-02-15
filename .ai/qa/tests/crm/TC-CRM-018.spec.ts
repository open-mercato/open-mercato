import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { getAuthToken } from '../helpers/api';
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '../helpers/crmFixtures';

/**
 * TC-CRM-018: Person Display Name Edit And Undo
 */
test.describe('TC-CRM-018: Person Display Name Edit And Undo', () => {
  test('should edit person display name and undo the update', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      const originalName = `QA TC-CRM-018 Person ${Date.now()}`;
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-018 Company ${Date.now()}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: 'TCCRM018',
        displayName: originalName,
        companyEntityId: companyId,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/people/${personId}`);

      const displayNameButton = page.getByRole('button', { name: /^Display name / }).first();
      await expect(displayNameButton).toBeVisible();
      const editButton = displayNameButton.locator('xpath=..').getByRole('button').nth(1);
      await editButton.click();

      let input = page.getByPlaceholder(/Enter (display name|full name|name)/i).first();
      if ((await input.count()) === 0) {
        input = page.locator('main input[type="text"]').first();
      }
      await expect(input).toBeVisible();
      const updatedName = `${originalName} QA`;

      await input.fill(updatedName);
      await input.locator('xpath=ancestor::div[1]').getByRole('button', { name: /^Save/ }).click();

      const readDisplayName = async (): Promise<string> => {
        const editInput = page.getByRole('textbox', { name: /Enter display name/i }).first();
        if ((await editInput.count()) > 0) {
          return ((await editInput.inputValue()) || '').replace(/\s+/g, ' ').trim();
        }
        const summaryButton = page.getByRole('button', { name: /^Display name / }).first();
        const raw = ((await summaryButton.innerText()) || '').trim();
        return raw.replace(/^display name\s+/i, '').replace(/\s+/g, ' ').trim();
      };

      await expect.poll(readDisplayName).toContain(updatedName);
      await page.getByRole('button', { name: /^Undo(?: last action)?$/ }).click();
      await expect.poll(readDisplayName).toContain(originalName);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
