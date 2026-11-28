import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

async function start(page: Page, screen: string) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page, 'superadmin')
  await page.goto('/backend/finance-preview')
  await expect(page.getByTestId('finance-preview')).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await page.evaluate((next) => {
    sessionStorage.removeItem('finance-preview-ledger-spec-v1')
    location.hash = next
  }, screen)
  await expect(page.getByTestId(`ledger-workflow-${screen}`)).toBeVisible()
}
const input = (page: Page, id: string) =>
  page.getByRole('dialog').locator(`[data-crud-field-id="${id}"] input`).first()

async function selectField(
  page: Page,
  formId: string,
  fieldId: string,
  label: string,
) {
  const field = page.locator(`#${formId} [data-crud-field-id="${fieldId}"]`)
  await field.getByRole('combobox').click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

test('starter chart, period conflicts, reconciliation and trial balance preserve a complete accountant path', async ({
  page,
}) => {
  await start(page, 's44')
  await page
    .getByRole('button', { name: 'Zaimportuj domyślny plan kont', exact: true })
    .click()
  await expect(
    page.getByText(
      'Zaimportowano 40 typów i 44 konta. Możesz je teraz dostosować.',
    ),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Zaimportuj domyślny plan kont', exact: true })
    .click()
  await expect(
    page.getByText(
      'Import wymaga pustego planu kont. Istniejące konta pozostają bez zmian.',
    ),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Wygeneruj 12 miesięcy', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Wygeneruj 12 miesięcy', exact: true })
    .click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page
    .getByRole('button', { name: 'Wygeneruj 12 miesięcy', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Wygeneruj 12 miesięcy', exact: true })
    .click()
  await expect(
    page
      .getByText(
        'Podany zakres nakłada się na istniejące okresy. Nie dodano żadnego okresu.',
      )
      .first(),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  const september = page.getByRole('row').filter({ hasText: '2026-09-01' })
  await september.getByRole('button', { name: 'Zablokuj', exact: true }).click()
  await expect(
    page.getByText(/Nie można zablokować okresu: pozostały koszty/),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Uzgodnij koszty', exact: true })
    .click()
  await selectField(
    page,
    'ledger-settings',
    'clearing',
    '490-1 — Rozliczenie kosztów międzyzespołowe (4 -> 5)',
  )
  await selectField(
    page,
    'ledger-settings',
    'unallocatedAccount',
    '552-1 — Koszty sprzedaży',
  )
  await page
    .locator('#ledger-settings')
    .getByRole('button', { name: 'Zapisz', exact: true })
    .click()
  await page
    .locator('#ledger-rule')
    .getByRole('button', { name: 'Zapisz', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Uzgodnij przeksięgowania', exact: true })
    .click()
  await expect(
    page.getByText(
      'Uzgodniono koszt. Ponowne uruchomienie nie utworzy drugiego zapisu.',
    ),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Uzgodnij przeksięgowania', exact: true })
    .click()
  const state = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem('finance-preview-ledger-spec-v1') ?? '{}',
    ),
  )
  expect(state.accounts).toHaveLength(44)
  expect(state.periods).toHaveLength(12)
  expect(state.reclassification).toEqual({
    target: '550-1',
    clearing: '490-1',
    center: 'IT',
  })
  await page.getByRole('button', { name: 'Sprawdź ZSiO', exact: true }).click()
  await expect(
    page.getByText('Księga zbilansowana', { exact: true }),
  ).toBeVisible()
  await page.getByPlaceholder('Szukaj po numerze lub nazwie').fill('550-1')
  await page.getByRole('button', { name: 'Otwórz 550-1', exact: true }).click()
  await expect(
    page.getByRole('row').filter({ hasText: 'PK/2026/4-5' }),
  ).toContainText(/1\s?230,00/)
  await page
    .getByRole('button', { name: 'Okresy obrachunkowe', exact: true })
    .click()
  await september.getByRole('button', { name: 'Zablokuj', exact: true }).click()
  await expect(september).toContainText('Zablokowany')
  await page.reload()
  await expect(september).toContainText('Zablokowany')
  await september.getByRole('button', { name: 'Odblokuj', exact: true }).click()
  await expect(september).toContainText('Otwarty')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: test.info().outputPath('ledger-periods.png'),
    fullPage: true,
  })
})

test('contractor approval and live-check variants block unsafe payment readiness and preserve snapshot', async ({
  page,
}) => {
  await start(page, 's46')
  await page
    .getByRole('button', { name: 'Dodaj kontrahenta', exact: true })
    .click()
  await input(page, 'nip').fill('8876543215')
  await input(page, 'name').fill('Przykładowe Usługi IT')
  await input(page, 'address').fill('Warszawa, Testowa 10')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Zapisz', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Zatwierdź kontrahenta', exact: true })
    .click()
  await expect(
    page.getByText(/Autor nie może zatwierdzić własnej kartoteki/),
  ).toBeVisible()
  await page
    .getByRole('radio', { name: 'Osoba akceptująca', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Zatwierdź kontrahenta', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Dodaj rachunek', exact: true })
    .click()
  await input(page, 'number').fill('PL61109010140000071219812874')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Zapisz', exact: true })
    .click()
  await page
    .getByRole('radio', { name: 'Poza Białą Listą', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Sprawdź warunki płatności', exact: true })
    .click()
  await expect(
    page.getByText(
      'Rachunku nie ma na Białej Liście. Płatność pozostaje zablokowana.',
    ),
  ).toBeVisible()
  await page
    .getByRole('radio', { name: 'Na Białej Liście', exact: true })
    .click()
  await page.getByRole('radio', { name: 'Niedostępny', exact: true }).click()
  await page
    .getByRole('button', { name: 'Sprawdź warunki płatności', exact: true })
    .click()
  await expect(page.getByText(/Usługa jest niedostępna/)).toBeVisible()
  await page.getByRole('radio', { name: 'Dostępny', exact: true }).click()
  await page
    .getByRole('button', { name: 'Sprawdź warunki płatności', exact: true })
    .click()
  await expect(page.getByText(/Warunki sprawdzone na nowo/)).toBeVisible()
  await page.getByRole('button', { name: 'Edytuj', exact: true }).click()
  await input(page, 'name').fill('Nowa nazwa kartoteki')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Zapisz', exact: true })
    .click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Nowa nazwa kartoteki', exact: true }),
  ).toBeVisible()
  const state = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem('finance-preview-ledger-spec-v1') ?? '{}',
    ),
  )
  expect(state.contractors[0].name).toBe('Nowa nazwa kartoteki')
  expect(state.contractors[0].snapshot.name).toBe('Przykładowe Usługi IT')
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Nowa nazwa kartoteki', exact: true }),
  ).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: test.info().outputPath('contractor-detail.png'),
    fullPage: true,
  })
})
