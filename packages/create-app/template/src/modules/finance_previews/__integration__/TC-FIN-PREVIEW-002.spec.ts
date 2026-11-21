import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test('allocation validates shares and persists its calculated result after reload', async ({
  page,
}) => {
  await login(page, 'superadmin')
  await page.goto('/backend/finance-preview')
  await expect(page.getByTestId('finance-preview')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: 'Scenariusze', exact: true }).click()
  await expect(page.getByTestId('scenario-guide')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.sessionStorage.removeItem('finance-preview-form-s31')
    window.location.hash = 's32'
  })
  await page.getByRole('button', { name: 'Edytuj regułę', exact: true }).click()
  const form = page.locator('#finance-preview-form-s31')
  const itShare = form.locator('[data-crud-field-id="field_3"] input')
  const salesShare = form.locator('[data-crud-field-id="field_4"] input')
  await itShare.fill('70')
  await salesShare.fill('50')
  await page.getByRole('button', { name: 'Pokaż podgląd', exact: true }).click()
  await expect(page).toHaveURL(/#s31$/)
  await expect(
    page
      .getByText('Udziały muszą wynosić od 0 do 100% i sumować się do 100%.')
      .first(),
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('finance-preview-form-s31'),
    ),
  ).toBeNull()
  await itShare.fill('60')
  await salesShare.fill('40')
  await form
    .getByRole('button', { name: 'Zapisz i przelicz podgląd', exact: true })
    .click()
  await expect(page).toHaveURL(/#s32$/)
  const result = page.getByTestId('allocation-result')
  await expect(
    result.getByRole('row', { name: /IT.*60%.*50\s400,00/ }),
  ).toBeVisible()
  await expect(
    result.getByRole('row', { name: /Sprzedaż.*40%.*33\s600,00/ }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page
      .getByTestId('allocation-result')
      .getByRole('row', { name: /IT.*60%.*50\s400,00/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Edytuj regułę', exact: true }).click()
  await expect(
    page
      .locator('#finance-preview-form-s31')
      .locator('[data-crud-field-id="field_3"] input'),
  ).toHaveValue('60')
  await expect(
    page
      .locator('#finance-preview-form-s31')
      .locator('[data-crud-field-id="field_4"] input'),
  ).toHaveValue('40')
  await page.evaluate(() =>
    sessionStorage.removeItem('finance-preview-form-s31'),
  )
})
