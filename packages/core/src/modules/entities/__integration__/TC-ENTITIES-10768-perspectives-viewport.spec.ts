import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createCustomEntity, deleteCustomEntityIfExists, uniqueEntityId } from './helpers/entitiesApi';

export const integrationMeta = {
  dependsOnModules: ['customers', 'perspectives'],
};

const locales = {
  en: { views: 'Views', saved: 'Saved views', close: 'Close', filters: 'Advanced filters', clear: '— No view —', all: 'All views', longName: 'DetailedRecordView' },
  pl: { views: 'Perspektywy', saved: 'Zapisane widoki', close: 'Zamknij', filters: 'Filtry zaawansowane', clear: '— Brak widoku —', all: 'Wszystkie widoki', longName: 'SzczegółowyWidokRekordów' },
} as const;

for (const [locale, labels] of Object.entries(locales)) {
  test(`TC-ENTITIES-10768: saved views fit at 390px and desktop (${locale})`, async ({
    page, request, baseURL,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const entityId = uniqueEntityId('view');
    const tableId = encodeURIComponent(`data-table:entities.user.records.${entityId}`);
    const viewName = labels.longName.repeat(5);
    let perspectiveId: string | undefined;

    try {
      expect((await createCustomEntity(request, token, { entityId, label: 'Saved view QA' })).ok()).toBe(true);
      const created = await apiRequest(request, 'POST', `/api/perspectives/${tableId}`, {
        token,
        data: { name: viewName, settings: {} },
      });
      expect(created.ok()).toBe(true);
      perspectiveId = (await readJsonSafe<{ perspective?: { id: string } }>(created))?.perspective?.id;
      expect(perspectiveId).toBeTruthy();

      await login(page, 'admin');
      await page.context().addCookies([{ name: 'locale', value: locale, url: baseURL ?? page.url() }]);
      await page.setViewportSize({ width: 390, height: 900 });

      const sidebar = page.getByRole('button', { name: labels.views, exact: true });
      const selector = sidebar.locator('..').locator('button[aria-haspopup="dialog"]');
      const expectToolbarFits = async () => {
        await expect.poll(() => sidebar.evaluate((button) => {
          const toolbar = button.parentElement;
          if (!toolbar) throw new Error('Views controls have no toolbar');
          const bounds = toolbar.getBoundingClientRect();
          const viewportWidth = document.documentElement.clientWidth;
          return {
            outsideViewport: Math.max(0, -bounds.left, bounds.right - viewportWidth),
            toolbarOverflow: Math.max(0, toolbar.scrollWidth - toolbar.clientWidth),
            pageOverflow: document.documentElement.scrollWidth - viewportWidth,
          };
        })).toEqual({ outsideViewport: 0, toolbarOverflow: 0, pageOverflow: 0 });
      };

      await page.goto('/backend/customers/companies');
      await expect(selector).toHaveAccessibleName(labels.all);
      await expectToolbarFits();
      const newCompany = page.locator('a[href="/backend/customers/companies/create"]');
      await expect(newCompany).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: labels.filters, exact: true })).toBeInViewport({ ratio: 1 });
      await selector.press('Enter');
      await expect(page.getByRole('dialog').getByRole('button', { name: labels.clear, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');

      await page.goto(`/backend/entities/user/${encodeURIComponent(entityId)}/records`);
      await expect(sidebar).toBeVisible();
      await expect(selector).toHaveAccessibleName(viewName);
      await expectToolbarFits();
      await sidebar.focus();
      await page.keyboard.press('Enter');
      const savedViews = page.getByRole('heading', { name: labels.saved });
      await expect(savedViews).toBeVisible();
      await page.getByRole('button', { name: labels.close, exact: true }).press('Enter');
      await expect(savedViews).toBeHidden();

      await sidebar.focus();
      await page.keyboard.press('Tab');
      await expect(selector).toBeFocused();
      await page.keyboard.press('Enter');
      const popover = page.getByRole('dialog');
      await popover.getByRole('button', { name: labels.clear, exact: true }).press('Enter');
      await expect(popover).toBeHidden();
      await expect(selector).toHaveAccessibleName(labels.all);
      await expect(selector).toBeFocused();
      await expectToolbarFits();

      await page.keyboard.press('Enter');
      const option = popover.getByRole('button', { name: viewName, exact: true });
      await expect(option).toBeVisible();
      await option.press('Enter');
      await expect(popover).toBeHidden();

      await expect(selector).toHaveAccessibleName(viewName);
      await expect(selector).toBeFocused();
      await expectToolbarFits();
      await expect.poll(() => sidebar.getByText(labels.views, { exact: true }).evaluate(
        (label) => label.scrollWidth - label.clientWidth,
      )).toBe(0);
      await page.keyboard.press('Enter');
      await expect(popover).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(selector).toBeFocused();

      const scroll = page.getByRole('table').locator('..');
      await expect.poll(() => scroll.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
        return element.scrollLeft;
      })).toBeGreaterThan(0);
      await expectToolbarFits();

      await page.setViewportSize({ width: 1280, height: 900 });
      await expectToolbarFits();
      await selector.press('Enter');
      await expect(popover.getByRole('button', { name: viewName, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(selector).toBeFocused();
    } finally {
      if (perspectiveId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${tableId}/${perspectiveId}`, { token });
      }
      await deleteCustomEntityIfExists(request, token, entityId);
    }
  });
}
