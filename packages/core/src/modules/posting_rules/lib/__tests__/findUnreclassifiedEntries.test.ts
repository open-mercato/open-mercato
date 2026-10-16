// Unit tests for `findUnreclassifiedEntries` — the finder shared by
// `reconcileCostRing` and the `posting_rules.lockFiscalPeriod` guard. The
// predicate is per source *line*: a line is covered only when a reclassification
// is keyed on its id.
export {}

import { FiscalPeriod } from '../../../ledger/data/entities'
import { findUnreclassifiedEntries } from '../findUnreclassifiedEntries'
import { RECLASSIFICATION_REFERENCE_TYPE } from '../reclassify'
import {
  CLEARING_ACCOUNT_ID,
  ORG,
  OTHER_ACCOUNT_ID,
  SCOPE,
  SECOND_SOURCE_ACCOUNT_ID,
  SOURCE_ACCOUNT_ID,
  TENANT,
  buildFakeEm,
  seedEntry,
  seedNonZespol4Account,
  seedReclassification,
  seedSettings,
  seedZespol4Account,
} from './support/fixtures'

function setup() {
  const em = buildFakeEm()
  seedZespol4Account(em, SOURCE_ACCOUNT_ID)
  seedZespol4Account(em, SECOND_SOURCE_ACCOUNT_ID)
  seedNonZespol4Account(em, OTHER_ACCOUNT_ID)
  seedSettings(em)
  return em
}

const find = (em: ReturnType<typeof buildFakeEm>, periodId?: string) => findUnreclassifiedEntries(em as any, SCOPE, periodId)

describe('findUnreclassifiedEntries', () => {
  it('lists the one line still missing in a partly reclassified multi-line entry (an entry-level count would call it done)', async () => {
    const em = setup()
    seedEntry(em, 'entry-1', [
      { id: 'line-1', accountId: SOURCE_ACCOUNT_ID, debit: '100.00' },
      { id: 'line-2', accountId: SECOND_SOURCE_ACCOUNT_ID, debit: '40.00' },
      { id: 'line-3', accountId: OTHER_ACCOUNT_ID, credit: '140.00' },
    ])
    seedReclassification(em, 'line-1')

    expect(await find(em)).toEqual([{ entryId: 'entry-1', lineId: 'line-2' }])
  })

  it('returns nothing once every source line has its reclassification', async () => {
    const em = setup()
    seedEntry(em, 'entry-1', [
      { id: 'line-1', accountId: SOURCE_ACCOUNT_ID, debit: '100.00' },
      { id: 'line-2', accountId: OTHER_ACCOUNT_ID, credit: '100.00' },
    ])
    seedReclassification(em, 'line-1')
    expect(await find(em)).toEqual([])
  })

  it('includes entries without a referenceType and with a foreign one', async () => {
    const em = setup()
    seedEntry(em, 'entry-null', [{ id: 'l-null', accountId: SOURCE_ACCOUNT_ID, debit: '10.00' }])
    seedEntry(em, 'entry-ref', [{ id: 'l-ref', accountId: SOURCE_ACCOUNT_ID, debit: '20.00' }], { referenceType: 'journal_entry', referenceId: 'x' })
    expect((await find(em)).map((row) => row.lineId).sort()).toEqual(['l-null', 'l-ref'])
  })

  it('skips CLOSING and OPENING entries', async () => {
    const em = setup()
    seedEntry(em, 'entry-closing', [{ id: 'l-closing', accountId: SOURCE_ACCOUNT_ID, credit: '500.00' }], { type: 'CLOSING' })
    seedEntry(em, 'entry-opening', [{ id: 'l-opening', accountId: SOURCE_ACCOUNT_ID, debit: '500.00' }], { type: 'OPENING' })
    expect(await find(em)).toEqual([])
  })

  it('includes the lines of REVERSAL entries', async () => {
    const em = setup()
    seedEntry(em, 'entry-reversal', [{ id: 'l-rev', accountId: SOURCE_ACCOUNT_ID, credit: '100.00' }], { type: 'REVERSAL', referenceType: 'journal_entry', referenceId: 'entry-1' })
    expect(await find(em)).toEqual([{ entryId: 'entry-reversal', lineId: 'l-rev' }])
  })

  it('skips the engine\'s own entries (they post to zespół 4 via the clearing account)', async () => {
    const em = setup()
    seedEntry(em, 'entry-engine', [{ id: 'l-engine', accountId: SOURCE_ACCOUNT_ID, credit: '100.00' }], { referenceType: RECLASSIFICATION_REFERENCE_TYPE, referenceId: 'line-x' })
    expect(await find(em)).toEqual([])
  })

  it('skips lines on the clearing account', async () => {
    const em = setup()
    seedZespol4Account(em, CLEARING_ACCOUNT_ID)
    seedEntry(em, 'entry-adjustment', [
      { id: 'l-clearing', accountId: CLEARING_ACCOUNT_ID, debit: '100.00' },
      { id: 'l-other', accountId: OTHER_ACCOUNT_ID, credit: '100.00' },
    ])
    expect(await find(em)).toEqual([])
  })

  it('restricts to the fiscal period when a period id is given', async () => {
    const em = setup()
    em.seed(FiscalPeriod, {
      id: 'period-sep',
      organizationId: ORG,
      tenantId: TENANT,
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-30'),
      deletedAt: null,
    })
    seedEntry(em, 'entry-sep', [{ id: 'l-sep', accountId: SOURCE_ACCOUNT_ID, debit: '10.00' }], { operationDate: '2026-09-15' })
    seedEntry(em, 'entry-oct', [{ id: 'l-oct', accountId: SOURCE_ACCOUNT_ID, debit: '10.00' }], { operationDate: '2026-10-02' })

    expect(await find(em, 'period-sep')).toEqual([{ entryId: 'entry-sep', lineId: 'l-sep' }])
    expect((await find(em)).map((row) => row.lineId).sort()).toEqual(['l-oct', 'l-sep'])
  })
})
