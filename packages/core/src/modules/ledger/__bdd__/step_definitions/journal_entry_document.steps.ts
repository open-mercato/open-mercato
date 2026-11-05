// Step definitions for `../features/journal_entry_document.feature`.
//
// Exercises the real `ledger.postJournalEntry` command. The document type and
// number are optional while the engine has no document-producing caller (see
// the spec's Design decisions); they become required when the first caller
// lands, and the second scenario is the one that changes then.
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/postJournalEntry'
import { FiscalPeriod, JournalEntry, LedgerAccount } from '../../data/entities'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import type { PostJournalEntryResult } from '../../commands/postJournalEntry'
import { buildCommandContext, executeCommand, FakeEntityManager, newId, ORG_ID, TENANT_ID } from '../support/world'

const CURRENCY_ID = newId()
const DEBIT_ACCOUNT_ID = newId()
const CREDIT_ACCOUNT_ID = newId()

let em: FakeEntityManager
let posted: PostJournalEntryResult

Given('an open fiscal period and two accounts to post against', function () {
  em = new FakeEntityManager()
  em.seed(FiscalPeriod, {
    id: newId(),
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-30'),
    isLocked: false,
    deletedAt: null,
  })
  em.seed(Currency, { id: CURRENCY_ID, organizationId: ORG_ID, tenantId: TENANT_ID, code: 'PLN', name: 'Polish Zloty', isBase: true, decimalPlaces: 2, deletedAt: null })
  em.seed(LedgerAccount, { id: DEBIT_ACCOUNT_ID, organizationId: ORG_ID, tenantId: TENANT_ID, number: '130-1', accountTypeId: newId(), deletedAt: null })
  em.seed(LedgerAccount, { id: CREDIT_ACCOUNT_ID, organizationId: ORG_ID, tenantId: TENANT_ID, number: '700-1', accountTypeId: newId(), deletedAt: null })
})

function entryInput(document: { documentType?: string; documentNumber?: string }) {
  return {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    operationDate: '2026-06-15',
    description: 'BDD scenario: document reference',
    currencyId: CURRENCY_ID,
    ...document,
    lines: [
      { accountId: DEBIT_ACCOUNT_ID, debit: '100.00' },
      { accountId: CREDIT_ACCOUNT_ID, credit: '100.00' },
    ],
  }
}

When('I post a balanced entry with document type {string} and document number {string}', async function (documentType: string, documentNumber: string) {
  posted = await executeCommand<PostJournalEntryResult>('ledger.postJournalEntry', entryInput({ documentType, documentNumber }), buildCommandContext(em))
})

When('I post a balanced entry with no document reference', async function () {
  posted = await executeCommand<PostJournalEntryResult>('ledger.postJournalEntry', entryInput({}), buildCommandContext(em))
})

async function postedEntry(): Promise<{ documentType?: string | null; documentNumber?: string | null }> {
  const entry = await em.findOne(JournalEntry, { id: posted.journalEntryId })
  assert.ok(entry, 'expected the posted entry to be stored')
  return entry as { documentType?: string | null; documentNumber?: string | null }
}

Then('the posted entry carries document type {string} and document number {string}', async function (documentType: string, documentNumber: string) {
  const entry = await postedEntry()
  assert.strictEqual(entry.documentType, documentType)
  assert.strictEqual(entry.documentNumber, documentNumber)
})

Then('the posted entry carries no document type and no document number', async function () {
  const entry = await postedEntry()
  assert.strictEqual(entry.documentType ?? null, null)
  assert.strictEqual(entry.documentNumber ?? null, null)
})
