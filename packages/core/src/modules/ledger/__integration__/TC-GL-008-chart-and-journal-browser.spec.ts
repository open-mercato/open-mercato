import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createCurrencyFixture, deleteCurrenciesEntityIfExists, generateUniqueCurrencyCode,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'
import { expectId } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createAccountFixture, seedJournalEntryInDb } from '@open-mercato/core/helpers/integration/ledgerFixtures'
import { createLedgerBrowserFixture } from './ledgerBrowserFixture'

test('manages the chart of accounts and reads a posted entry as a viewer', async ({ page, browser, request, baseURL }) => {
  const fixture = await createLedgerBrowserFixture(request, baseURL)
  let baseCurrencyId: string | null = null
  let foreignCurrencyId: string | null = null
  try {
    await fixture.login(page, ['ledger.accounts.view', 'ledger.accounts.manage'])
    const main = page.getByRole('main')
    await page.goto('/backend/ledger/account-types')
    await main.getByRole('link', { name: 'New account type', exact: true }).first().click()
    await main.getByRole('group', { name: 'Number *' }).getByRole('textbox').fill('456')
    await main.getByRole('textbox', { name: 'Name *' }).fill('QA Materials')
    await main.getByRole('combobox', { name: 'Normal balance *' }).click()
    await page.getByRole('option', { name: 'Debit', exact: true }).click()
    const [createdType] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/ledger/account-types') && response.request().method() === 'POST'),
      main.getByRole('button', { name: 'Create', exact: true }).first().click(),
    ])
    expect(createdType.status()).toBe(201)
    const accountTypeId = expectId((await createdType.json() as { id?: string }).id, 'Account type ID')
    const typeRow = main.getByRole('row', { name: /QA Materials/ })
    await typeRow.getByRole('button', { name: 'Open actions' }).click()
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    await expect(main.getByRole('textbox', { name: 'Name *' })).toHaveValue('QA Materials')
    await main.getByRole('textbox', { name: 'Name *' }).fill('QA Renamed Materials')
    await main.getByRole('button', { name: 'Save changes' }).first().click()
    await expect(main.getByRole('row', { name: /QA Renamed Materials/ })).toBeVisible()

    await page.goto('/backend/ledger/accounts')
    await main.getByRole('link', { name: 'New account', exact: true }).first().click()
    const accountTypeOption = 'QA Renamed Materials (456)'
    await expect(main.locator('select option').filter({ hasText: accountTypeOption })).toHaveCount(1)
    await main.getByRole('combobox', { name: /Account type/ }).click()
    await page.getByRole('option', { name: accountTypeOption, exact: true }).click()
    await main.getByRole('group', { name: 'Number *' }).getByRole('textbox').fill('456-01')
    await main.getByRole('textbox', { name: 'Description' }).fill('QA Materials debit')
    const [createdAccount] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/ledger/accounts') && response.request().method() === 'POST'),
      main.getByRole('button', { name: 'Create', exact: true }).first().click(),
    ])
    expect(createdAccount.status()).toBe(201)
    const debitAccountId = expectId((await createdAccount.json() as { id?: string }).id, 'Debit account ID')
    const accountRow = main.getByRole('row', { name: /QA Materials debit/ })
    await accountRow.getByRole('button', { name: 'Open actions' }).click()
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    await expect(main.getByRole('textbox', { name: 'Description' })).toHaveValue('QA Materials debit')
    await main.getByRole('textbox', { name: 'Description' }).fill('QA Stored debit account')
    await main.getByRole('button', { name: 'Save changes' }).first().click()
    await expect(main.getByRole('row', { name: /QA Stored debit account/ })).toBeVisible()

    const { scope, token, headers } = fixture
    const creditAccountId = await createAccountFixture(request, token, {
      ...scope, accountTypeId, number: '456-02', description: 'QA Stored credit account',
    }, { headers })
    const baseCurrencyCode = generateUniqueCurrencyCode()
    const foreignCurrencyCode = generateUniqueCurrencyCode()
    baseCurrencyId = await createCurrencyFixture(request, token, {
      ...scope, headers, code: baseCurrencyCode, name: 'QA Journal base currency',
    })
    foreignCurrencyId = await createCurrencyFixture(request, token, {
      ...scope, headers, code: foreignCurrencyCode, name: 'QA Journal foreign currency',
    })
    const sequenceNumber = 1
    const foreignLine = { currencyId: foreignCurrencyId, exchangeRate: '4.30001234', amountCurrency: '100.0001' }
    const baseLine = { currencyId: baseCurrencyId, exchangeRate: '1.00000000', amountCurrency: '430.0017' }
    const balance = '430.0017'
    const entryId = await seedJournalEntryInDb({
      ...scope, currencyId: foreignCurrencyId, operationDate: '2034-01-15', sequenceNumber, description: 'QA Browser journal entry',
      lines: [
        { accountId: debitAccountId, debit: balance, credit: '0', originalCurrency: baseLine },
        { accountId: creditAccountId, debit: '0', credit: balance, originalCurrency: foreignLine },
      ],
    })
    const reversalId = await seedJournalEntryInDb({
      ...scope, currencyId: foreignCurrencyId, operationDate: '2034-01-16', sequenceNumber: sequenceNumber + 1,
      description: 'QA Browser reversal', type: 'REVERSAL', referenceType: 'journal_entry', referenceId: entryId,
      lines: [
        { accountId: debitAccountId, debit: '0', credit: balance, originalCurrency: baseLine },
        { accountId: creditAccountId, debit: balance, credit: '0', originalCurrency: foreignLine },
      ],
    })
    const unresolvedCurrencyId = randomUUID()
    const unresolvedLine = { currencyId: unresolvedCurrencyId, exchangeRate: '4.30001234', amountCurrency: '100.0001' }
    const unresolvedEntryId = await seedJournalEntryInDb({
      ...scope, currencyId: unresolvedCurrencyId, operationDate: '2034-01-17', sequenceNumber: sequenceNumber + 2,
      description: 'QA Browser unresolved currency',
      lines: [
        { accountId: debitAccountId, debit: balance, credit: '0', originalCurrency: baseLine },
        { accountId: creditAccountId, debit: '0', credit: balance, originalCurrency: unresolvedLine },
      ],
    })

    const viewer = await browser.newPage({ baseURL })
    try {
      await fixture.login(viewer, ['ledger.accounts.view', 'ledger.entries.view'])
      const content = viewer.getByRole('main')
      await viewer.goto('/backend/ledger/account-types')
      await expect(content.getByRole('row', { name: /QA Renamed Materials/ })).toBeVisible()
      await expect(content.getByRole('link', { name: 'New account type' })).toHaveCount(0)
      await expect(content.getByRole('button', { name: 'Open actions' })).toHaveCount(0)

      await viewer.goto('/backend/ledger/accounts')
      await expect(content.getByRole('row', { name: /QA Stored debit account/ })).toBeVisible()
      await expect(content.getByRole('link', { name: 'New account' })).toHaveCount(0)
      await expect(content.getByRole('button', { name: 'Open actions' })).toHaveCount(0)

      await viewer.goto('/backend/ledger/journal-entries')
      const journal = content.getByRole('row', { name: /QA Browser journal entry/ })
      await journal.getByRole('link', { name: String(sequenceNumber), exact: true }).click()
      await expect(content.getByRole('heading', { name: `Journal entry #${sequenceNumber}` })).toBeVisible()
      const table = content.getByRole('table')
      await expect(table.getByRole('columnheader')).toHaveText([
        'Account number', 'Account name', 'Currency', 'Exchange rate', 'Original amount', 'Debit', 'Credit',
      ])
      const debitCells = table.getByRole('row', { name: /QA Stored debit account/ }).getByRole('cell')
      const creditCells = table.getByRole('row', { name: /QA Stored credit account/ }).getByRole('cell')
      const debitFields = ['456-01', 'QA Stored debit account', baseCurrencyCode, '1.00000000', '430.0017']
      const creditFields = ['456-02', 'QA Stored credit account', foreignCurrencyCode, '4.30001234', '100.0001']
      await expect(debitCells).toHaveText([...debitFields, balance, ''])
      await expect(creditCells).toHaveText([...creditFields, '', balance])
      await viewer.screenshot({ path: test.info().outputPath('ledger-journal-detail.png') })

      const [detail] = await Promise.all([
        viewer.waitForResponse((response) => {
          const url = new URL(response.url())
          return response.request().method() === 'GET'
            && url.pathname === '/api/ledger/journal-entries'
            && url.searchParams.get('id') === reversalId
        }),
        content.getByRole('link', { name: '#2', exact: true }).click(),
      ])
      await expect(viewer).toHaveURL(new RegExp(reversalId + '$'))
      await expect(content.getByRole('heading', { name: 'Journal entry #2' })).toBeVisible()
      await expect(debitCells).toHaveText([...debitFields, '', balance])
      await expect(creditCells).toHaveText([...creditFields, balance, ''])
      await expect(content.getByRole('link', { name: '#1', exact: true })).toHaveAttribute(
        'href', `/backend/ledger/journal-entries/${entryId}`,
      )
      await viewer.screenshot({ path: test.info().outputPath('ledger-journal-reversal.png') })

      expect(detail.status()).toBe(200)
      const detailLines = ((await detail.json()) as { items: Array<{ lines?: Array<{ currencyId: string; currencyCode: string }> }> }).items[0].lines ?? []
      expect(detailLines.map(({ currencyId, currencyCode }) => [currencyId, currencyCode]).sort()).toEqual([
        [baseCurrencyId, baseCurrencyCode],
        [foreignCurrencyId, foreignCurrencyCode],
      ].sort())

      await viewer.goto(`/backend/ledger/journal-entries/${unresolvedEntryId}`)
      await expect(content.getByRole('heading', { name: `Journal entry #${sequenceNumber + 2}` })).toBeVisible()
      await expect(debitCells).toHaveText([...debitFields, balance, ''])
      await expect(creditCells).toHaveText(['456-02', 'QA Stored credit account', unresolvedCurrencyId, '4.30001234', '100.0001', '', balance])
    } finally {
      await viewer.close()
    }
  } finally {
    for (const currencyId of [foreignCurrencyId, baseCurrencyId]) {
      await deleteCurrenciesEntityIfExists(request, fixture.token, '/api/currencies/currencies', currencyId, { headers: fixture.headers })
    }
    await fixture.cleanup()
  }
})
