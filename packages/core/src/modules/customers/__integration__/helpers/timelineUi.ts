import { expect, type Locator, type Page } from '@playwright/test';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export async function pickCalendarDate(page: Page, trigger: Locator, dateKey: string): Promise<void> {
  const [year, month, day] = dateKey.split('-').map((part) => Number(part));
  const monthName = MONTHS[month - 1];
  await trigger.click();
  const dayButton = page.getByRole('button', {
    name: new RegExp(`${monthName} ${day}(st|nd|rd|th)?,? ${year}`),
  });
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (await dayButton.first().isVisible().catch(() => false)) break;
    await page.getByRole('button', { name: /next month/i }).first().click();
  }
  await dayButton.first().click();
}

export function utcMonthDayLabel(dateKey: string): RegExp {
  const [year, month, day] = dateKey.split('-').map((part) => Number(part));
  const short = MONTHS[month - 1].slice(0, 3);
  return new RegExp(`${short}\\w* ${day}, ${year}|${day} ${short}\\w* ${year}`);
}

export async function expectFocusedDeal(page: Page, dealId: string): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.getAttribute('data-deal-id') ?? null), {
      timeout: 10_000,
    })
    .toBe(dealId);
}
