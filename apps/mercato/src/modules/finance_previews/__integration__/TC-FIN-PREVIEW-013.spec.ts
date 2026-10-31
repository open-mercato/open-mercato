import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test('payment batch blocks mixed suppliers and unavailable verification, posts once and reloads read-only', async ({
  page,
}) => {
  await login(page, 'superadmin')
  await page.goto('/backend/finance-preview#s10')
  await expect(page.getByTestId('finance-preview')).toHaveAttribute(
    'aria-busy',
    'false',
  )
  const workflow = page.getByTestId('payment-batch-workflow')
  await workflow
    .getByRole('checkbox', {
      name: 'Wybierz fakturę: FZ/09/2026/076',
      exact: true,
    })
    .check()
  await workflow
    .getByRole('checkbox', {
      name: 'Wybierz fakturę: FZ/09/2026/071',
      exact: true,
    })
    .check()
  await workflow
    .getByRole('button', { name: 'Przygotuj paczkę', exact: true })
    .click()
  await expect(
    workflow
      .getByText(/Paczka może zawierać faktury tylko jednego dostawcy/)
      .first(),
  ).toBeVisible()
  await workflow
    .getByRole('checkbox', {
      name: 'Wybierz fakturę: FZ/09/2026/071',
      exact: true,
    })
    .uncheck()
  const verification = workflow.locator('[data-crud-field-id="verification"]')
  await verification.getByRole('combobox').click()
  await page
    .getByRole('option', {
      name: 'Usługa weryfikacji niedostępna',
      exact: true,
    })
    .click()
  await workflow
    .getByRole('button', { name: 'Zapisz dane płatności', exact: true })
    .click()
  await workflow
    .getByRole('button', { name: 'Sprawdź rachunek', exact: true })
    .click()
  await expect(workflow.getByText(/Płatność zablokowana/)).toBeVisible()
  await workflow
    .getByRole('button', { name: 'Przygotuj paczkę', exact: true })
    .click()
  await expect(
    workflow.getByRole('button', { name: 'Zatwierdź paczkę', exact: true }),
  ).toHaveCount(0)
  await verification.getByRole('combobox').click()
  await page
    .getByRole('option', { name: 'Rachunek na białej liście', exact: true })
    .click()
  await workflow
    .getByRole('button', { name: 'Zapisz dane płatności', exact: true })
    .click()
  await workflow
    .getByRole('button', { name: 'Sprawdź rachunek', exact: true })
    .click()
  await workflow
    .getByRole('button', { name: 'Przygotuj paczkę', exact: true })
    .click()
  await workflow
    .getByRole('button', { name: 'Zatwierdź paczkę', exact: true })
    .click()
  await workflow
    .getByRole('button', { name: 'Zarejestruj wysłanie', exact: true })
    .click()
  await expect(
    workflow.getByText('Wysłanie zarejestrowane', { exact: true }),
  ).toBeVisible()
  await expect(workflow.getByRole('cell', { name: /18\s?900,00/ })).toHaveCount(
    3,
  )
  await page.reload()
  await expect(
    workflow.getByText('Wysłanie zarejestrowane', { exact: true }),
  ).toBeVisible()
  await expect(
    workflow.getByRole('button', { name: 'Zarejestruj wysłanie', exact: true }),
  ).toHaveCount(0)
  await expect(workflow.getByRole('checkbox').first()).toBeDisabled()
  await workflow
    .getByRole('button', { name: 'Dopasuj płatność na wyciągu', exact: true })
    .click()
  await expect(page).toHaveURL(/#s52$/)
  const bank = page.getByTestId('operations-bank')
  await bank
    .getByRole('button', { name: 'Sprawdź i zatwierdź wyciąg', exact: true })
    .click()
  await bank
    .getByRole('row', { name: /PP\/2026\/009/ })
    .getByRole('button', { name: 'Dopasuj', exact: true })
    .click()
  await bank
    .getByRole('button', { name: 'Pokaż dekret rozliczenia', exact: true })
    .click()
  await bank
    .getByRole('button', { name: 'Potwierdź dopasowanie', exact: true })
    .click()
  const matched = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem('finance-preview-operations-bank-v1') ?? '{}',
    ),
  )
  expect(matched.batch.invoices).toEqual(['FZ/09/2026/076'])
  expect(matched.batch.amount).toBe(18900)
  expect(
    matched.matches.find((match: { id: string }) => match.id === 'batch')
      .journal,
  ).toEqual([])
  await page.reload()
  await expect(
    bank.getByRole('row', { name: /PP\/2026\/009.*Dopasowano/ }),
  ).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = 's43'
  })
  await expect(
    page.getByText('Dokument jest już zaksięgowany', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Numer faktury', exact: true }),
  ).toHaveCount(0)
})

test('a batch created after statement confirmation can be attached without losing prior matches', async ({
  page,
}) => {
  await login(page, 'superadmin')
  await page.goto('/backend/finance-preview#s52')
  const bank = page.getByTestId('operations-bank')
  await expect(bank).toBeVisible()
  await bank
    .getByRole('button', { name: 'Sprawdź i zatwierdź wyciąg', exact: true })
    .click()
  await bank
    .getByRole('row', { name: /292630102.*Opłata/ })
    .getByRole('button', { name: 'Dopasuj', exact: true })
    .click()
  await bank
    .getByRole('button', { name: 'Pokaż dekret rozliczenia', exact: true })
    .click()
  await bank
    .getByRole('button', { name: 'Potwierdź dopasowanie', exact: true })
    .click()
  await bank
    .getByRole('button', { name: 'Wysłana paczka płatności', exact: true })
    .click()
  const batch = page.getByTestId('payment-batch-workflow')
  await batch
    .getByRole('checkbox', {
      name: 'Wybierz fakturę: FZ/09/2026/076',
      exact: true,
    })
    .check()
  await batch
    .getByRole('button', { name: 'Sprawdź rachunek', exact: true })
    .click()
  await batch
    .getByRole('button', { name: 'Przygotuj paczkę', exact: true })
    .click()
  await batch
    .getByRole('button', { name: 'Zatwierdź paczkę', exact: true })
    .click()
  await batch
    .getByRole('button', { name: 'Zarejestruj wysłanie', exact: true })
    .click()
  await batch
    .getByRole('button', { name: 'Dopasuj płatność na wyciągu', exact: true })
    .click()
  await bank
    .getByRole('button', {
      name: 'Dołącz wysłaną paczkę i sprawdź salda ponownie',
      exact: true,
    })
    .click()
  await bank
    .getByRole('button', { name: 'Sprawdź i zatwierdź wyciąg', exact: true })
    .click()
  await expect(
    bank.getByRole('row', { name: /292630102.*Dopasowano/ }),
  ).toBeVisible()
  await bank
    .getByRole('row', { name: /PP\/2026\/009/ })
    .getByRole('button', { name: 'Dopasuj', exact: true })
    .click()
  await bank
    .getByRole('button', { name: 'Pokaż dekret rozliczenia', exact: true })
    .click()
  await bank
    .getByRole('button', { name: 'Potwierdź dopasowanie', exact: true })
    .click()
  const state = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem('finance-preview-operations-bank-v1') ?? '{}',
    ),
  )
  expect(state.matches).toHaveLength(2)
  expect(
    state.matches.find((match: { id: string }) => match.id === 'batch').journal,
  ).toEqual([])
  expect(
    state.matches.find((match: { id: string }) => match.id === 'fee').journal,
  ).toHaveLength(2)
})
