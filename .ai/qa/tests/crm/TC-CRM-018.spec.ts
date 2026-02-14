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
    const originalName = displayNameLabel.replace(/^Display name\s+/, '').trim();

    const editButton = displayNameButton.locator('xpath=..').getByRole('button').nth(1);
    await editButton.click();

    let input = page.getByPlaceholder(/Enter (display name|full name|name)/i).first();
    if ((await input.count()) === 0) {
      input = page.locator('main input[type="text"]').first();
    }
    await expect(input).toBeVisible();
    const updatedName = `${originalName} QA`;

    await input.fill(updatedName);
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(displayNameButton).toContainText(updatedName);

    await page.getByRole('button', { name: /^Undo(?: last action)?$/ }).click();
    await expect(displayNameButton).toContainText(originalName);
  });
});
