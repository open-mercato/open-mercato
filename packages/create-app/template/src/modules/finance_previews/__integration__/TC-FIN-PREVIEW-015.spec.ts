import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

const corrupted = {
  'finance-preview-created-rows': 'null',
  'finance-preview-bank-close-v1': JSON.stringify({
    version: 1,
    journal: { amount: 42 },
  }),
  'finance-preview-tax-approval-v1': JSON.stringify({
    version: 1,
    codes: [null],
  }),
  'finance-preview-currency-v1': JSON.stringify({
    currency: 'invalid',
    quantity: 'wrong',
  }),
  'finance-preview-budget-v1': JSON.stringify({
    requestAmount: null,
    subject: {},
  }),
}

test('malformed saved drafts recover to usable accountant screens', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await login(page, 'superadmin')
  await page.goto('/backend/finance-preview#s7')
  await expect(page.getByTestId('finance-preview')).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await page.evaluate((values) => {
    Object.entries(values).forEach(([key, value]) =>
      sessionStorage.setItem(key, value),
    )
  }, corrupted)
  await page.reload()
  const root = page.getByTestId('finance-preview')
  await expect(root).toHaveAttribute('aria-busy', 'false')
  await expect(
    root.getByRole('heading', {
      name: 'Faktury dostawców',
      exact: true,
      level: 1,
    }),
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem('finance-preview-created-rows'),
      ),
    )
    .toBe('{}')
  for (const [screen, title, key] of [
    ['s18', 'Brak dopasowania', 'finance-preview-bank-close-v1'],
    ['s36', 'VAT i JPK', 'finance-preview-tax-approval-v1'],
    ['s42', 'Nowa faktura sprzedaży', 'finance-preview-currency-v1'],
    ['s27', 'Edytor budżetu', 'finance-preview-budget-v1'],
  ]) {
    await page.evaluate((id) => {
      window.location.hash = id
    }, screen)
    await expect(
      root.getByRole('heading', { name: title, exact: true, level: 1 }),
    ).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate((storageKey) => sessionStorage.getItem(storageKey), key),
      )
      .not.toBe(corrupted[key as keyof typeof corrupted])
    await root.getByRole('button', { name: 'Scenariusze', exact: true }).click()
    await expect(page.getByTestId('scenario-guide')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await page.evaluate(() => {
    sessionStorage.setItem(
      'finance-preview-created-rows',
      JSON.stringify({ s7: [null] }),
    )
    window.location.hash = 's7'
  })
  await page.reload()
  await expect(root).toHaveAttribute('aria-busy', 'false')
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem('finance-preview-created-rows'),
      ),
    )
    .toBe('{}')
  await page.evaluate(() =>
    sessionStorage.setItem('finance-preview-created-rows', '{'),
  )
  await page.reload()
  await expect(root).toHaveAttribute('aria-busy', 'false')
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem('finance-preview-created-rows'),
      ),
    )
    .toBe('{}')
  expect(errors).toEqual([])
})
