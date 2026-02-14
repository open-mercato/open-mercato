import { expect, type Page } from '@playwright/test';

export async function createUserViaUi(page: Page, input: { email: string; password: string; role?: string }) {
  const role = input.role ?? 'employee';

  await page.goto('/backend/users/create');
  await expect(page.getByText('Create User')).toBeVisible();

  await page.getByRole('textbox').nth(0).fill(input.email);
  await page.getByRole('textbox').nth(1).fill(input.password);

  const orgSelect = page
    .locator('main')
    .locator('select')
    .filter({ has: page.locator('option', { hasText: 'Acme Corp' }) })
    .first();
  await expect(orgSelect).toBeEnabled();
  await orgSelect.selectOption({ label: 'Acme Corp' });

  const rolesInput = page.getByRole('textbox', { name: /add tag and press enter/i });
  await rolesInput.fill(role);
  await rolesInput.press('Enter');

  await page.getByRole('button', { name: 'Create' }).first().click();
  await expect(page).toHaveURL(/\/backend\/users(?:\?.*)?$/);
  await page.getByRole('textbox', { name: 'Search' }).fill(input.email);
  await expect(page.getByRole('row', { name: new RegExp(input.email, 'i') })).toBeVisible();
}
