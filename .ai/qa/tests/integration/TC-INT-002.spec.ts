import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { createSalesDocument } from '../helpers/salesUi';

/**
 * TC-INT-002: Customer to Deal to Quote to Order Flow
 * Source: .ai/qa/scenarios/TC-INT-002-customer-deal-order-flow.md
 */
test.describe('TC-INT-002: Customer to Deal to Quote to Order Flow', () => {
  test('should create CRM records and open a sales order flow', async ({ page }) => {
    const stamp = Date.now();
    const companyName = `QA INT-002 Co ${stamp}`;
    const personFirst = `QA${stamp}`;
    const personLast = 'IntFlow';
    const dealTitle = `QA INT-002 Deal ${stamp}`;

    await login(page, 'admin');

    await page.goto('/backend/customers/companies/create');
    await page.locator('form').getByRole('textbox').first().fill(companyName);
    await page.getByPlaceholder('https://example.com').fill('https://example.com');
    await page.locator('form').getByRole('button', { name: /Create Company/i }).click();
    await expect(page).toHaveURL(/\/backend\/customers\/companies\/[0-9a-f-]{36}$/i);

    await page.goto('/backend/customers/people/create');
    await page.locator('form').getByRole('textbox').first().fill(personFirst);
    await page.locator('form').getByRole('textbox').nth(1).fill(personLast);
    await page.getByPlaceholder('name@example.com').fill(`qa-int-002-${stamp}@example.com`);
    await page.getByPlaceholder('+00 000 000 000').fill('+1 555 010 0020');
    await page.locator('select').filter({ has: page.locator('option', { hasText: companyName }) }).first().selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Create Person' }).first().click();
    await expect(page).toHaveURL(/\/backend\/customers\/people\/[0-9a-f-]{36}$/i);

    await page.goto('/backend/customers/deals/create');
    await page.locator('form').getByRole('textbox').first().fill(dealTitle);
    await page.locator('select').filter({ has: page.locator('option', { hasText: 'Open' }) }).first().selectOption({ label: 'Open' });
    await page.locator('select').filter({ has: page.locator('option', { hasText: 'Opportunity' }) }).first().selectOption({ label: 'Opportunity' });
    await page.getByRole('spinbutton').first().fill('10000');
    await page.locator('select').filter({ has: page.locator('option', { hasText: /USD/i }) }).first().selectOption({ index: 1 });
    await page.getByRole('spinbutton').nth(1).fill('50');
    await page.locator('input[type="date"]').fill('2026-12-31');
    await page.getByRole('textbox', { name: /Search companies/i }).fill(companyName);
    await page.getByRole('button', { name: companyName, exact: true }).click();
    await page.getByRole('button', { name: 'Create deal' }).first().click();
    await expect(page).toHaveURL(/\/backend\/customers\/deals$/i);

    await createSalesDocument(page, { kind: 'order', customerQuery: companyName });
    await expect(page).toHaveURL(/kind=order$/i);
  });
});
