import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

const keys = ['asset', 'cost', 'revenue', 'fx', 'bank'].map(
  (name) => `finance-preview-operations-${name}-v1`,
)
async function openWorkflow(page: Page, screenId: string) {
  await login(page, 'superadmin')
  await page.goto('/backend/finance-preview')
  await expect(page.getByTestId('finance-preview')).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await page.evaluate(
    ({ storageKeys, screen }) => {
      storageKeys.forEach((key) => sessionStorage.removeItem(key))
      window.location.hash = screen
    },
    { storageKeys: keys, screen: screenId },
  )
}
const input = (page: Page, form: string, field: string) =>
  page.locator(`#${form} [data-crud-field-id="${field}"] input`)
const checkbox = (page: Page, form: string, field: string) =>
  page.locator(`#${form} [data-crud-field-id="${field}"]`).getByRole('checkbox')
async function submit(page: Page, form: string, name: string) {
  await page
    .locator(`#${form}`)
    .getByRole('button', { name, exact: true })
    .click()
}

test.afterEach(async ({ page }) => {
  await page.evaluate(
    (storageKeys) =>
      storageKeys.forEach((key) => sessionStorage.removeItem(key)),
    keys,
  )
})

test('OT generates a schedule, accrual keeps the book value and cannot post the same month twice', async ({
  page,
}) => {
  await openWorkflow(page, 's48')
  const root = page.getByTestId('operations-asset')
  await expect(root).toBeVisible()
  await input(page, 'operations-asset-form', 'salvage').fill('60000')
  await submit(page, 'operations-asset-form', 'Przelicz podgląd')
  await expect(
    root
      .getByText('Wartość końcowa musi być mniejsza od wartości początkowej.')
      .first(),
  ).toBeVisible()
  await input(page, 'operations-asset-form', 'salvage').fill('0')
  await submit(page, 'operations-asset-form', 'Przelicz podgląd')
  await root
    .getByRole('button', { name: 'Przyjmij do używania (OT)', exact: true })
    .click()
  await submit(page, 'operations-accrual-form', 'Nalicz należne raty')
  await expect(root.getByText(/59\s000,00/).first()).toBeVisible()
  await page.reload()
  await expect(root).toBeVisible()
  await submit(page, 'operations-accrual-form', 'Nalicz należne raty')
  await expect(
    root.getByText('Brak nowych rat do naliczenia na wybrany dzień.'),
  ).toBeVisible()
  const state = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem('finance-preview-operations-asset-v1') ?? '{}',
    ),
  )
  expect(
    state.schedule.filter((row: { accrued: boolean }) => row.accrued),
  ).toHaveLength(1)
  expect(state.journal).toHaveLength(4)
})

test('RMP requires policy confirmation before stopping and recognizes only the remainder', async ({
  page,
}) => {
  await openWorkflow(page, 's50')
  const root = page.getByTestId('operations-revenue')
  await expect(root).toBeVisible()
  await submit(page, 'operations-revenue-form', 'Przelicz podgląd')
  await root
    .getByRole('button', { name: 'Zatwierdź harmonogram', exact: true })
    .click()
  await submit(page, 'operations-accrual-form', 'Nalicz należne raty')
  await expect(root.getByText(/11\s000,00/).first()).toBeVisible()
  await submit(
    page,
    'operations-revenue-stop',
    'Przerwij i rozlicz pozostałą kwotę',
  )
  await expect(
    root.getByText('Potwierdź sposób rozliczenia pozostałej kwoty.').first(),
  ).toBeVisible()
  await checkbox(page, 'operations-revenue-stop', 'policy').check()
  await submit(
    page,
    'operations-revenue-stop',
    'Przerwij i rozlicz pozostałą kwotę',
  )
  await expect(root.getByText('Przerwano', { exact: true })).toBeVisible()
  const state = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem('finance-preview-operations-revenue-v1') ?? '{}',
    ),
  )
  expect(state.stage).toBe('stopped')
  expect(
    state.journal.filter((row: { id: string }) =>
      row.id.startsWith('RMP-STOP'),
    ),
  ).toHaveLength(2)
  expect(
    state.journal.find((row: { id: string }) => row.id === 'RMP-STOP-d').debit,
  ).toBe(11000)
  await page.reload()
  await expect(root.getByText('Przerwano', { exact: true })).toBeVisible()
})

test('FX preview rejects a closed next period and posts replacement plus reversing entries', async ({
  page,
}) => {
  await openWorkflow(page, 's51')
  const root = page.getByTestId('operations-fx')
  await expect(root).toBeVisible()
  await checkbox(page, 'operations-fx-form', 'nextOpen').uncheck()
  await submit(page, 'operations-fx-form', 'Przelicz podgląd')
  await expect(
    root
      .getByText(
        'Otwórz następny okres. Wycena musi powstać razem z odwróceniem.',
      )
      .first(),
  ).toBeVisible()
  await checkbox(page, 'operations-fx-form', 'nextOpen').check()
  await submit(page, 'operations-fx-form', 'Przelicz podgląd')
  await expect(root.getByText(/180,00/).first()).toBeVisible()
  await root
    .getByRole('button', { name: 'Zaksięguj wycenę i odwrócenie', exact: true })
    .click()
  await submit(page, 'operations-fx-form', 'Przelicz podgląd')
  await root
    .getByRole('button', { name: 'Zaksięguj wycenę i odwrócenie', exact: true })
    .click()
  const state = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem('finance-preview-operations-fx-v1') ?? '{}',
    ),
  )
  expect(state.runs).toHaveLength(2)
  expect(state.runs[0].superseded).toBe(true)
  expect(state.runs[1].superseded).toBe(false)
  expect(state.runs[1].journal).toHaveLength(16)
  expect(
    state.runs[1].journal.some(
      (row: { date: string }) => row.date === '2026-10-01',
    ),
  ).toBe(true)
  const journal = state.runs.flatMap(
    (run: { journal: { debit: number; credit: number }[] }) => run.journal,
  )
  expect(
    journal.reduce(
      (sum: number, row: { debit: number; credit: number }) =>
        sum + row.debit - row.credit,
      0,
    ),
  ).toBe(0)
})

test('bank matching books a partial EUR payment and separates PLN overpayment from receivables', async ({
  page,
}) => {
  await openWorkflow(page, 's52')
  const root = page.getByTestId('operations-bank')
  await expect(root).toBeVisible()
  await input(page, 'operations-bank-statement', 'closing').fill('1')
  await submit(page, 'operations-bank-statement', 'Sprawdź i zatwierdź wyciąg')
  await expect(
    root
      .getByText(
        'Saldo końcowe musi odpowiadać saldu początkowemu powiększonemu o sumę pozycji.',
      )
      .first(),
  ).toBeVisible()
  const opening = Number(
    await input(page, 'operations-bank-statement', 'opening').inputValue(),
  )
  const batchInput = input(page, 'operations-bank-statement', 'batchAmount')
  const batch = (await batchInput.count())
    ? Number(await batchInput.inputValue())
    : 0
  await input(page, 'operations-bank-statement', 'closing').fill(
    String(opening + 20478 - batch),
  )
  await submit(page, 'operations-bank-statement', 'Sprawdź i zatwierdź wyciąg')
  await root
    .getByRole('row', { name: /FS\/2026\/091.*Nord GmbH/ })
    .getByRole('button', { name: 'Dopasuj', exact: true })
    .click()
  await input(page, 'operations-bank-match', 'settled').fill('9000')
  await submit(page, 'operations-bank-match', 'Pokaż dekret rozliczenia')
  await expect(
    root
      .getByText(
        'Kwota rozliczenia musi być dodatnia i nie może przekraczać salda faktury.',
      )
      .first(),
  ).toBeVisible()
  await input(page, 'operations-bank-match', 'settled').fill('3000')
  await submit(page, 'operations-bank-match', 'Pokaż dekret rozliczenia')
  await root
    .getByRole('button', { name: 'Potwierdź dopasowanie', exact: true })
    .click()
  await root
    .getByRole('row', { name: /FS\/2026\/101.*Acme Polska/ })
    .getByRole('button', { name: 'Dopasuj', exact: true })
    .click()
  await submit(page, 'operations-bank-match', 'Pokaż dekret rozliczenia')
  await root
    .getByRole('button', { name: 'Potwierdź dopasowanie', exact: true })
    .click()
  const state = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem('finance-preview-operations-bank-v1') ?? '{}',
    ),
  )
  const eur = state.matches.find((match: { id: string }) => match.id === 'eur')
  const pln = state.matches.find((match: { id: string }) => match.id === 'pln')
  expect(eur.remaining).toBe(5000)
  expect(eur.gainLoss).toBe(180)
  expect(pln.overpayment).toBe(200)
  expect(
    pln.journal.find((row: { account: string }) => row.account === '249')
      .credit,
  ).toBe(200)
  await page.reload()
  await expect(
    root.getByRole('row', { name: /FS\/2026\/091.*Dopasowano/ }),
  ).toBeVisible()
})

test('Asset lifecycle preserves accrued depreciation, caps reversals and disposes at the impaired net book value', async ({
  page,
}) => {
  await openWorkflow(page, 's48')
  const root = page.getByTestId('operations-asset')
  await submit(page, 'operations-asset-form', 'Przelicz podgląd')
  await root
    .getByRole('button', { name: 'Przyjmij do używania (OT)', exact: true })
    .click()
  await submit(page, 'operations-accrual-form', 'Nalicz należne raty')
  const readState = () =>
    page.evaluate(() =>
      JSON.parse(
        sessionStorage.getItem('finance-preview-operations-asset-v1') ?? '{}',
      ),
    )
  const before = await readState()
  await root
    .getByRole('button', { name: 'Zmień okres amortyzacji', exact: true })
    .click()
  await input(page, 'operations-asset-lifecycle', 'reason').fill(
    'Aktualizacja planowanego okresu używania serwera',
  )
  await input(page, 'operations-asset-lifecycle', 'months').fill('29')
  await submit(page, 'operations-asset-lifecycle', 'Przelicz podgląd')
  await root
    .getByRole('button', { name: 'Zatwierdź operację', exact: true })
    .click()
  const revised = await readState()
  expect(
    revised.schedule.filter((row: { accrued: boolean }) => row.accrued),
  ).toEqual(before.schedule.filter((row: { accrued: boolean }) => row.accrued))
  expect(revised.schedule).toHaveLength(30)
  expect(revised.journal).toEqual(before.journal)
  await root
    .getByRole('button', { name: 'Utrata wartości', exact: true })
    .click()
  await input(page, 'operations-asset-lifecycle', 'reason').fill(
    'Uszkodzenie serwera potwierdzone oceną techniczną',
  )
  await input(page, 'operations-asset-lifecycle', 'recoverable').fill('50000')
  await submit(page, 'operations-asset-lifecycle', 'Przelicz podgląd')
  await root
    .getByRole('button', { name: 'Zatwierdź operację', exact: true })
    .click()
  await root.getByRole('button', { name: 'Odwróć odpis', exact: true }).click()
  await input(page, 'operations-asset-lifecycle', 'reason').fill(
    'Częściowe przywrócenie wartości po naprawie',
  )
  await input(page, 'operations-asset-lifecycle', 'amount').fill('10000')
  await submit(page, 'operations-asset-lifecycle', 'Przelicz podgląd')
  await expect(
    root
      .getByText(
        'Kwota przekracza pozostałą do odwrócenia część wybranego odpisu.',
      )
      .first(),
  ).toBeVisible()
  await input(page, 'operations-asset-lifecycle', 'amount').fill('1000')
  await submit(page, 'operations-asset-lifecycle', 'Przelicz podgląd')
  await root
    .getByRole('button', { name: 'Zatwierdź operację', exact: true })
    .click()
  await page.reload()
  await root.getByRole('button', { name: 'Odwróć odpis', exact: true }).click()
  await input(page, 'operations-asset-lifecycle', 'reason').fill(
    'Kontrola limitu po poprzednim odwróceniu',
  )
  await input(page, 'operations-asset-lifecycle', 'amount').fill('8500')
  await submit(page, 'operations-asset-lifecycle', 'Przelicz podgląd')
  await expect(
    root
      .getByText(
        'Kwota przekracza pozostałą do odwrócenia część wybranego odpisu.',
      )
      .first(),
  ).toBeVisible()
  await root
    .getByRole('button', { name: 'Anuluj operację', exact: true })
    .click()
  await root
    .getByRole('button', { name: 'Wycofaj z ewidencji', exact: true })
    .click()
  await input(page, 'operations-asset-lifecycle', 'reason').fill(
    'Sprzedaż serwera po wymianie infrastruktury',
  )
  await input(page, 'operations-asset-lifecycle', 'proceeds').fill('45000')
  await checkbox(page, 'operations-asset-lifecycle', 'periodLocked').check()
  await submit(page, 'operations-asset-lifecycle', 'Przelicz podgląd')
  await expect(root.getByTestId('asset-lifecycle-preview')).toHaveCount(0)
  await checkbox(page, 'operations-asset-lifecycle', 'periodLocked').uncheck()
  await submit(page, 'operations-asset-lifecycle', 'Przelicz podgląd')
  await expect(
    root
      .getByTestId('asset-lifecycle-preview')
      .getByText(/51\s000,00/)
      .first(),
  ).toBeVisible()
  await root
    .getByRole('button', { name: 'Zatwierdź operację', exact: true })
    .click()
  const disposed = await readState()
  expect(disposed.stage).toBe('disposed')
  expect(
    disposed.assetEvents.map((event: { kind: string }) => event.kind),
  ).toEqual(['revision', 'impairment', 'reversal', 'disposal'])
  expect(disposed.assetEvents[3].details).toMatchObject({
    nbv: 51000,
    gainLoss: -6000,
    impairment: 8000,
    accumulated: 1000,
  })
  expect(
    disposed.journal.reduce(
      (sum: number, row: { debit: number; credit: number }) =>
        sum + row.debit - row.credit,
      0,
    ),
  ).toBe(0)
  expect(
    disposed.schedule.filter((row: { accrued: boolean }) => row.accrued),
  ).toEqual(before.schedule.filter((row: { accrued: boolean }) => row.accrued))
  await page.reload()
  await expect(
    root.getByText('Wycofano z ewidencji', { exact: true }),
  ).toBeVisible()
  await expect(
    root.getByRole('button', { name: 'Nalicz należne raty', exact: true }),
  ).toHaveCount(0)
})

test('prepaid cost schedule blocks a locked accrual and preserves one monthly release after reload', async ({
  page,
}) => {
  await openWorkflow(page, 's49')
  const root = page.getByTestId('operations-cost')
  await expect(root).toBeVisible()
  await submit(page, 'operations-cost-form', 'Przelicz podgląd')
  await root
    .getByRole('button', { name: 'Zatwierdź harmonogram', exact: true })
    .click()
  await checkbox(page, 'operations-accrual-form', 'periodLocked').check()
  await submit(page, 'operations-accrual-form', 'Nalicz należne raty')
  expect(
    await page.evaluate(
      () =>
        JSON.parse(
          sessionStorage.getItem('finance-preview-operations-cost-v1') ?? '{}',
        ).journal,
    ),
  ).toHaveLength(0)
  await checkbox(page, 'operations-accrual-form', 'periodLocked').uncheck()
  await submit(page, 'operations-accrual-form', 'Nalicz należne raty')
  await expect(root.getByText(/11\s000,00/).first()).toBeVisible()
  await page.reload()
  await submit(page, 'operations-accrual-form', 'Nalicz należne raty')
  const state = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem('finance-preview-operations-cost-v1') ?? '{}',
    ),
  )
  expect(
    state.schedule.filter((row: { accrued: boolean }) => row.accrued),
  ).toHaveLength(1)
  expect(state.journal).toHaveLength(2)
  expect(
    state.journal.find((row: { account: string }) => row.account === '640')
      .credit,
  ).toBe(1000)
})
