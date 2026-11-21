import { expect, test, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';

export const integrationMeta = {
  dependsOnModules: ['wms', 'sales'],
};

type ViewportOverflow = {
  viewportWidth: number;
  documentScrollWidth: number;
  tableWidth: number;
  scrollOwnerClientWidth: number;
  scrollOwnerScrollWidth: number;
  scrollOwnerOverflowX: string;
};

async function measureTableOverflow(page: Page): Promise<ViewportOverflow> {
  const table = page.locator('table[data-slot="table"]').first();
  await expect(table).toBeVisible();
  return table.evaluate((element) => {
    const scrollOwner = element.parentElement as HTMLElement;
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      tableWidth: element.getBoundingClientRect().width,
      scrollOwnerClientWidth: scrollOwner.clientWidth,
      scrollOwnerScrollWidth: scrollOwner.scrollWidth,
      scrollOwnerOverflowX: getComputedStyle(scrollOwner).overflowX,
    };
  });
}

test.use({ viewport: { width: 390, height: 844 } });

for (const listPath of ['/backend/wms/lots', '/backend/sales/orders']) {
  test(`TC-UI-004: DataTable stays inside a 390px viewport on ${listPath}`, async ({ page }) => {
    await login(page, 'admin');
    await page.goto(listPath);
    await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true');

    const overflow = await measureTableOverflow(page);
    expect(overflow.tableWidth).toBeGreaterThan(overflow.viewportWidth);
    expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth);
    expect(['auto', 'scroll']).toContain(overflow.scrollOwnerOverflowX);
    expect(overflow.scrollOwnerClientWidth).toBeLessThanOrEqual(overflow.viewportWidth);
    expect(overflow.scrollOwnerScrollWidth).toBeGreaterThan(overflow.scrollOwnerClientWidth);

    const lastHeader = page.locator('table[data-slot="table"] thead th').last();
    await lastHeader.scrollIntoViewIfNeeded();
    await expect(lastHeader).toBeInViewport();
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });
}
