import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { login } from '@open-mercato/core/helpers/integration/auth'

type Scenario = {
  id: string
  title: string
  steps: Array<{ screen: string; task: string }>
}
type Screen = { id: string; title: string }
const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../data',
)
const scenarios = JSON.parse(
  readFileSync(path.join(fixtureDir, 'scenarios.json'), 'utf8'),
) as Scenario[]
const screens = [
  'screens.json',
  'ledger-spec-screens.json',
  'operations-spec-screens.json',
  'tax-spec-screens.json',
].flatMap(
  (file) =>
    JSON.parse(readFileSync(path.join(fixtureDir, file), 'utf8')) as Screen[],
)

async function startScenario(page: Page, id: string) {
  const scenario = scenarios.find((item) => item.id === id)
  if (!scenario) throw new Error(`Unknown scenario ${id}`)
  await page.getByRole('button', { name: /^(Scenariusze|Scenarios)$/ }).click()
  const guide = page.getByTestId('scenario-guide')
  await guide.getByRole('combobox').click()
  await page.getByRole('option', { name: scenario.title, exact: true }).click()
  await expect(guide.getByRole('listitem')).toHaveCount(scenario.steps.length)
  await guide
    .getByRole('button', {
      name: /Rozpocznij scenariusz|Start scenario|Rozpocznij od nowa|Start again/,
    })
    .click()
  await expect(guide).not.toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#${scenario.steps[0].screen}$`))
}

async function importAndReconcile(page: Page) {
  await page
    .getByRole('button', { name: 'Wybierz przykładowy wyciąg', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Zaimportuj wyciąg', exact: true })
    .click()
  await expect(
    page.getByText(/126 pozycji dopasowano automatycznie/).first(),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Przejdź do uzgodnienia', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Zatwierdź uzgodnienie', exact: true })
    .click()
  await expect(
    page.getByText(/Przed zatwierdzeniem zaksięguj korektę/),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Wyjaśnij', exact: true }).click()
  await page
    .getByRole('button', { name: 'Utwórz korektę', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Kwota po obu stronach', exact: true })
    .fill('43')
  await page
    .getByRole('button', { name: 'Zaksięguj korektę', exact: true })
    .click()
  await expect(page.getByText(/Korekta wymaga daty/)).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Kwota po obu stronach', exact: true })
    .fill('42,00')
  await page.getByRole('button', { name: 'Zapisz szkic', exact: true }).click()
  await page
    .getByRole('button', { name: 'Wróć do opłaty bankowej', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Utwórz korektę', exact: true })
    .click()
  await expect(
    page.getByRole('textbox', { name: 'Kwota po obu stronach', exact: true }),
  ).toHaveValue('42,00')
  await page
    .getByRole('button', { name: 'Zaksięguj korektę', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Sprawdź uzgodnienie', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Sprawdź ponownie', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Zatwierdź uzgodnienie', exact: true })
    .click()
  await expect(page.getByText(/Uzgodnienie zatwierdzone/).first()).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Zatwierdź uzgodnienie', exact: true }),
  ).toBeDisabled()
}

test.beforeEach(async ({ page }) => {
  await login(page, 'superadmin')
  await page.goto('/backend/finance-preview')
  await expect(page.getByTestId('finance-preview')).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await expect(
    page.getByRole('heading', { name: screens[0].title, level: 1 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Scenariusze', exact: true }).click()
  await expect(page.getByTestId('scenario-guide')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('scenario-guide')).not.toBeVisible()
})

test('screen content leads and the scenario launcher is available on demand', async ({
  page,
}) => {
  await expect(
    page.getByText(
      /This is an interface prototype|To jest prototyp interfejsu/,
    ),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /^(Scenariusze|Scenarios)$/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Wszystkie ekrany', exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: test.info().outputPath('finance-dashboard.png'),
    fullPage: true,
  })
})

test('all 57 prototype screens render without branded or pink status badges', async ({
  page,
}) => {
  expect(screens).toHaveLength(57)
  expect(await page.locator('[data-slot="badge"]').count()).toBeGreaterThan(0)
  for (const screen of screens) {
    await page.evaluate((id) => {
      window.location.hash = id
    }, screen.id)
    await expect(
      page.getByRole('heading', { name: screen.title, level: 1 }).first(),
    ).toBeVisible()
    await expect(
      page.locator(
        '[data-slot="badge"][data-variant="brand"], [data-slot="badge"][data-tone="pink"], [data-slot="badge"][class*="brand-violet"], [data-slot="badge"][class*="bg-status-pink"]',
      ),
    ).toHaveCount(0)
  }
})

test('Polish accountant preview stays Polish after English entry, deep links, and reload', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }])
  await page.goto('/backend/finance-preview?review=locale#s25')
  await expect(page).toHaveURL(/\?review=locale#s25$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl')
  await expect(
    page.getByRole('button', { name: 'Scenariusze', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Przywróć przykład', exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('navigation')
      .getByRole('link', { name: 'Prototyp finansów', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl')
  for (const screen of screens) {
    await page.evaluate((id) => {
      window.location.hash = id
    }, screen.id)
    await expect(
      page.getByRole('heading', { name: screen.title, level: 1 }).first(),
    ).toBeVisible()
    await expect(page.locator('body')).not.toContainText(
      /Demo data|Scenarios|Reset example|Open commitments|Budget limit|Payment amount in invoice currency|Monthly cash flows|Invoices to review|Save budget|Issue invoice|Cash flow/,
    )
    await expect(page.locator('body')).not.toContainText(
      /finance_previews\.[a-z_.]+/,
    )
  }
  await page.getByRole('button', { name: 'Scenariusze', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Wybierz zadanie')
  await page.getByRole('dialog').getByRole('combobox').click()
  await page
    .getByRole('option', { name: scenarios[0].title, exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Rozpocznij scenariusz', exact: true }),
  ).toBeVisible()
})

test('bank scenario completes through transaction actions and validates its correction', async ({
  page,
}) => {
  await startScenario(page, 'bank')
  await importAndReconcile(page)
  await page.reload()
  await expect(page.getByText(/Uzgodnienie zatwierdzone/).first()).toBeVisible()
})

test('month-end close completes from its checklist through reports and period lock', async ({
  page,
}) => {
  await startScenario(page, 'close')
  await expect(
    page.getByRole('button', { name: 'Zamknij okres', exact: true }),
  ).toBeDisabled()
  await page
    .getByRole('button', { name: 'Sprawdź saldo próbne', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Zaksięguj zapisy cykliczne', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Otwórz uzgodnienie banku', exact: true })
    .click()
  await importAndReconcile(page)
  await page
    .getByRole('button', { name: 'Wróć do zamknięcia okresu', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Potwierdź korekty i VAT', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Wygeneruj sprawozdania', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Otwórz podgląd raportu', exact: true })
    .click()
  await expect(
    page.getByText('Przychody ze sprzedaży', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Zatwierdź sprawozdania', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Wróć do zamknięcia okresu', exact: true })
    .click()
  await page.getByRole('button', { name: 'Zamknij okres', exact: true }).click()
  await expect(
    page.getByText(/Wrzesień 2026 jest zamknięty/).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Zamknij okres', exact: true }),
  ).toBeDisabled()
})

test('vendor scenario carries the entered invoice into a sent payment batch', async ({
  page,
}) => {
  await startScenario(page, 'vendor')
  await page
    .getByRole('textbox', { name: 'Numer faktury', exact: true })
    .fill('FZ/TEST/001')
  await page
    .getByRole('button', {
      name: 'Zapisz szkic i przejdź do kontroli',
      exact: true,
    })
    .click()
  await expect(page).toHaveURL(/#s8$/)
  await expect(page.getByText('FZ/TEST/001', { exact: true })).toBeVisible()
  await page
    .getByRole('combobox', { name: 'Odbiór usługi', exact: true })
    .click()
  await page.getByRole('option', { name: /OU-2026-0187/ }).click()
  await page
    .getByRole('button', { name: 'Potwierdź zgodność', exact: true })
    .click()
  await expect(
    page.getByText(/Faktura została oznaczona jako sprawdzona/),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Przejdź do paczki płatności', exact: true })
    .click()
  await expect(
    page.getByRole('checkbox', { name: /FZ\/TEST\/001/ }),
  ).toBeChecked()
  await page
    .getByRole('button', { name: 'Zatwierdź i zaksięguj fakturę', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Sprawdź rachunek', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Przygotuj paczkę', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Zatwierdź paczkę', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Zarejestruj wysłanie', exact: true })
    .click()
  await expect(
    page.getByText('Wysłanie zarejestrowane', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Wróć do edycji', exact: true }),
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByText('Wysłanie zarejestrowane', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Przejdź do importu wyciągu', exact: true })
    .click()
  await expect(page).toHaveURL(/#s16$/)
})

test('customer scenario rejects over-allocation and shows confirmed balances in monitoring', async ({
  page,
}) => {
  await startScenario(page, 'payment')
  await page
    .getByRole('button', { name: 'Rozlicz lub zmień wpłatę', exact: true })
    .click()
  const amounts = page.getByRole('textbox', { name: 'Przypisz (EUR)' })
  await amounts.nth(1).fill('1500')
  await expect(page.getByText(/przekracza jej otwarte saldo/)).toBeVisible()
  await amounts.nth(0).fill('2000')
  await amounts.nth(1).fill('1000')
  await page
    .getByRole('button', { name: 'Potwierdź rozliczenie', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Przejdź do monitoringu', exact: true })
    .click()
  await expect(page).toHaveURL(/#s14$/)
  await expect(page.getByText(/4.?400,00\s*€/).first()).toBeVisible()
  await expect(page.getByText(/250,00\s*€/).first()).toBeVisible()
})

test('currency scenario posts a balanced payment journal and prevents double posting', async ({
  page,
}) => {
  await startScenario(page, 'currency')
  await page
    .getByRole('button', { name: /^(Wystaw fakturę|Issue invoice)$/ })
    .click()
  await page
    .getByRole('button', {
      name: /^(Przejdź do rozliczenia|Go to settlement)$/,
    })
    .click()
  await page
    .getByRole('button', { name: /^(Zaksięguj wpłatę|Post payment)$/ })
    .click()
  await expect(
    page.getByText(/Wpłata zaksięgowana|Payment posted/),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^(Zaksięguj wpłatę|Post payment)$/ }),
  ).toBeDisabled()
  await page
    .getByRole('button', {
      name: /^(Pokaż dekret wpłaty|View payment journal)$/,
    })
    .click()
  await expect(page.getByText(/13.?020[,.]00/).first()).toBeVisible()
  await expect(page.getByText(/12.?840[,.]00/).first()).toBeVisible()
  await expect(page.getByText(/180[,.]00/).first()).toBeVisible()
  await page.screenshot({
    path: test.info().outputPath('finance-currency-complete.png'),
    fullPage: true,
  })
})

test('budget scenario requires director decision and changes the actual commitments', async ({
  page,
}) => {
  await startScenario(page, 'budget')
  await page
    .getByRole('button', { name: /^(Przejdź do wniosku|Go to request)$/ })
    .click()
  await page
    .getByRole('button', {
      name: /^(Wyślij do akceptacji|Submit for approval)$/,
    })
    .click()
  await expect(
    page.getByText(/czeka na decyzję|awaits the finance director/),
  ).toBeVisible()
  await page
    .getByRole('button', {
      name: /^(Przejdź do decyzji dyrektora|Review director decision)$/,
    })
    .click()
  await page
    .getByRole('button', {
      name: /^(Zatwierdź przekroczenie|Approve override)$/,
    })
    .click()
  await expect(
    page.getByText(/Dyrektor zatwierdził|director approved/).first(),
  ).toBeVisible()
  await page
    .getByRole('button', {
      name: /^(Otwórz edytor budżetu|Open budget editor)$/,
    })
    .click()
  await expect(
    page.getByRole('spinbutton', {
      name: /Otwarte zobowiązania|Open commitments/,
    }),
  ).toHaveValue('124600')
  await page.screenshot({
    path: test.info().outputPath('finance-budget-complete.png'),
    fullPage: true,
  })
})

test('restarting a scenario already on its first screen restores clean editable data', async ({
  page,
}) => {
  await startScenario(page, 'vendor')
  const invoiceNumber = page.getByRole('textbox', {
    name: 'Numer faktury',
    exact: true,
  })
  await invoiceNumber.fill('FZ/CHANGED/001')
  await startScenario(page, 'vendor')
  await expect(invoiceNumber).not.toHaveValue('FZ/CHANGED/001')
  await expect(invoiceNumber).toBeEditable()
})

test('JPK requires validation and approval enforces separate decision roles', async ({
  page,
}) => {
  await page.goto('/backend/finance-preview#s37')
  await expect(
    page.getByRole('button', { name: 'Wygeneruj podgląd JPK' }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Waliduj dane' }).click()
  await expect(
    page.getByText(/Dane przeszły walidację demonstracyjną/),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Wygeneruj podgląd JPK' }).click()
  await expect(
    page.getByText(/Wygenerowano demonstracyjny podgląd JPK/),
  ).toBeVisible()
  await page.goto('/backend/finance-preview#s40')
  await page.getByRole('button', { name: 'Uruchom symulację' }).click()
  await page.getByRole('button', { name: 'Zatwierdź krok' }).click()
  await expect(
    page.getByText(/Oczekuje na drugą decyzję/).first(),
  ).toBeVisible()
  await page.getByRole('combobox', { name: 'Decyzję podejmuje' }).click()
  await page.getByRole('option', { name: 'Kierownik działu' }).click()
  await page.getByRole('button', { name: 'Zatwierdź krok' }).click()
  await expect(page.getByText(/wyłącznie wskazana rola/)).toBeVisible()
  await page.getByRole('combobox', { name: 'Decyzję podejmuje' }).click()
  await page.getByRole('option', { name: 'Kontroler finansowy' }).click()
  await page.getByRole('button', { name: 'Zatwierdź krok' }).click()
  await expect(
    page.getByText(/Faktura zatwierdzona po dwóch/).first(),
  ).toBeVisible()
})

async function openExistingInvoiceVariance(page: Page) {
  await page.goto('/backend/finance-preview#s8')
  await page.getByRole('combobox', { name: 'Zamówienie', exact: true }).click()
  await page.getByRole('option', { name: /PO-2026-1081/ }).click()
  await page
    .getByRole('combobox', { name: 'Odbiór usługi', exact: true })
    .click()
  await page.getByRole('option', { name: /OU-2026-0187/ }).click()
  await expect(
    page.getByRole('button', { name: 'Potwierdź zgodność', exact: true }),
  ).toBeDisabled()
  await page
    .getByRole('button', { name: 'Przejdź do różnicy', exact: true })
    .click()
  await expect(page).toHaveURL(/#s9$/)
  await page
    .getByRole('button', { name: 'Przekaż kierownikowi', exact: true })
    .click()
  await expect(
    page.getByText('Dodaj uzasadnienie, zanim przekażesz fakturę do decyzji.', {
      exact: true,
    }),
  ).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Uzasadnienie różnicy', exact: true })
    .fill('Dodatkowe prace potwierdzone przez kierownika.')
  await page
    .getByRole('button', { name: 'Przekaż kierownikowi', exact: true })
    .click()
  await expect(
    page.getByText('Oczekuje na decyzję kierownika', { exact: true }),
  ).toBeVisible()
}

test('existing supplier invoice keeps its identity through variance approval and batch selection', async ({
  page,
}) => {
  await openExistingInvoiceVariance(page)
  await page
    .getByRole('button', { name: 'Zatwierdź różnicę', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Przejdź do paczki płatności', exact: true })
    .click()
  await expect(page).toHaveURL(/#s10$/)
  await expect(
    page.getByRole('checkbox', { name: /FZ\/09\/2026\/088/ }),
  ).toBeChecked()
  await expect(
    page.getByRole('checkbox', { name: /FZ\/09\/2026\/076/ }),
  ).not.toBeChecked()
})

test('rejected supplier variance returns to an editable correction and can be checked again', async ({
  page,
}) => {
  await openExistingInvoiceVariance(page)
  await page
    .getByRole('button', { name: 'Odrzuć i poproś o korektę', exact: true })
    .click()
  await expect(
    page.getByRole('button', {
      name: 'Przejdź do paczki płatności',
      exact: true,
    }),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Popraw fakturę dostawcy', exact: true })
    .click()
  await expect(page).toHaveURL(/#s43$/)
  const invoiceNumber = page.getByRole('textbox', {
    name: 'Numer faktury',
    exact: true,
  })
  await expect(invoiceNumber).toHaveValue('FZ/09/2026/088')
  await expect(invoiceNumber).toBeEditable()
  await page
    .getByRole('button', {
      name: 'Zapisz szkic i przejdź do kontroli',
      exact: true,
    })
    .click()
  await page
    .getByRole('combobox', { name: 'Odbiór usługi', exact: true })
    .click()
  await page.getByRole('option', { name: /OU-2026-0187/ }).click()
  await page
    .getByRole('button', { name: 'Potwierdź zgodność', exact: true })
    .click()
  await expect(
    page.getByText(/Faktura została oznaczona jako sprawdzona/),
  ).toBeVisible()
})

test('director rejection requires a comment and leaves budget commitments unchanged', async ({
  page,
}) => {
  await startScenario(page, 'budget')
  await page
    .getByRole('button', { name: /^(Przejdź do wniosku|Go to request)$/ })
    .click()
  await page
    .getByRole('button', {
      name: /^(Wyślij do akceptacji|Submit for approval)$/,
    })
    .click()
  await page
    .getByRole('button', {
      name: /^(Przejdź do decyzji dyrektora|Review director decision)$/,
    })
    .click()
  await page
    .getByRole('button', { name: /^(Odrzuć wniosek|Reject request)$/ })
    .click()
  await expect(
    page.getByText(
      /Podaj powód odrzucenia wniosku|Enter a reason for rejecting the request/,
    ),
  ).toBeVisible()
  await page
    .getByRole('textbox', { name: /Komentarz do decyzji|Decision comment/ })
    .fill('Zakup odłożony do następnego okresu.')
  await page
    .getByRole('button', { name: /^(Odrzuć wniosek|Reject request)$/ })
    .click()
  await expect(
    page.getByText(/Wniosek odrzucono|Request rejected/).first(),
  ).toBeVisible()
  await page
    .getByRole('button', {
      name: /^(Otwórz edytor budżetu|Open budget editor)$/,
    })
    .click()
  await expect(
    page.getByRole('spinbutton', {
      name: /Otwarte zobowiązania|Open commitments/,
    }),
  ).toHaveValue('100000')
})

test('journal statuses match Figma stroke status badges', async ({ page }) => {
  await page.evaluate(() => {
    window.location.hash = 's2'
  })
  await expect(
    page.getByRole('heading', { name: 'Zapisy księgowe', level: 1 }),
  ).toBeVisible()
  const statuses = page.locator('td [data-slot="badge"]')
  await expect(statuses).toHaveCount(4)
  for (const status of await statuses.all()) {
    await expect(status.locator('svg')).toHaveCount(1)
    const geometry = await status.evaluate((element) => {
      const style = getComputedStyle(element)
      const icon = element.querySelector('svg')!
      return {
        height: element.getBoundingClientRect().height,
        radius: style.borderRadius,
        fontSize: style.fontSize,
        iconWidth: icon.getBoundingClientRect().width,
        background: style.backgroundColor,
        border: style.borderColor,
        text: style.color,
      }
    })
    expect(geometry.height).toBe(24)
    expect(geometry.radius).toBe('6px')
    expect(geometry.fontSize).toBe('12px')
    expect(geometry.iconWidth).toBe(16)
    expect(geometry.border).not.toBe(geometry.text)
  }
  await page.screenshot({
    path: test.info().outputPath('finance-journal-figma-matched.png'),
    fullPage: true,
  })
})
