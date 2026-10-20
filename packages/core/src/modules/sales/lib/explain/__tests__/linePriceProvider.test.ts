import fs from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  ExplainHistoryEntry,
  ExplainProviderContext,
  ExplainReferenceDetail,
} from '@open-mercato/shared/modules/insights/explain'
import type {
  ActionLogFieldHistoryPage,
  ActionLogFieldHistoryQuery,
} from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import explainConfig from '../../../insights.explain'
import {
  CATALOG_PRICE_REFERENCE_KIND,
  LINE_PRICE_FACT_KEYS,
  PRICE_HISTORY_PAGE_SIZE,
  SALES_LINE_PRICE_PROVIDER_ID,
  explainLinePrice,
  findLinePriceWriteTime,
  linePriceProvider,
} from '../linePriceProvider'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORDER_ID = '33333333-3333-4333-8333-333333333333'
const LINE_ID = '44444444-4444-4444-8444-444444444444'
const PRICE_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_PRICE_ID = '66666666-6666-4666-8666-666666666666'

const PRICE_CREATED_AT = '2026-10-08T08:00:00.000Z'
const LINE_WRITTEN_AT = '2026-10-08T09:00:00.000Z'
const PRICE_UPDATED_AT = '2026-10-08T10:00:00.000Z'
const LINE_UPDATED_AT = '2026-10-08T11:00:00.000Z'

type LineInput = {
  priceId?: string | null
  priceMode?: 'net' | 'gross' | null
  unitPriceNet?: string
  unitPriceGross?: string
  currencyCode?: string
}

type SnapshotLine = {
  id: string
  unitPriceNet: string | number
  unitPriceGross: string | number
  metadata: Record<string, unknown> | null
}

function buildLine(input: LineInput = {}) {
  return {
    id: LINE_ID,
    lineNumber: 1,
    quantity: '1.000000',
    unitPriceNet: input.unitPriceNet ?? '19.9900',
    unitPriceGross: input.unitPriceGross ?? '19.9900',
    currencyCode: input.currencyCode ?? 'USD',
    priceId: input.priceId === undefined ? PRICE_ID : input.priceId,
    priceMode: input.priceMode === undefined ? 'net' : input.priceMode,
  }
}

function priceDetail(overrides: Partial<Record<string, string | number | boolean | null>> = {}, id = PRICE_ID): ExplainReferenceDetail {
  return {
    kind: CATALOG_PRICE_REFERENCE_KIND,
    id,
    label: 'Regular',
    href: null,
    organizationId: ORG_A,
    facts: {
      unitPriceNet: '19.9900',
      unitPriceGross: '19.9900',
      currencyCode: 'USD',
      ...overrides,
    },
  }
}

function snapshotLine(input: Partial<SnapshotLine> = {}): SnapshotLine {
  return {
    id: LINE_ID,
    unitPriceNet: '19.9900',
    unitPriceGross: '19.9900',
    metadata: { priceId: PRICE_ID, priceMode: 'net' },
    ...input,
  }
}

function orderEntry(params: {
  logId: string
  at: string
  before: SnapshotLine[] | null
  after: SnapshotLine[] | null
  executionState?: string
  historyAction?: string
}): ExplainHistoryEntry & { historyAction?: string } {
  return {
    logId: params.logId,
    at: params.at,
    commandId: 'sales.orders.lines.upsert',
    actionType: params.before ? 'update' : 'create',
    executionState: params.executionState ?? 'done',
    actorUserId: null,
    resourceKind: 'sales.order',
    resourceId: ORDER_ID,
    changedFields: ['lines'],
    snapshotBefore: params.before ? { order: { id: ORDER_ID }, lines: params.before } : null,
    snapshotAfter: params.after ? { order: { id: ORDER_ID }, lines: params.after } : null,
    changes: null,
    causeKind: 'user',
    causeId: null,
    ...(params.historyAction ? { historyAction: params.historyAction } : {}),
  }
}

function priceEntry(params: {
  logId: string
  at: string
  actionType: 'create' | 'update' | 'delete'
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}): ExplainHistoryEntry {
  return {
    logId: params.logId,
    at: params.at,
    commandId: `catalog.prices.${params.actionType}`,
    actionType: params.actionType,
    executionState: 'done',
    actorUserId: null,
    resourceKind: 'catalog.price',
    resourceId: PRICE_ID,
    changedFields: null,
    snapshotBefore: params.before ?? null,
    snapshotAfter: params.after ?? null,
    changes: null,
    causeKind: 'user',
    causeId: null,
  }
}

function priceState(net: string, gross: string = net, currencyCode = 'USD') {
  return { id: PRICE_ID, unitPriceNet: net, unitPriceGross: gross, currencyCode }
}

function historyPage(entries: ExplainHistoryEntry[], nextBefore: ActionLogFieldHistoryPage['nextBefore'] = null): ActionLogFieldHistoryPage {
  return { entries: entries as ActionLogFieldHistoryPage['entries'], nextBefore }
}

type ContextOptions = {
  line?: LineInput
  fieldKey?: 'unitPriceNet' | 'unitPriceGross'
  details?: ExplainReferenceDetail[]
  history?: ExplainHistoryEntry[]
  priceHistory?: jest.Mock<Promise<ActionLogFieldHistoryPage>, [ActionLogFieldHistoryQuery]> | null
}

function getOrderResource() {
  const resource = explainConfig.resources?.find((entry) => entry.resourceKind === 'sales.order')
  if (!resource) throw new Error('[internal] sales.order resource missing')
  return resource
}

function getLineField(key: 'unitPriceNet' | 'unitPriceGross') {
  const field = getOrderResource().collections?.[0]?.fields.find((entry) => entry.key === key)
  if (!field) throw new Error(`[internal] line field ${key} missing`)
  return field
}

function buildContext(options: ContextOptions = {}) {
  const resolveReference = jest.fn(async (_kind: string, _ids: string[]) => options.details ?? [priceDetail()])
  const priceHistory = options.priceHistory === undefined ? null : options.priceHistory
  const context: ExplainProviderContext = {
    em: {} as EntityManager,
    resolve: <TService>(name: string): TService | undefined =>
      (name === 'actionLogService' && priceHistory ? ({ findFieldHistory: priceHistory } as TService) : undefined),
    scope: { tenantId: TENANT_ID, organizationIds: [ORG_A] },
    userId: null,
    locale: 'en',
    resource: getOrderResource(),
    field: getLineField(options.fieldKey ?? 'unitPriceNet'),
    current: { id: ORDER_ID, organizationId: ORG_A, lines: [buildLine(options.line)] },
    itemId: LINE_ID,
    history: options.history ?? [],
    resolveReference,
  }
  return { context, resolveReference }
}

const lineCreatedEntry = orderEntry({
  logId: '77777777-0000-4000-8000-000000000001',
  at: LINE_WRITTEN_AT,
  before: [],
  after: [snapshotLine()],
})

describe('sales.line_price provider', () => {
  it('is registered by the sales explain config under its provider id', () => {
    expect(linePriceProvider.id).toBe(SALES_LINE_PRICE_PROVIDER_ID)
    expect(explainConfig.providers).toEqual([linePriceProvider])
    expect(getLineField('unitPriceNet').provider).toBe(SALES_LINE_PRICE_PROVIDER_ID)
    expect(getLineField('unitPriceGross').provider).toBe(SALES_LINE_PRICE_PROVIDER_ID)
  })

  it('reports a proven missing catalog link without resolving any price', async () => {
    const { context, resolveReference } = buildContext({ line: { priceId: null } })
    await expect(explainLinePrice(context)).resolves.toEqual([
      { key: LINE_PRICE_FACT_KEYS.noCatalogLink, params: { outcome: 'no_catalog_link' }, confidence: 'proven', reference: null },
    ])
    expect(resolveReference).not.toHaveBeenCalled()
  })

  it('returns no facts when the explained item is not a line of the record', async () => {
    const { context } = buildContext()
    await expect(explainLinePrice({ ...context, itemId: OTHER_PRICE_ID })).resolves.toEqual([])
  })

  it('matches the current price row amount (inferred) when no write time can be read', async () => {
    const { context, resolveReference } = buildContext({ line: { unitPriceNet: '19.99' } })
    const [fact] = await explainLinePrice(context)
    expect(resolveReference).toHaveBeenCalledWith(CATALOG_PRICE_REFERENCE_KIND, [PRICE_ID])
    expect(fact).toEqual({
      key: LINE_PRICE_FACT_KEYS.matchedPriceRowCurrent.net,
      params: {
        outcome: 'matched_price_row',
        basis: 'net',
        lineAmount: '19.99',
        priceAmount: '19.99',
        currencyCode: 'USD',
        amountSource: 'current',
        at: null,
        priceChangedSince: null,
      },
      confidence: 'inferred',
      reference: { kind: CATALOG_PRICE_REFERENCE_KIND, id: PRICE_ID },
    })
  })

  it('compares with the price amount as of the line write time from the price history (still inferred)', async () => {
    const priceHistory = jest.fn(async (_query: ActionLogFieldHistoryQuery) => historyPage([
      priceEntry({ logId: 'p-2', at: PRICE_UPDATED_AT, actionType: 'update', before: priceState('19.9900'), after: priceState('25.0000') }),
      priceEntry({ logId: 'p-1', at: PRICE_CREATED_AT, actionType: 'create', after: priceState('19.9900') }),
    ]))
    const { context } = buildContext({
      details: [priceDetail({ unitPriceNet: '25.0000', unitPriceGross: '25.0000' })],
      history: [lineCreatedEntry],
      priceHistory,
    })
    const [fact] = await explainLinePrice(context)
    expect(priceHistory).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      organizationIds: [ORG_A],
      resourceKinds: ['catalog.price'],
      resourceId: PRICE_ID,
      before: null,
      limit: PRICE_HISTORY_PAGE_SIZE,
    })
    expect(fact.key).toBe(LINE_PRICE_FACT_KEYS.matchedPriceRow.net)
    expect(fact.confidence).toBe('inferred')
    expect(fact.params).toEqual({
      outcome: 'matched_price_row',
      basis: 'net',
      lineAmount: '19.99',
      priceAmount: '19.99',
      currencyCode: 'USD',
      amountSource: 'history',
      at: LINE_WRITTEN_AT,
      priceChangedSince: true,
    })
  })

  it('reports a manual override after the price was applied as differs (inferred)', async () => {
    const lineUpdatedEntry = orderEntry({
      logId: '77777777-0000-4000-8000-000000000002',
      at: LINE_UPDATED_AT,
      before: [snapshotLine()],
      after: [snapshotLine({ unitPriceNet: '17.5000', unitPriceGross: '17.5000' })],
    })
    const priceHistory = jest.fn(async (_query: ActionLogFieldHistoryQuery) => historyPage([
      priceEntry({ logId: 'p-1', at: PRICE_CREATED_AT, actionType: 'create', after: priceState('19.9900') }),
    ]))
    const { context } = buildContext({
      line: { unitPriceNet: '17.5000', unitPriceGross: '17.5000' },
      history: [lineUpdatedEntry, lineCreatedEntry],
      priceHistory,
    })
    const [fact] = await explainLinePrice(context)
    expect(fact).toEqual({
      key: LINE_PRICE_FACT_KEYS.differs.net,
      params: {
        outcome: 'differs',
        basis: 'net',
        lineAmount: '17.50',
        priceAmount: '19.99',
        currencyCode: 'USD',
        amountSource: 'history',
        at: LINE_UPDATED_AT,
        priceChangedSince: false,
      },
      confidence: 'inferred',
      reference: { kind: CATALOG_PRICE_REFERENCE_KIND, id: PRICE_ID },
    })
  })

  it('falls back to the current amount for differs when the history cannot show the write time', async () => {
    const { context } = buildContext({ line: { unitPriceNet: '17.5000' } })
    const [fact] = await explainLinePrice(context)
    expect(fact.key).toBe(LINE_PRICE_FACT_KEYS.differsCurrent.net)
    expect(fact.params).toMatchObject({ outcome: 'differs', amountSource: 'current', at: null, lineAmount: '17.50', priceAmount: '19.99' })
    expect(fact.confidence).toBe('inferred')
  })

  it.each([
    ['a price row in another organization (filtered by the resolver)', []],
    ['a deleted price row', []],
    ['a detail for a different price', [priceDetail({}, OTHER_PRICE_ID)]],
  ])('is unverifiable without a reference for %s', async (_label, details) => {
    const { context } = buildContext({ details })
    await expect(explainLinePrice(context)).resolves.toEqual([
      {
        key: LINE_PRICE_FACT_KEYS.unverifiable.price_unavailable,
        params: { outcome: 'unverifiable', reason: 'price_unavailable', basis: 'net' },
        confidence: 'unknown',
        reference: null,
      },
    ])
  })

  it('is unverifiable for a malformed price link without resolving it', async () => {
    const { context, resolveReference } = buildContext({ line: { priceId: 'not-a-uuid' } })
    const [fact] = await explainLinePrice(context)
    expect(fact.params).toMatchObject({ outcome: 'unverifiable', reason: 'price_unavailable' })
    expect(resolveReference).not.toHaveBeenCalled()
  })

  it('never compares amounts across currencies', async () => {
    const { context } = buildContext({ details: [priceDetail({ currencyCode: 'EUR' })] })
    await expect(explainLinePrice(context)).resolves.toEqual([
      {
        key: LINE_PRICE_FACT_KEYS.unverifiable.currency_mismatch,
        params: { outcome: 'unverifiable', reason: 'currency_mismatch', basis: 'net', lineCurrency: 'USD', priceCurrency: 'EUR' },
        confidence: 'unknown',
        reference: { kind: CATALOG_PRICE_REFERENCE_KIND, id: PRICE_ID },
      },
    ])
  })

  it('uses the historical currency of the price row when the history shows it', async () => {
    const priceHistory = jest.fn(async (_query: ActionLogFieldHistoryQuery) => historyPage([
      priceEntry({ logId: 'p-1', at: PRICE_CREATED_AT, actionType: 'create', after: priceState('19.9900', '19.9900', 'EUR') }),
    ]))
    const { context } = buildContext({ history: [lineCreatedEntry], priceHistory })
    const [fact] = await explainLinePrice(context)
    expect(fact.params).toMatchObject({ outcome: 'unverifiable', reason: 'currency_mismatch', priceCurrency: 'EUR' })
  })

  it('compares gross amounts when the line price was entered gross, whichever field is explained', async () => {
    const { context } = buildContext({
      line: { priceMode: 'gross', unitPriceNet: '9.0000', unitPriceGross: '12.3000' },
      details: [priceDetail({ unitPriceNet: '10.0000', unitPriceGross: '12.3000' })],
    })
    const [fact] = await explainLinePrice(context)
    expect(fact.params).toMatchObject({ outcome: 'matched_price_row', basis: 'gross', lineAmount: '12.30', priceAmount: '12.30' })
  })

  it('compares net amounts when the line price was entered net', async () => {
    const { context } = buildContext({
      fieldKey: 'unitPriceGross',
      line: { priceMode: 'net', unitPriceNet: '9.0000', unitPriceGross: '12.3000' },
      details: [priceDetail({ unitPriceNet: '10.0000', unitPriceGross: '12.3000' })],
    })
    const [fact] = await explainLinePrice(context)
    expect(fact.params).toMatchObject({ outcome: 'differs', basis: 'net', lineAmount: '9.00', priceAmount: '10.00' })
  })

  it('uses the explained field amount when the line recorded no price mode', async () => {
    const { context } = buildContext({
      fieldKey: 'unitPriceGross',
      line: { priceMode: null, unitPriceNet: '9.0000', unitPriceGross: '12.3000' },
      details: [priceDetail({ unitPriceNet: '10.0000', unitPriceGross: '12.3000' })],
    })
    const [fact] = await explainLinePrice(context)
    expect(fact.params).toMatchObject({ outcome: 'matched_price_row', basis: 'gross' })
  })

  it('is unverifiable when the price row has no amount in the compared basis', async () => {
    const { context } = buildContext({
      line: { priceMode: 'gross' },
      details: [priceDetail({ unitPriceGross: null })],
    })
    const [fact] = await explainLinePrice(context)
    expect(fact).toMatchObject({
      key: LINE_PRICE_FACT_KEYS.unverifiable.price_amount_missing,
      params: { outcome: 'unverifiable', reason: 'price_amount_missing', basis: 'gross' },
      confidence: 'unknown',
    })
  })

  it('is unverifiable when the price row did not exist when the line price was written', async () => {
    const priceHistory = jest.fn(async (_query: ActionLogFieldHistoryQuery) => historyPage([
      priceEntry({ logId: 'p-1', at: PRICE_UPDATED_AT, actionType: 'create', after: priceState('19.9900') }),
    ]))
    const { context } = buildContext({ history: [lineCreatedEntry], priceHistory })
    const [fact] = await explainLinePrice(context)
    expect(fact).toMatchObject({
      key: LINE_PRICE_FACT_KEYS.unverifiable.price_absent_at_write,
      params: { outcome: 'unverifiable', reason: 'price_absent_at_write', at: LINE_WRITTEN_AT },
      confidence: 'unknown',
    })
  })

  it('reads the state before the oldest price change when the whole history is newer than the write', async () => {
    const priceHistory = jest.fn(async (_query: ActionLogFieldHistoryQuery) => historyPage([
      priceEntry({ logId: 'p-2', at: PRICE_UPDATED_AT, actionType: 'update', before: priceState('19.9900'), after: priceState('25.0000') }),
    ]))
    const { context } = buildContext({
      details: [priceDetail({ unitPriceNet: '25.0000' })],
      history: [lineCreatedEntry],
      priceHistory,
    })
    const [fact] = await explainLinePrice(context)
    expect(fact.params).toMatchObject({ outcome: 'matched_price_row', amountSource: 'history', priceAmount: '19.99' })
  })

  it('falls back to the current amount when the price history is longer than the scan window', async () => {
    const newer = Array.from({ length: PRICE_HISTORY_PAGE_SIZE }, (_unused, index) => priceEntry({
      logId: `p-${index}`,
      at: new Date(Date.parse(LINE_UPDATED_AT) + index * 1000).toISOString(),
      actionType: 'update',
      before: priceState('19.9900'),
      after: priceState('19.9900'),
    }))
    const priceHistory = jest.fn(async (_query: ActionLogFieldHistoryQuery) => historyPage(newer, { at: LINE_UPDATED_AT, id: PRICE_ID }))
    const { context } = buildContext({ history: [lineCreatedEntry], priceHistory })
    const [fact] = await explainLinePrice(context)
    expect(priceHistory).toHaveBeenCalledTimes(2)
    expect(fact.params).toMatchObject({ outcome: 'matched_price_row', amountSource: 'current' })
  })

  it('uses the gross fact keys when gross amounts are compared', async () => {
    const { context } = buildContext({
      line: { priceMode: 'gross', unitPriceGross: '12.3000' },
      details: [priceDetail({ unitPriceGross: '12.3000' })],
    })
    const [fact] = await explainLinePrice(context)
    expect(fact.key).toBe(LINE_PRICE_FACT_KEYS.matchedPriceRowCurrent.gross)
  })

  it('does not compare at the time of a redo, which replays an earlier input', async () => {
    const redoEntry = {
      ...orderEntry({ logId: 'o-redo', at: LINE_UPDATED_AT, before: [], after: [snapshotLine()] }),
      historyAction: 'redo',
      causeKind: 'redo' as const,
    }
    const priceHistory = jest.fn(async (_query: ActionLogFieldHistoryQuery) => historyPage([
      priceEntry({ logId: 'p-2', at: PRICE_UPDATED_AT, actionType: 'update', before: priceState('19.9900'), after: priceState('25.0000') }),
    ]))
    const { context } = buildContext({ history: [redoEntry], priceHistory, details: [priceDetail({ unitPriceNet: '25.0000' })] })
    const [fact] = await explainLinePrice(context)
    expect(priceHistory).not.toHaveBeenCalled()
    expect(fact.key).toBe(LINE_PRICE_FACT_KEYS.differsCurrent.net)
    expect(fact.params).toMatchObject({ amountSource: 'current', at: null })
  })

  it('treats a price change too close to the line write as unknown order and compares the current amount', async () => {
    const priceHistory = jest.fn(async (_query: ActionLogFieldHistoryQuery) => historyPage([
      priceEntry({
        logId: 'p-2',
        at: new Date(Date.parse(LINE_WRITTEN_AT) + 3).toISOString(),
        actionType: 'update',
        before: priceState('19.9900'),
        after: priceState('25.0000'),
      }),
      priceEntry({ logId: 'p-1', at: PRICE_CREATED_AT, actionType: 'create', after: priceState('19.9900') }),
    ]))
    const { context } = buildContext({ history: [lineCreatedEntry], priceHistory, details: [priceDetail({ unitPriceNet: '25.0000' })] })
    const [fact] = await explainLinePrice(context)
    expect(fact.params).toMatchObject({ outcome: 'differs', amountSource: 'current', at: null })
  })

  it('returns no fact without resolving the price when the line amount is unreadable', async () => {
    const { context, resolveReference } = buildContext({ line: { unitPriceNet: 'n/a' } })
    await expect(explainLinePrice(context)).resolves.toEqual([])
    expect(resolveReference).not.toHaveBeenCalled()
  })

  it('falls back to the current amount when no history reader is available', async () => {
    const { context } = buildContext({ history: [lineCreatedEntry], priceHistory: null })
    const [fact] = await explainLinePrice(context)
    expect(fact.key).toBe(LINE_PRICE_FACT_KEYS.matchedPriceRowCurrent.net)
  })
})

describe('findLinePriceWriteTime', () => {
  const current = { amount: BigInt(175000), line: { id: LINE_ID, priceId: PRICE_ID } }

  it('finds the newest entry that set the current amount', () => {
    const history = [
      orderEntry({ logId: 'o-2', at: LINE_UPDATED_AT, before: [snapshotLine()], after: [snapshotLine({ unitPriceNet: '17.5' })] }),
      lineCreatedEntry,
    ]
    expect(findLinePriceWriteTime(history, current.line, 'net', current.amount)).toBe(LINE_UPDATED_AT)
  })

  it('skips entries that did not change the line and undone entries with their undo traces', () => {
    const history = [
      orderEntry({ logId: 'o-4', at: '2026-10-08T14:00:00.000Z', before: [snapshotLine({ unitPriceNet: '17.5' })], after: [snapshotLine({ unitPriceNet: '17.5' })] }),
      orderEntry({ logId: 'o-3', at: '2026-10-08T13:00:00.000Z', before: [snapshotLine({ unitPriceNet: '30' })], after: [snapshotLine({ unitPriceNet: '17.5' })], historyAction: 'undo' }),
      orderEntry({ logId: 'o-2', at: '2026-10-08T12:00:00.000Z', before: [snapshotLine({ unitPriceNet: '17.5' })], after: [snapshotLine({ unitPriceNet: '30' })], executionState: 'undone' }),
      orderEntry({ logId: 'o-1', at: LINE_UPDATED_AT, before: [snapshotLine()], after: [snapshotLine({ unitPriceNet: '17.5' })] }),
    ]
    expect(findLinePriceWriteTime(history, current.line, 'net', current.amount)).toBe(LINE_UPDATED_AT)
  })

  it('treats a changed price link as a new write', () => {
    const history = [
      orderEntry({
        logId: 'o-2',
        at: LINE_UPDATED_AT,
        before: [snapshotLine({ unitPriceNet: '17.5', metadata: { priceId: OTHER_PRICE_ID } })],
        after: [snapshotLine({ unitPriceNet: '17.5' })],
      }),
    ]
    expect(findLinePriceWriteTime(history, current.line, 'net', current.amount)).toBe(LINE_UPDATED_AT)
  })

  it('stops at an unrecorded change instead of guessing', () => {
    const history = [
      orderEntry({ logId: 'o-1', at: LINE_UPDATED_AT, before: [], after: [snapshotLine({ unitPriceNet: '30' })] }),
    ]
    expect(findLinePriceWriteTime(history, current.line, 'net', current.amount)).toBeNull()
  })

  it('attributes a line created with the record to the create entry', () => {
    const history = [orderEntry({ logId: 'o-1', at: LINE_WRITTEN_AT, before: null, after: [snapshotLine({ unitPriceNet: 17.5 })] })]
    expect(findLinePriceWriteTime(history, current.line, 'net', current.amount)).toBe(LINE_WRITTEN_AT)
  })
})

describe('sales.line_price fact translations', () => {
  const keys = [
    LINE_PRICE_FACT_KEYS.noCatalogLink,
    ...Object.values(LINE_PRICE_FACT_KEYS.matchedPriceRow),
    ...Object.values(LINE_PRICE_FACT_KEYS.matchedPriceRowCurrent),
    ...Object.values(LINE_PRICE_FACT_KEYS.differs),
    ...Object.values(LINE_PRICE_FACT_KEYS.differsCurrent),
    ...Object.values(LINE_PRICE_FACT_KEYS.unverifiable),
  ]

  it.each(['en', 'pl', 'de', 'es', 'ko'])('declares every fact key in %s', (locale) => {
    const dictionary = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '..', 'i18n', `${locale}.json`), 'utf8'),
    ) as Record<string, string>
    for (const key of keys) expect({ key, present: typeof dictionary[key] === 'string' }).toEqual({ key, present: true })
  })
})
