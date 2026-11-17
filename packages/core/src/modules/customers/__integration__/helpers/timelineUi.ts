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
  await trigger.click();
  const dayButton = page.locator(`[data-day="${dateKey}"]:not([data-outside]) button`).first();
  for (let attempt = 0; attempt < 48; attempt += 1) {
    if (await dayButton.isVisible().catch(() => false)) break;
    const shownDays = await page.locator('[data-day]:not([data-outside])').evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute('data-day') ?? '').filter(Boolean).sort(),
    );
    const firstShown = shownDays[0] ?? '';
    const direction = firstShown && dateKey < firstShown ? /previous month/i : /next month/i;
    await page.getByRole('button', { name: direction }).first().click();
  }
  await dayButton.click();
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
