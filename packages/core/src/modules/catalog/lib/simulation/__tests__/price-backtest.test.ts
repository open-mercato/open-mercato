import fs from 'node:fs'
import path from 'node:path'

const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: jest.fn(),
}))

import type { SimulationRecordHistoryEntry, SimulationRunContext } from '@open-mercato/shared/modules/insights/simulate'
import { catalogPriceBacktestProposalSchema, type CatalogPriceBacktestProposal } from '../../../data/validators'
import {
  PRICE_BACKTEST_CELLS,
  PRICE_BACKTEST_MAX_GROUPS,
  PRICE_BACKTEST_UNLINKED_LINES_CAP,
  canonicalPriceAmount,
  fingerprintPriceProposal,
  fingerprintPriceRow,
  formatRevenueUnits,
  priceBacktestKind,
  runPriceBacktestSlice,
  type PriceBacktestState,
} from '../price-backtest'
import {
  listCatalogPriceLineSources,
  registerCatalogPriceLineSource,
  resetCatalogPriceLineSourcesForTests,
  type CatalogPriceLineOutcome,
  type CatalogPriceLineScanQuery,
  type CatalogPriceLineSource,
} from '../priceLineSources'
import { readCatalogPriceTimeline } from '../priceTimeline'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const SCOPE = { tenantId: TENANT, organizationId: ORG }
const PRICE_ID = '33333333-3333-4333-8333-333333333333'
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555'
const NOW = Date.parse('2026-10-10T12:00:00Z')
const WINDOW = { from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') }

function proposal(overrides: Record<string, unknown> = {}): CatalogPriceBacktestProposal {
  return catalogPriceBacktestProposalSchema.parse({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: '12.00', ...overrides })
}

function priceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRICE_ID,
    currencyCode: 'EUR',
    unitPriceNet: '10.0000',
    unitPriceGross: '12.3000',
    product: { id: PRODUCT_ID },
    variant: null,
    priceKind: { id: 'kind-1', displayMode: 'excluding-tax' },
    startsAt: new Date('2026-01-01T00:00:00Z'),
    endsAt: null,
    updatedAt: new Date('2026-09-15T08:00:00.000Z'),
    ...overrides,
  }
}

function outcome(overrides: Partial<CatalogPriceLineOutcome> = {}): CatalogPriceLineOutcome {
  return {
    lineId: 'line-1',
    documentId: 'doc-1',
    currencyCode: 'EUR',
    basis: 'net',
    outcome: 'priced_from_row',
    reason: null,
    currentRevenue: BigInt(200_000_000),
    simulatedRevenue: BigInt(240_000_000),
    ...overrides,
  }
}

type FakeSourceOptions = {
  family: string
  features: string[]
  pages: CatalogPriceLineOutcome[][]
  unlinked?: number
}

function fakeSource(options: FakeSourceOptions) {
  const queries: CatalogPriceLineScanQuery[] = []
  let page = 0
  const source: CatalogPriceLineSource = {
    family: options.family,
    labelKey: `sales.simulation.priceBacktest.families.${options.family}`,
    requiredFeatures: options.features,
    sampleResourceKind: options.family === 'orders' ? 'sales.order' : 'sales.quote',
    omittedCaveatKey: `sales.simulation.priceBacktest.caveats.${options.family}Omitted`,
    scanPage: jest.fn(async (query: CatalogPriceLineScanQuery) => {
      queries.push(query)
      const outcomes = options.pages[page] ?? []
      page += 1
      const exhausted = page >= options.pages.length
      return { outcomes, lastCursor: outcomes.length > 0 ? { at: `2026-08-0${page}T10:00:00.000000Z`, id: `66666666-6666-4666-8666-00000000000${page}` } : null, exhausted }
    }),
    countUnlinkedLines: jest.fn(async () => options.unlinked ?? 0),
  }
  return { source, queries }
}

function history(): SimulationRecordHistoryEntry[] {
  return [{
    logId: '44444444-4444-4444-8444-000000000001',
    at: '2026-06-01T10:00:00.000Z',
    commandId: 'catalog.prices.create',
    actionType: 'create',
    executionState: 'done',
    actorUserId: null,
    resourceKind: 'catalog.price',
    resourceId: PRICE_ID,
    snapshotBefore: null,
    snapshotAfter: { id: PRICE_ID, unitPriceNet: '10.0000', unitPriceGross: '12.3000', currencyCode: 'EUR', metadata: { secret: 'x' } },
    changes: null,
    causeKind: 'user',
    organizationId: ORG,
    correlationId: null,
    causedByLogId: null,
    actorKind: 'user',
    historyAction: null,
  }]
}

const emWrites = { persist: jest.fn(), flush: jest.fn(), nativeUpdate: jest.fn(), nativeDelete: jest.fn(), remove: jest.fn() }

function context(overrides: Partial<SimulationRunContext<PriceBacktestState>> = {}): SimulationRunContext<PriceBacktestState> {
  return {
    em: { ...emWrites } as never,
    scope: SCOPE,
    requesterUserId: 'user-1',
    artifactId: PRICE_ID,
    window: WINDOW,
    budget: { recordsRemaining: 50_000, sliceDeadlineAt: NOW + 15_000, runDeadlineAt: NOW + 120_000, maxBatchRows: 500, maxBatchBytes: 1_000_000 },
    state: null,
    now: () => NOW,
    hasFeatures: async () => true,
    eventAdapters: [],
    scanAuditLog: async () => ({ entries: [], lastCursor: null, exhausted: true, payloadBytes: 0, undecryptable: 0 }),
    readRecordHistory: jest.fn(async () => ({ entries: history(), nextBefore: null })),
    ...overrides,
  }
}

async function runDone(input: CatalogPriceBacktestProposal, ctx: SimulationRunContext<PriceBacktestState>) {
  const slice = await runPriceBacktestSlice(input, ctx)
  if (slice.status !== 'done') throw new Error('[internal] expected a finished slice')
  return slice
}

beforeEach(() => {
  findOneWithDecryption.mockReset()
  findOneWithDecryption.mockResolvedValue(priceRow())
  resetCatalogPriceLineSourcesForTests()
  for (const write of Object.values(emWrites)) write.mockReset()
})

describe('catalog.price_backtest proposal and artifact (S9, S15)', () => {
  it('declares the pricing feature, the three cells and refuses anything but an amount change of an existing row', () => {
    expect(priceBacktestKind.kind).toBe('catalog.price_backtest')
    expect(priceBacktestKind.requiredFeatures).toEqual(['catalog.pricing.manage'])
    expect(priceBacktestKind.cellKeys).toEqual([...PRICE_BACKTEST_CELLS])
    const schema = priceBacktestKind.inputSchema
    expect(schema.safeParse({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: '12.5' }).success).toBe(true)
    expect(schema.safeParse({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceGross: 15 }).success).toBe(true)
    expect(schema.safeParse({ priceId: PRICE_ID, currencyCode: 'EUR' }).success).toBe(false)
    expect(schema.safeParse({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: '12', minQuantity: 5 }).success).toBe(false)
    expect(schema.safeParse({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: '12', startsAt: '2026-01-01' }).success).toBe(false)
    expect(schema.safeParse({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: '-1' }).success).toBe(false)
    expect(schema.safeParse({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: '1.23456' }).success).toBe(false)
    expect(schema.safeParse({ priceId: PRICE_ID, currencyCode: 'eur', unitPriceNet: '1' }).success).toBe(false)
    expect(schema.safeParse({ priceId: 'not-a-uuid', currencyCode: 'EUR', unitPriceNet: '1' }).success).toBe(false)
    const missing = schema.safeParse({ priceId: PRICE_ID, currencyCode: 'EUR' })
    expect(missing.success ? null : missing.error.issues[0].message).toBe('catalog.simulation.validation.amountRequired')
  })

  it('validates against the row: new rows, other rows and currency changes are refused', async () => {
    const validate = priceBacktestKind.validate!
    const ctx = { em: {} as never, scope: SCOPE, eventAdapters: [] }
    await expect(validate(proposal(), { ...ctx, artifactId: PRICE_ID })).resolves.toEqual({ ok: true })
    await expect(validate(proposal(), { ...ctx, artifactId: null })).resolves.toEqual({ ok: true })
    await expect(validate(proposal(), { ...ctx, artifactId: '77777777-7777-4777-8777-777777777777' })).resolves.toEqual({ ok: false, code: 'invalid_proposal' })
    await expect(validate(proposal({ currencyCode: 'USD' }), { ...ctx, artifactId: PRICE_ID })).resolves.toEqual({ ok: false, code: 'invalid_proposal' })
    findOneWithDecryption.mockResolvedValueOnce(null)
    await expect(validate(proposal(), { ...ctx, artifactId: PRICE_ID })).resolves.toEqual({ ok: false, code: 'artifact_not_found' })
    expect(findOneWithDecryption).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { id: PRICE_ID, tenantId: TENANT, organizationId: ORG }, { populate: ['priceKind'] }, SCOPE)
  })

  it('reads the row version scoped and fingerprints the proposed amounts and the currency only', async () => {
    const input = proposal({ unitPriceNet: '10' })
    const version = await priceBacktestKind.readArtifactVersion({ em: {} as never, scope: SCOPE }, { artifactId: PRICE_ID, input })
    expect(version).toEqual({ artifactId: PRICE_ID, updatedAt: '2026-09-15T08:00:00.000Z', fingerprint: fingerprintPriceProposal(input) })
    findOneWithDecryption.mockResolvedValueOnce(null)
    expect(await priceBacktestKind.readArtifactVersion({ em: {} as never, scope: SCOPE }, { artifactId: PRICE_ID, input })).toBeNull()
    expect(await priceBacktestKind.readArtifactVersion({ em: {} as never, scope: SCOPE }, { artifactId: 'x', input })).toBeNull()
    const applied = priceRow({ unitPriceNet: '12.0000', unitPriceGross: '14.7600', startsAt: new Date('2027-01-01T00:00:00Z') })
    expect(fingerprintPriceRow(applied as never, proposal())).toBe(fingerprintPriceProposal(proposal()))
    expect(fingerprintPriceRow(applied as never, proposal({ unitPriceGross: '14.76' }))).toBe(fingerprintPriceProposal(proposal({ unitPriceGross: '14.76' })))
    expect(fingerprintPriceRow(applied as never, proposal({ unitPriceGross: '14.77' }))).not.toBe(fingerprintPriceProposal(proposal({ unitPriceGross: '14.77' })))
    expect(fingerprintPriceRow(priceRow({ unitPriceNet: '12.0000', currencyCode: 'USD' }) as never, proposal())).not.toBe(fingerprintPriceProposal(proposal()))
    expect(fingerprintPriceProposal(proposal())).not.toBe(fingerprintPriceProposal(proposal({ unitPriceNet: '12.01' })))
    expect(fingerprintPriceProposal(proposal({ unitPriceNet: undefined, unitPriceGross: '12' }))).not.toBe(fingerprintPriceProposal(proposal({ unitPriceNet: '12' })))
  })

  it('links back to the price row edit page', () => {
    expect(priceBacktestKind.applyHref!({ artifactId: PRICE_ID, runId: 'run-1' })).toBe(`/backend/catalog/prices/${PRICE_ID}/edit?simulationRunId=run-1`)
    expect(priceBacktestKind.applyHref!({ artifactId: null, runId: 'run-1' })).toBeNull()
  })

  it('formats amounts canonically and revenues rounded half away from zero', () => {
    expect(canonicalPriceAmount('12.5')).toBe('12.5000')
    expect(canonicalPriceAmount(12.5)).toBe('12.5000')
    expect(canonicalPriceAmount('0012.34565')).toBe('12.3457')
    expect(canonicalPriceAmount('abc')).toBeNull()
    expect(canonicalPriceAmount(null)).toBeNull()
    expect(formatRevenueUnits(BigInt(240_000_000))).toBe('2.40')
    expect(formatRevenueUnits(BigInt(123_456_789))).toBe('1.2346')
    expect(formatRevenueUnits(BigInt(-40_000_000_000))).toBe('-400.00')
    expect(formatRevenueUnits(BigInt(0))).toBe('0.00')
    expect(formatRevenueUnits(BigInt(-4_999))).toBe('0.00')
  })
})

describe('catalog price timeline', () => {
  it('reads at most 200 entries newest first, keeping amounts and currency only', async () => {
    const read = jest.fn(async (query: { before: unknown }) => ({
      entries: history(),
      nextBefore: query.before === null ? { at: '2026-06-01T10:00:00.000000Z', id: 'a' } : { at: '2026-05-01T10:00:00.000000Z', id: 'b' },
    }))
    const timeline = await readCatalogPriceTimeline(read, PRICE_ID)
    expect(read).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenNthCalledWith(1, { resourceKinds: ['catalog.price'], resourceId: PRICE_ID, before: null, limit: 100 })
    expect(timeline).toEqual(expect.objectContaining({ exhausted: false, truncated: true }))
    expect(timeline.entries[0]).toEqual({
      at: '2026-06-01T10:00:00.000Z',
      actionType: 'create',
      executionState: 'done',
      historyAction: null,
      snapshotBefore: null,
      snapshotAfter: { unitPriceNet: '10.0000', unitPriceGross: '12.3000', currencyCode: 'EUR' },
    })
    expect(await readCatalogPriceTimeline(undefined, PRICE_ID)).toEqual({ entries: [], exhausted: false, truncated: false })
  })
})

describe('catalog.price_backtest run', () => {
  it('reports orders and quotes separately, per currency and basis, with revenues and samples', async () => {
    const orders = fakeSource({
      family: 'orders',
      features: ['sales.orders.view'],
      unlinked: 3,
      pages: [[
        outcome({ documentId: 'o-1' }),
        outcome({ documentId: 'o-2', currentRevenue: BigInt(100_000_000), simulatedRevenue: BigInt(120_000_000) }),
        outcome({ documentId: 'o-3', outcome: 'manual_override', currentRevenue: null, simulatedRevenue: null }),
      ], [
        outcome({ documentId: 'o-4', currencyCode: 'usd', outcome: 'cannot_tell', reason: 'currency_mismatch', currentRevenue: null, simulatedRevenue: null }),
        outcome({ documentId: 'o-5', basis: 'gross', outcome: 'cannot_tell', reason: 'basis_not_proposed', currentRevenue: null, simulatedRevenue: null }),
      ]],
    })
    const quotes = fakeSource({ family: 'quotes', features: ['sales.quotes.view'], pages: [[outcome({ documentId: 'q-1' })]] })
    registerCatalogPriceLineSource(quotes.source)
    registerCatalogPriceLineSource(orders.source)
    const ctx = context()
    const { result, recordsProcessed } = await runDone(proposal(), ctx)
    expect(recordsProcessed).toBe(6)
    expect(result.groups.map((group) => group.key)).toEqual(['orders:EUR:gross', 'orders:EUR:net', 'orders:USD:net', 'quotes:EUR:net'])
    const ordersEur = result.groups[1]
    expect(ordersEur).toEqual(expect.objectContaining({
      labelKey: 'sales.simulation.priceBacktest.families.orders',
      sampleResourceKind: 'sales.order',
      requiredFeatures: ['sales.orders.view'],
      warnings: [],
    }))
    expect(ordersEur.cells).toEqual([
      { key: 'priced_from_row', count: 2, sampleIds: ['o-1', 'o-2'] },
      { key: 'manual_override', count: 1, sampleIds: ['o-3'] },
      { key: 'cannot_tell', count: 0, sampleIds: [] },
    ])
    expect(ordersEur.measures).toEqual([
      { key: 'current_revenue', cell: 'priced_from_row', value: '3.00', currencyCode: 'EUR' },
      { key: 'simulated_revenue', cell: 'priced_from_row', value: '3.60', currencyCode: 'EUR' },
      { key: 'revenue_delta', cell: 'priced_from_row', value: '0.60', currencyCode: 'EUR' },
    ])
    expect(result.groups[0].warnings).toEqual(['catalog.simulation.warnings.basisNotProposed'])
    expect(result.groups[2].warnings).toEqual(['catalog.simulation.warnings.currencyDiffers'])
    expect(result.groups[3].measures?.[0]).toEqual({ key: 'current_revenue', cell: 'priced_from_row', value: '2.00', currencyCode: 'EUR' })
    expect(result.coverage).toEqual({
      price_history_entries: 1,
      orders_lines_without_price_link: 3,
      orders_lines_scanned: 5,
      orders_lines_currency_mismatch: 1,
      orders_lines_basis_not_proposed: 1,
      quotes_lines_scanned: 1,
    })
    expect(result.caveats).toEqual([
      'catalog.simulation.caveats.priceIdBrowserOnly',
      'catalog.simulation.caveats.revenueAsStored',
      'catalog.simulation.caveats.perCurrency',
      'catalog.simulation.caveats.basisNotProposed',
    ])
    expect(result.fidelity).toBe('reconstructed')
    expect(result.coverageBreaksDownCells).toBe(true)
    const query = orders.queries[0]
    expect(query).toEqual(expect.objectContaining({ priceId: PRICE_ID, after: null, limit: 500, displayBasis: 'net', proposal: { currencyCode: 'EUR', unitPriceNet: '12', unitPriceGross: null } }))
    expect(query.timeline.entries[0].snapshotAfter).toEqual({ unitPriceNet: '10.0000', unitPriceGross: '12.3000', currencyCode: 'EUR' })
    expect(orders.queries[1].after).toEqual({ at: '2026-08-01T10:00:00.000000Z', id: '66666666-6666-4666-8666-000000000001' })
    expect(orders.source.countUnlinkedLines).toHaveBeenCalledWith(expect.objectContaining({ productId: PRODUCT_ID, variantId: null, cap: PRICE_BACKTEST_UNLINKED_LINES_CAP }))
    expect(ctx.readRecordHistory).toHaveBeenCalledWith({ resourceKinds: ['catalog.price'], resourceId: PRICE_ID, before: null, limit: 100 })
  })

  it('leaves out a family the requester may not read, with its caveat, and reports a family without lines as a zero group', async () => {
    const orders = fakeSource({ family: 'orders', features: ['sales.orders.view'], pages: [[outcome()]] })
    const quotes = fakeSource({ family: 'quotes', features: ['sales.quotes.view'], pages: [[]] })
    registerCatalogPriceLineSource(orders.source)
    registerCatalogPriceLineSource(quotes.source)
    const { result } = await runDone(proposal({ unitPriceGross: '14.76' }), context({ hasFeatures: async (features) => !features.includes('sales.orders.view') }))
    expect(orders.source.scanPage).not.toHaveBeenCalled()
    expect(orders.source.countUnlinkedLines).not.toHaveBeenCalled()
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toEqual(expect.objectContaining({
      key: 'quotes',
      cells: PRICE_BACKTEST_CELLS.map((cell) => ({ key: cell, count: 0, sampleIds: [] })),
      dataWarnings: ['catalog.simulation.warnings.noLinkedLines'],
      requiredFeatures: ['sales.quotes.view'],
    }))
    expect(result.groups[0]).not.toHaveProperty('measures')
    expect(result.caveats).toContain('sales.simulation.priceBacktest.caveats.ordersOmitted')
    expect(result.caveats).not.toContain('catalog.simulation.caveats.basisNotProposed')
    expect(Object.keys(result.coverage).some((key) => key.startsWith('orders_'))).toBe(false)
    expect(result.fidelity).toBe('none')
  })

  it('continues at the slice deadline with a JSON state, and drops a family whose feature the requester lost between slices', async () => {
    const orders = fakeSource({ family: 'orders', features: ['sales.orders.view'], unlinked: 4, pages: [[outcome()]] })
    registerCatalogPriceLineSource(orders.source)
    const paused = await runPriceBacktestSlice(proposal(), context({
      budget: { recordsRemaining: 50_000, sliceDeadlineAt: NOW, runDeadlineAt: NOW + 120_000, maxBatchRows: 500, maxBatchBytes: 1 },
    }))
    expect(paused).toEqual(expect.objectContaining({ status: 'continue', recordsProcessed: 0, progress: 0 }))
    if (paused.status !== 'continue') return
    expect(orders.source.scanPage).not.toHaveBeenCalled()
    const resumedState = JSON.parse(JSON.stringify(paused.state)) as PriceBacktestState
    const resumed = await runDone(proposal(), context({ state: resumedState }))
    expect(resumed.result.groups.map((group) => group.key)).toEqual(['orders:EUR:net'])
    expect(resumed.result.coverage).toEqual({ price_history_entries: 1, orders_lines_without_price_link: 4, orders_lines_scanned: 1 })

    const lost = JSON.parse(JSON.stringify(paused.state)) as PriceBacktestState
    lost.groups['orders:EUR:net'] = {
      family: 'orders',
      currencyCode: 'EUR',
      basis: 'net',
      cells: { priced_from_row: 1, manual_override: 0, cannot_tell: 0 },
      samples: { priced_from_row: ['o-1'], manual_override: [], cannot_tell: [] },
      currentRevenue: '1',
      simulatedRevenue: '2',
    }
    lost.coverage.orders_lines_scanned = 1
    lost.lines = 1
    const dropped = await runDone(proposal(), context({ state: lost, hasFeatures: async () => false }))
    expect(dropped.result.groups).toEqual([])
    expect(dropped.result.coverage).toEqual({ price_history_entries: 1 })
    expect(dropped.result.caveats).toContain('sales.simulation.priceBacktest.caveats.ordersOmitted')
    expect(dropped.result.fidelity).toBe('none')
  })

  it('stops at the record budget and the run deadline as truncated, and continues at the slice deadline', async () => {
    const orders = fakeSource({ family: 'orders', features: ['sales.orders.view'], pages: [[outcome(), outcome({ documentId: 'o-2' })], [outcome({ documentId: 'o-3' })]] })
    registerCatalogPriceLineSource(orders.source)
    const budgeted = await runDone(proposal(), context({ budget: { recordsRemaining: 2, sliceDeadlineAt: NOW + 15_000, runDeadlineAt: NOW + 120_000, maxBatchRows: 500, maxBatchBytes: 1 } }))
    expect(budgeted.result.truncated).toBe(true)
    expect(budgeted.result.caveats).toContain('catalog.simulation.caveats.truncated')
    expect(orders.queries[0].limit).toBe(2)
    resetCatalogPriceLineSourcesForTests()
    const late = fakeSource({ family: 'orders', features: ['sales.orders.view'], pages: [[outcome()]] })
    registerCatalogPriceLineSource(late.source)
    const deadline = await runDone(proposal(), context({ budget: { recordsRemaining: 10, sliceDeadlineAt: NOW, runDeadlineAt: NOW, maxBatchRows: 500, maxBatchBytes: 1 } }))
    expect(deadline.result.truncated).toBe(true)
    expect(late.source.scanPage).not.toHaveBeenCalled()
  })

  it('registers only valid line sources (short family ids without underscores, non-empty features), first one wins', () => {
    const valid = fakeSource({ family: 'orders', features: ['sales.orders.view'], pages: [] }).source
    registerCatalogPriceLineSource({ ...valid, family: 'order_lines' })
    registerCatalogPriceLineSource({ ...valid, family: 'averyveryverylongfamily' })
    registerCatalogPriceLineSource({ ...valid, requiredFeatures: [] })
    expect(listCatalogPriceLineSources()).toEqual([])
    registerCatalogPriceLineSource(valid)
    registerCatalogPriceLineSource({ ...valid, labelKey: 'other.label' })
    expect(listCatalogPriceLineSources()).toEqual([valid])
  })

  it('caps the number of groups and counts the lines beyond the cap', async () => {
    const outcomes = Array.from({ length: PRICE_BACKTEST_MAX_GROUPS + 3 }, (_, index) => outcome({ documentId: `o-${index}`, currencyCode: `A${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}` }))
    registerCatalogPriceLineSource(fakeSource({ family: 'orders', features: ['sales.orders.view'], pages: [outcomes] }).source)
    const { result } = await runDone(proposal(), context())
    expect(result.groups).toHaveLength(PRICE_BACKTEST_MAX_GROUPS)
    expect(result.coverage.orders_lines_beyond_group_limit).toBe(3)
    expect(result.caveats).toContain('catalog.simulation.caveats.groupLimit')
  })

  it('reports a missing row, missing sources and a missing history reader', async () => {
    findOneWithDecryption.mockResolvedValueOnce(null)
    const missing = await runDone(proposal(), context())
    expect(missing.result).toEqual(expect.objectContaining({ groups: [], fidelity: 'none' }))
    expect(missing.result.caveats).toContain('catalog.simulation.caveats.rowMissing')
    const noSources = await runDone(proposal(), context({ readRecordHistory: undefined }))
    expect(noSources.result.caveats).toEqual(expect.arrayContaining(['catalog.simulation.caveats.noLineSources', 'catalog.simulation.caveats.historyUnavailable']))
    expect(noSources.result.groups).toEqual([])
  })

  it('flags a truncated row history', async () => {
    registerCatalogPriceLineSource(fakeSource({ family: 'orders', features: ['sales.orders.view'], pages: [[]] }).source)
    const { result } = await runDone(proposal(), context({ readRecordHistory: jest.fn(async () => ({ entries: history(), nextBefore: { at: '2026-06-01T10:00:00.000000Z', id: 'x' } })) }))
    expect(result.caveats).toContain('catalog.simulation.caveats.historyTruncated')
  })

  it('has no side effects: it never writes, emits or executes', async () => {
    registerCatalogPriceLineSource(fakeSource({ family: 'orders', features: ['sales.orders.view'], pages: [[outcome()]] }).source)
    await runDone(proposal(), context())
    for (const write of Object.values(emWrites)) expect(write).not.toHaveBeenCalled()
    for (const file of ['price-backtest.ts', 'priceTimeline.ts', 'priceLineSources.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      expect(source).not.toMatch(/emitEvent\(|eventBus|commandBus|emitCrudSideEffects|\.persist\(|\.flush\(|nativeUpdate|nativeDelete|\.insert\(|\.remove\(|commands\/prices|taxCalculationService/)
    }
  })
})
