import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CRM-018: Person Display Name Edit And Undo
 */
test.describe('TC-CRM-018: Person Display Name Edit And Undo', () => {
  test('should edit person display name and undo the update', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/people');

    const personLink = page.locator('table tbody tr').first().getByRole('link').first();
    await expect(personLink).toBeVisible();
    await personLink.click();

    const displayNameButton = page.getByRole('button', { name: /^Display name / }).first();
    await expect(displayNameButton).toBeVisible();
    const displayNameLabel = ((await displayNameButton.innerText()) || '').trim();
    const originalName = displayNameLabel.replace(/^display name\s+/i, '').replace(/\s+/g, ' ').trim();

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

    await page.getByRole('button', { name: 'Version History' }).click();
    await expect(page.getByRole('heading', { name: 'Version History' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo last action' }).click();
    await expect.poll(readDisplayName).toContain(originalName);
  });
});
