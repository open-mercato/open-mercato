import { expect, test, type Page } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createCurrencyFixture, deleteCurrenciesEntityIfExists } from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  PROMOTIONS_PATH,
  createPromotionFixture,
  getPromotionDetail,
  promotionTreePath,
  uniqueStamp,
} from './helpers';
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers';

test.use({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });

const windowDates = {
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-10-31T23:59:59.999Z',
};
const currenciesPath = '/api/currencies/currencies';

async function loginInPolish(page: Page) {
  await login(page, 'admin');
  await page.context().addCookies([{ name: 'locale', value: 'pl', url: new URL(page.url()).origin }]);
}

function dateTrigger(page: Page, field: string) {
  return page.getByRole('button', { name: field, exact: true });
}

async function chooseDate(page: Page, field: string, day: string) {
  await dateTrigger(page, field).click();
  const calendar = page.getByRole('dialog');
  await calendar.getByRole('button', { name: day, exact: true }).click();
  await calendar.getByRole('button', { name: 'Zastosuj', exact: true }).click();
  await expect(calendar).toBeHidden();
}

async function expectOctoberDates(page: Page) {
  await expect(dateTrigger(page, 'Zaczyna się')).toHaveText('1 paź 2026');
  await expect(dateTrigger(page, 'Kończy się')).toHaveText('31 paź 2026');
}

test.describe('TC-PROM-085: Polish promotion form', () => {
  test('persists comma decimals and October dates and rejects mixed separators at mobile width', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    let promotionId: string | null = null;
    let currencyId: string | null = null;

    try {
      const options = await apiRequest(request, 'GET', `${currenciesPath}/options?limit=100`, { token });
      expect(options.ok()).toBeTruthy();
      const currencyOptions = await readJsonSafe<{ items: { value: string }[] }>(options);
      if (!currencyOptions?.items.some(({ value }) => value === 'USD')) {
        currencyId = await createCurrencyFixture(request, token, { code: 'USD', name: 'US Dollar' });
      }

      await loginInPolish(page);
      await page.clock.setFixedTime(new Date('2026-10-15T12:00:00.000Z'));
      await page.goto('/backend/promotions/create');
      const name = `QA PROM 085 ${uniqueStamp()}`;
      await page.getByRole('textbox', { name: /^Nazwa/ }).fill(name);
      await chooseDate(page, 'Zaczyna się', 'czwartek, 1 października 2026');
      await chooseDate(page, 'Kończy się', 'sobota, 31 października 2026');

      const budget = page.getByRole('textbox', { name: 'Maksymalny budżet' });
      const currency = page.getByRole('combobox', { name: 'Waluta budżetu' });
      const savePromotion = page.getByRole('button', { name: 'Zapisz promocję', exact: true }).first();
      await budget.fill('1500,50');
      await currency.click();
      await page.getByRole('option', { name: /^USD - / }).click();

      const [created] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === PROMOTIONS_PATH && response.request().method() === 'POST'),
        savePromotion.click(),
      ]);
      const createdBody = await created.json() as { id?: string };
      if (createdBody.id) promotionId = createdBody.id;
      expect(created.status(), 'the Polish create form accepts a comma budget').toBe(201);
      promotionId = expectId(promotionId, 'the create response identifies the promotion');
      await page.waitForURL(`**/backend/promotions/${promotionId}`);
      await page.reload();
      await expect(budget).toHaveValue('1500.50');
      await expect(currency).toContainText('USD');
      await expectOctoberDates(page);

      await page.getByRole('button', { name: 'Dodaj korzyść', exact: true }).click();
      const value = page.locator('label').filter({ hasText: /^Wartość$/ }).getByRole('textbox');
      await value.fill('10,5');
      await page.getByRole('combobox', { name: 'Kod języka (np. en)' }).click();
      await page.getByRole('option', { name: 'pl', exact: true }).click();
      await page.getByRole('button', { name: 'Dodaj język', exact: true }).click();
      await page.getByPlaceholder('Tekst etykiety').fill('Rabat październikowy');
      const treePath = promotionTreePath(promotionId);
      const [savedTree] = await Promise.all([
        page.waitForResponse((response) =>
          new URL(response.url()).pathname === treePath && response.request().method() === 'PUT'),
        page.getByRole('button', { name: 'Zapisz reguły', exact: true }).click(),
      ]);
      expect(savedTree.ok(), 'the rule tree accepts a comma benefit').toBeTruthy();
      await page.reload();
      await expect(value).toHaveValue('10.5');
      await expect(budget).toHaveValue('1500.50');
      await expectOctoberDates(page);
      expect(await getPromotionDetail(request, token, promotionId)).toMatchObject({
        ...windowDates,
        maxBudget: '1500.50',
        budgetCurrency: 'USD',
        ruleGroupTree: { benefits: [{ config: { value: '10.5' } }] },
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await expectOctoberDates(page);
      await expect(budget).toBeVisible();
      const budgetBounds = await budget.boundingBox();
      expect(budgetBounds?.x).toBeGreaterThanOrEqual(0);
      expect(budgetBounds && budgetBounds.x + budgetBounds.width).toBeLessThanOrEqual(390);
      await budget.fill('1,500.50');
      const [rejected] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === PROMOTIONS_PATH && response.request().method() === 'PUT'),
        savePromotion.click(),
      ]);
      expect(rejected.status()).toBe(400);
      await page.reload();
      await expect(budget).toHaveValue('1500.50');
      await expect(value).toHaveValue('10.5');
      await expectOctoberDates(page);
    } finally {
      try {
        if (promotionId) {
          const detail = await getPromotionDetail(request, token, promotionId);
          const deleted = await apiRequest(request, 'DELETE', `${PROMOTIONS_PATH}?id=${promotionId}`, {
            token,
            headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: detail.updatedAt },
          });
          expect(deleted.ok(), 'remove the promotion created by this test').toBeTruthy();
        }
      } finally {
        await deleteCurrenciesEntityIfExists(request, token, currenciesPath, currencyId);
      }
    }
  });

  test('shows October 31 for a persisted UTC end-of-day timestamp', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const fixture = await createPromotionFixture(request, token, windowDates);

    try {
      await loginInPolish(page);
      await page.goto(`/backend/promotions/${fixture.id}`);
      await expectOctoberDates(page);
    } finally {
      const deleted = await apiRequest(request, 'DELETE', `${PROMOTIONS_PATH}?id=${fixture.id}`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: fixture.updatedAt },
      });
      expect(deleted.ok(), 'remove the persisted-date fixture').toBeTruthy();
    }
  });
});
