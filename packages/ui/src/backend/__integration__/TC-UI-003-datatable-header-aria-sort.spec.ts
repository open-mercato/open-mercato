import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';

test('TC-UI-003: DataTable sortable headers announce their sort state through aria-sort', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin');
  const prefix = `TC-UI-003 ${Date.now()}`;
  const companyIds: string[] = [];
  try {
    companyIds.push(await createCompanyFixture(request, token, `${prefix} Alpha`));
    companyIds.push(await createCompanyFixture(request, token, `${prefix} Beta`));

    await login(page, 'admin');
    await page.goto(`/backend/customers/companies?search=${encodeURIComponent(prefix)}`);
    await expect(page.getByText(`${prefix} Alpha`)).toBeVisible();

    const sortableHeaders = page.locator('thead th[aria-sort]');
    await expect.poll(() => sortableHeaders.count()).toBeGreaterThan(1);

    const unsortedHeader = page.locator('thead th[aria-sort="none"]').first();
    await expect(unsortedHeader).toBeVisible();
    const headerLabel = ((await unsortedHeader.textContent()) ?? '').trim();
    expect(headerLabel.length).toBeGreaterThan(0);
    const header = page.locator('thead th[aria-sort]').filter({ hasText: headerLabel }).first();

    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', /^(ascending|descending)$/);
    const firstDirection = await header.getAttribute('aria-sort');
    await expect(page.locator('thead th[aria-sort="ascending"], thead th[aria-sort="descending"]')).toHaveCount(1);

    await header.getByRole('button').click();
    await expect(header).not.toHaveAttribute('aria-sort', firstDirection ?? '');
    await expect(page.locator('thead th[aria-sort="ascending"], thead th[aria-sort="descending"]')).toHaveCount(1);

    const nonSortableHeaders = page.locator('thead th:not([aria-sort])');
    const nonSortableCount = await nonSortableHeaders.count();
    for (let index = 0; index < nonSortableCount; index += 1) {
      await expect(nonSortableHeaders.nth(index)).not.toHaveAttribute('role', 'button');
    }
    await expect(page.locator('thead th[role="button"]')).toHaveCount(0);
  } finally {
    for (const id of companyIds) {
      await deleteEntityIfExists(request, token, '/api/customers/companies', id);
    }
  }
});
