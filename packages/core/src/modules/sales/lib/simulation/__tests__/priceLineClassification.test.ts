import fs from 'node:fs'
import path from 'node:path'
import type { ExplainProviderContext } from '@open-mercato/shared/modules/insights/explain'
import type { SimulationRecordHistoryEntry, SimulationRecordHistoryQuery } from '@open-mercato/shared/modules/insights/simulate'
import { readCatalogPriceTimeline, PRICE_TIMELINE_MAX_PAGES, PRICE_TIMELINE_PAGE_SIZE } from '@open-mercato/core/modules/catalog/lib/simulation/priceTimeline'
import {
  PRICE_HISTORY_MAX_PAGES,
  PRICE_HISTORY_ORDER_TOLERANCE_MS,
  PRICE_HISTORY_PAGE_SIZE,
  readPriceAmountAsOf,
  type PriceAmountAsOf,
  type PriceBasis,
} from '../../explain/linePriceProvider'
import {
  classifyPriceLine,
  hasPriceUnitConversion,
  priceAmountAt,
  unknownPriceAmountReason,
  type PriceLineProposalAmounts,
  type PriceLineRecord,
  type PriceLineTimeline,
} from '../priceLineClassification'

const T0 = Date.parse('2026-09-01T10:00:00.000Z')
const PRICE_ID = '33333333-3333-4333-8333-333333333333'

type HistoryInput = {
  at: number
  actionType?: string
  executionState?: string
  historyAction?: string | null
  before?: unknown
  after?: unknown
}

function snapshot(net: string | null, gross: string | null = null, currencyCode: string | null = 'EUR'): Record<string, unknown> {
  return { id: PRICE_ID, unitPriceNet: net, unitPriceGross: gross, currencyCode, startsAt: null }
}

let sequence = 0

function historyEntry(input: HistoryInput): SimulationRecordHistoryEntry {
  sequence += 1
  return {
    logId: `44444444-4444-4444-8444-${String(sequence).padStart(12, '0')}`,
    at: new Date(input.at).toISOString(),
    commandId: 'catalog.prices.update',
    actionType: input.actionType ?? 'edit',
    executionState: input.executionState ?? 'done',
    actorUserId: null,
    resourceKind: 'catalog.price',
    resourceId: PRICE_ID,
    snapshotBefore: input.before ?? null,
    snapshotAfter: input.after === undefined ? null : input.after,
    changes: null,
    causeKind: 'user',
    organizationId: null,
    correlationId: null,
    causedByLogId: null,
    actorKind: 'user',
    historyAction: input.historyAction ?? null,
  }
}

/** Newest first, as the audit service returns history. */
function newestFirst(entries: SimulationRecordHistoryEntry[]): SimulationRecordHistoryEntry[] {
  return [...entries].sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || (left.logId < right.logId ? 1 : -1))
}

function pagedReader(entries: SimulationRecordHistoryEntry[]) {
  const ordered = newestFirst(entries)
  return async (query: { before: { id: string } | null; limit: number }) => {
    const start = query.before ? ordered.findIndex((entry) => entry.logId === query.before?.id) + 1 : 0
    const rows = ordered.slice(start, start + query.limit)
    const last = rows.at(-1)
    return { entries: rows, nextBefore: rows.length === query.limit && last ? { at: last.at, id: last.logId } : null }
  }
}

async function timelineOf(entries: SimulationRecordHistoryEntry[]): Promise<PriceLineTimeline> {
  const read = pagedReader(entries)
  return readCatalogPriceTimeline((query: SimulationRecordHistoryQuery) => read(query), PRICE_ID)
}

function explainContext(entries: SimulationRecordHistoryEntry[]): ExplainProviderContext {
  const read = pagedReader(entries)
  return {
    resolve: (name: string) => (name === 'actionLogService' ? { findFieldHistory: read } : undefined),
    scope: { tenantId: '11111111-1111-4111-8111-111111111111', organizationIds: ['22222222-2222-4222-8222-222222222222'] },
  } as unknown as ExplainProviderContext
}

function line(overrides: Partial<PriceLineRecord> = {}): PriceLineRecord {
  return {
    createdAt: new Date(T0 + 60_000).toISOString(),
    updatedAt: new Date(T0 + 60_000).toISOString(),
    currencyCode: 'EUR',
    quantity: '2.0000',
    unitPriceNet: '10.0000',
    unitPriceGross: '12.3000',
    priceMode: 'net',
    uomFactor: null,
    quantityUnit: null,
    normalizedUnit: null,
    ...overrides,
  }
}

const PROPOSAL: PriceLineProposalAmounts = { currencyCode: 'EUR', unitPriceNet: BigInt(120_000), unitPriceGross: BigInt(147_600) }

function serialize(state: PriceAmountAsOf): string {
  return JSON.stringify(state, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
}

describe('price line classification (price backtest, S9)', () => {
  const created = historyEntry({ at: T0, actionType: 'create', after: snapshot('10.0000', '12.3000') })

  it('reuses the bound of the "Why?" line price explanation for the price row timeline', () => {
    expect(PRICE_TIMELINE_PAGE_SIZE).toBe(PRICE_HISTORY_PAGE_SIZE)
    expect(PRICE_TIMELINE_MAX_PAGES).toBe(PRICE_HISTORY_MAX_PAGES)
    expect(PRICE_HISTORY_ORDER_TOLERANCE_MS).toBe(5)
  })

  it('counts a line whose price equals the row amount at its creation as priced from the row, with revenues', async () => {
    const result = classifyPriceLine(line(), await timelineOf([created]), PROPOSAL, 'net')
    expect(result).toEqual({
      outcome: 'priced_from_row',
      basis: 'net',
      reason: null,
      currentRevenue: BigInt(10_0000) * BigInt(2_0000),
      simulatedRevenue: BigInt(12_0000) * BigInt(2_0000),
    })
  })

  it('compares in the recorded price mode (gross)', async () => {
    const result = classifyPriceLine(line({ priceMode: 'gross', unitPriceNet: '99' }), await timelineOf([created]), PROPOSAL, 'net')
    expect(result).toEqual(expect.objectContaining({ outcome: 'priced_from_row', basis: 'gross', simulatedRevenue: BigInt(147_600) * BigInt(20_000) }))
  })

  it('counts a different price while the row kept its amount as a manual override (excluded)', async () => {
    const changedLater = historyEntry({ at: T0 + 120_000, before: snapshot('10.0000'), after: snapshot('11.0000') })
    const result = classifyPriceLine(line({ unitPriceNet: '9.5000' }), await timelineOf([created, changedLater]), PROPOSAL, 'net')
    expect(result).toEqual({ outcome: 'manual_override', basis: 'net', reason: null, currentRevenue: null, simulatedRevenue: null })
  })

  it('uses the amount in force at the line creation, not the current one', async () => {
    const changed = historyEntry({ at: T0 + 30_000, before: snapshot('10.0000'), after: snapshot('11.0000') })
    const timeline = await timelineOf([created, changed])
    expect(classifyPriceLine(line({ createdAt: new Date(T0 + 10_000).toISOString(), updatedAt: null }), timeline, PROPOSAL, 'net').outcome).toBe('priced_from_row')
    expect(classifyPriceLine(line({ unitPriceNet: '11', createdAt: new Date(T0 + 40_000).toISOString(), updatedAt: null }), timeline, PROPOSAL, 'net').outcome).toBe('priced_from_row')
    expect(classifyPriceLine(line({ unitPriceNet: '9', createdAt: new Date(T0 + 40_000).toISOString(), updatedAt: null }), timeline, PROPOSAL, 'net').outcome).toBe('manual_override')
  })

  it('cannot tell when the line keeps an EARLIER amount of the row (a converted quote line, a stale line dialog)', async () => {
    const changed = historyEntry({ at: T0 + 30_000, before: snapshot('10.0000'), after: snapshot('11.0000') })
    const timeline = await timelineOf([created, changed])
    const later = { createdAt: new Date(T0 + 40_000).toISOString(), updatedAt: null }
    expect(classifyPriceLine(line(later), timeline, PROPOSAL, 'net')).toEqual(expect.objectContaining({ outcome: 'cannot_tell', reason: 'matches_earlier_row_amount' }))
    expect(classifyPriceLine(line({ ...later, currencyCode: 'USD' }), timeline, PROPOSAL, 'net').reason).toBe('currency_mismatch')
    const switched = await timelineOf([
      created,
      historyEntry({ at: T0 + 20_000, before: snapshot('10.0000'), after: snapshot('10.0000', '12.3000', 'USD') }),
      historyEntry({ at: T0 + 30_000, before: snapshot('10.0000', '12.3000', 'USD'), after: snapshot('11.0000', '13.5300', 'USD') }),
    ])
    expect(classifyPriceLine(line({ ...later, currencyCode: 'USD', unitPriceNet: '9' }), switched, PROPOSAL, 'net').outcome).toBe('manual_override')
    expect(classifyPriceLine(line({ ...later, currencyCode: 'USD' }), switched, PROPOSAL, 'net').reason).toBe('matches_earlier_row_amount')
    const notFromCreate = await timelineOf([historyEntry({ at: T0 + 30_000, before: snapshot('8.0000'), after: snapshot('11.0000') })])
    expect(classifyPriceLine(line({ ...later, unitPriceNet: '8' }), notFromCreate, PROPOSAL, 'net').reason).toBe('matches_earlier_row_amount')
  })

  it('cannot tell when the row changed within 5 ms of the line creation, on both sides of the boundary', async () => {
    const changeAt = T0 + 30_000
    const timeline = await timelineOf([created, historyEntry({ at: changeAt, before: snapshot('10.0000'), after: snapshot('11.0000') })])
    for (const offset of [-5, -1, 0, 1, 5]) {
      const result = classifyPriceLine(line({ createdAt: new Date(changeAt + offset).toISOString(), updatedAt: null }), timeline, PROPOSAL, 'net')
      expect(result).toEqual(expect.objectContaining({ outcome: 'cannot_tell', reason: 'price_change_within_tolerance' }))
    }
    expect(classifyPriceLine(line({ createdAt: new Date(changeAt - 6).toISOString(), updatedAt: null }), timeline, PROPOSAL, 'net').outcome).toBe('priced_from_row')
    expect(classifyPriceLine(line({ createdAt: new Date(changeAt + 6).toISOString(), updatedAt: null }), timeline, PROPOSAL, 'net').reason).toBe('matches_earlier_row_amount')
    expect(classifyPriceLine(line({ unitPriceNet: '7', createdAt: new Date(changeAt + 6).toISOString(), updatedAt: null }), timeline, PROPOSAL, 'net').outcome).toBe('manual_override')
    expect(classifyPriceLine(line({ unitPriceNet: '11', createdAt: new Date(changeAt + 6).toISOString(), updatedAt: null }), timeline, PROPOSAL, 'net').outcome).toBe('priced_from_row')
  })

  it('cannot tell before the oldest change of a truncated history, and names the reason', async () => {
    const entries = Array.from({ length: 205 }, (_, index) => historyEntry({
      at: T0 + 1_000 + index * 1_000,
      before: snapshot('10.0000'),
      after: snapshot('10.0000'),
    }))
    const timeline = await timelineOf([created, ...entries])
    expect(timeline).toEqual(expect.objectContaining({ exhausted: false, truncated: true }))
    expect(timeline.entries).toHaveLength(200)
    const early = line({ createdAt: new Date(T0 + 500).toISOString(), updatedAt: null })
    expect(classifyPriceLine(early, timeline, PROPOSAL, 'net')).toEqual(expect.objectContaining({ outcome: 'cannot_tell', reason: 'price_history_truncated' }))
    const late = line({ createdAt: new Date(T0 + 300_000).toISOString(), updatedAt: null })
    expect(classifyPriceLine(late, timeline, PROPOSAL, 'net').outcome).toBe('priced_from_row')
    expect(classifyPriceLine({ ...late, unitPriceNet: '9' }, timeline, PROPOSAL, 'net').reason).toBe('price_history_truncated')
  })

  it('cannot tell when the row did not exist yet, the currency differs, or the amount is missing', async () => {
    const timeline = await timelineOf([created])
    expect(classifyPriceLine(line({ createdAt: new Date(T0 - 1_000).toISOString() }), timeline, PROPOSAL, 'net').reason).toBe('price_absent_at_write')
    expect(classifyPriceLine(line({ currencyCode: 'usd' }), timeline, PROPOSAL, 'net').reason).toBe('currency_mismatch')
    const grossless = await timelineOf([historyEntry({ at: T0, actionType: 'create', after: snapshot('10.0000', null) })])
    expect(classifyPriceLine(line({ priceMode: 'gross' }), grossless, PROPOSAL, 'net').reason).toBe('price_amount_missing')
    const unreadable = await timelineOf([historyEntry({ at: T0, actionType: 'create', after: 'sealed' })])
    expect(classifyPriceLine(line(), unreadable, PROPOSAL, 'net').reason).toBe('price_amount_unknown')
    expect(classifyPriceLine(line(), { entries: [], exhausted: true }, PROPOSAL, 'net').reason).toBe('price_amount_unknown')
  })

  it('treats a deleted row as absent and skips failed entries', async () => {
    const deleted = historyEntry({ at: T0 + 30_000, actionType: 'delete', before: snapshot('10.0000'), after: null })
    const failed = historyEntry({ at: T0 + 50_000, executionState: 'failed', before: snapshot('10.0000'), after: snapshot('99.0000') })
    const timeline = await timelineOf([created, deleted, failed])
    expect(classifyPriceLine(line({ createdAt: new Date(T0 + 50_002).toISOString(), updatedAt: null }), timeline, PROPOSAL, 'net').reason).toBe('price_absent_at_write')
    expect(unknownPriceAmountReason(timeline, T0 + 50_002)).toBe('price_amount_unknown')
  })

  it('cannot tell without a recorded price mode (grouped under the row display basis) or for another unit of measure', async () => {
    const timeline = await timelineOf([created])
    expect(classifyPriceLine(line({ priceMode: null }), timeline, PROPOSAL, 'gross')).toEqual(expect.objectContaining({ outcome: 'cannot_tell', reason: 'price_mode_unknown', basis: 'gross' }))
    expect(classifyPriceLine(line({ priceMode: 'other' }), timeline, PROPOSAL, null)).toEqual(expect.objectContaining({ reason: 'price_mode_unknown', basis: 'net' }))
    expect(classifyPriceLine(line({ uomFactor: '12' }), timeline, PROPOSAL, 'net').reason).toBe('unit_conversion')
    expect(classifyPriceLine(line({ uomFactor: '1.000000' }), timeline, PROPOSAL, 'net').outcome).toBe('priced_from_row')
    expect(hasPriceUnitConversion({ uomFactor: null, quantityUnit: 'box', normalizedUnit: 'pcs' })).toBe(true)
    expect(hasPriceUnitConversion({ uomFactor: null, quantityUnit: 'PCS', normalizedUnit: 'pcs' })).toBe(false)
    expect(classifyPriceLine(line({ quantity: 'n/a' }), timeline, PROPOSAL, 'net').reason).toBe('line_amount_missing')
  })

  it('re-prices only in the proposal currency and in a proposed basis', async () => {
    const timeline = await timelineOf([created])
    expect(classifyPriceLine(line(), timeline, { ...PROPOSAL, currencyCode: 'USD' }, 'net').reason).toBe('currency_differs_from_proposal')
    expect(classifyPriceLine(line(), timeline, { ...PROPOSAL, unitPriceNet: null }, 'net').reason).toBe('basis_not_proposed')
    expect(classifyPriceLine(line({ priceMode: 'gross' }), timeline, { ...PROPOSAL, unitPriceGross: null }, 'net').reason).toBe('basis_not_proposed')
    expect(classifyPriceLine(line({ unitPriceNet: '1' }), timeline, { ...PROPOSAL, unitPriceNet: null }, 'net').outcome).toBe('manual_override')
  })

  it('cannot tell when a line edited later may have been re-priced from a changed row', async () => {
    const changed = historyEntry({ at: T0 + 90_000, before: snapshot('10.0000'), after: snapshot('12.0000') })
    const timeline = await timelineOf([created, changed])
    const edited = { createdAt: new Date(T0 + 60_000).toISOString(), updatedAt: new Date(T0 + 120_000).toISOString() }
    expect(classifyPriceLine(line({ ...edited, unitPriceNet: '12' }), timeline, PROPOSAL, 'net')).toEqual(expect.objectContaining({ outcome: 'cannot_tell', reason: 'row_changed_while_line_edited' }))
    expect(classifyPriceLine(line({ ...edited, unitPriceNet: '15' }), timeline, PROPOSAL, 'net').outcome).toBe('manual_override')
    expect(classifyPriceLine(line({ ...edited, unitPriceNet: '10' }), timeline, PROPOSAL, 'net').outcome).toBe('priced_from_row')
    const editedBeforeChange = { createdAt: new Date(T0 + 60_000).toISOString(), updatedAt: new Date(T0 + 70_000).toISOString() }
    expect(classifyPriceLine(line({ ...editedBeforeChange, unitPriceNet: '12' }), timeline, PROPOSAL, 'net').outcome).toBe('manual_override')
  })

  it('reads the row amount at a time exactly as the "Why?" explanation reads it from audit history (randomized parity)', async () => {
    let seed = 1234567
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const amounts = ['10.0000', '10', '11.5000', null, '12.30', '0.0000']
    const currencies = ['EUR', 'eur', 'USD', null]
    for (let scenario = 0; scenario < 60; scenario += 1) {
      const entries: SimulationRecordHistoryEntry[] = []
      let at = T0
      const count = scenario % 7 === 0 ? 210 + Math.floor(random() * 20) : Math.floor(random() * 12)
      for (let index = 0; index < count; index += 1) {
        at += random() < 0.3 ? 1 + Math.floor(random() * 8) : 10 + Math.floor(random() * 5_000)
        const pick = random()
        const after = random() < 0.08 ? 'sealed' : snapshot(amounts[Math.floor(random() * amounts.length)], amounts[Math.floor(random() * amounts.length)], currencies[Math.floor(random() * currencies.length)])
        if (index === 0 && random() < 0.7) entries.push(historyEntry({ at, actionType: 'create', after }))
        else if (pick < 0.08) entries.push(historyEntry({ at, actionType: 'delete', before: after, after: null }))
        else if (pick < 0.14) entries.push(historyEntry({ at, historyAction: 'undo', before: null, after: random() < 0.5 ? null : after }))
        else if (pick < 0.2) entries.push(historyEntry({ at, executionState: 'failed', before: after, after }))
        else if (pick < 0.24) entries.push(historyEntry({ at, executionState: 'undone', before: after, after }))
        else entries.push(historyEntry({ at, before: random() < 0.1 ? null : after, after }))
      }
      const timeline = await timelineOf(entries)
      const context = explainContext(entries)
      const probes: number[] = [T0 - 100, at + 100]
      for (const entry of entries.slice(-30)) {
        const time = Date.parse(entry.at)
        for (const offset of [-7, -6, -5, -1, 0, 1, 5, 6, 7]) probes.push(time + offset)
      }
      for (let index = 0; index < 20; index += 1) probes.push(T0 + Math.floor(random() * (at - T0 + 200)) - 100)
      for (const probe of probes) {
        for (const basis of ['net', 'gross'] as PriceBasis[]) {
          const fromTimeline = priceAmountAt(timeline, probe, basis)
          const fromExplain = await readPriceAmountAsOf(context, PRICE_ID, new Date(probe).toISOString(), basis)
          expect(serialize(fromTimeline)).toBe(serialize(fromExplain))
        }
      }
    }
  })

  it('only reads: no write, event or command in the classification and scan code', () => {
    for (const file of ['priceLineClassification.ts', 'priceLines.ts', 'priceLineSources.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      expect(source).not.toMatch(/emitEvent\(|eventBus|commandBus|\.persist\(|\.flush\(|nativeUpdate|nativeDelete|insert into|update\s+"?sales_|delete from|\.remove\(/i)
    }
  })
})
