import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CatalogPriceHistoryEntry } from '../../data/entities'
import {
  buildHistoryEntry,
  buildPriceHistoryIdempotencyKey,
  capturePriceHistoryEntry,
  priceHistoryInputFromRecord,
  recordPriceHistoryEntry,
  type PriceHistoryPriceInput,
} from '../omnibus'
import type { CatalogProductPrice } from '../../data/entities'

const PRICE: PriceHistoryPriceInput = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  productId: '44444444-4444-4444-8444-444444444444',
  variantId: '55555555-5555-4555-8555-555555555555',
  offerId: null,
  channelId: '66666666-6666-4666-8666-666666666666',
  priceKindId: '77777777-7777-4777-8777-777777777777',
  priceKindCode: 'regular',
  currencyCode: 'EUR',
  unitPriceNet: '81.3000',
  unitPriceGross: '100.0000',
  taxRate: '23.0000',
  taxAmount: '18.7000',
  minQuantity: 1,
  maxQuantity: null,
  startsAt: null,
  endsAt: null,
}

const RECORDED_AT = new Date('2026-06-01T10:15:30.123Z')

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

type FakeHistoryEm = {
  rows: Array<Record<string, unknown>>
  em: EntityManager
  fork: jest.Mock
  flush: jest.Mock
}

function buildFakeEm(flushError?: unknown): FakeHistoryEm {
  const rows: Array<Record<string, unknown>> = []
  const pending: Array<Record<string, unknown>> = []
  const flush = jest.fn(async () => {
    if (flushError) throw flushError
    rows.push(...pending.splice(0))
  })
  const historyEm = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn((row: Record<string, unknown>) => {
      pending.push(row)
    }),
    flush,
  }
  const fork = jest.fn(() => historyEm)
  return { rows, em: { fork } as unknown as EntityManager, fork, flush }
}

describe('buildHistoryEntry', () => {
  it('maps every snapshot field from the price row', () => {
    const entry = buildHistoryEntry(
      { ...PRICE, startsAt: '2026-06-01T00:00:00.000Z', endsAt: new Date('2026-06-30T00:00:00.000Z') },
      'update',
      { recordedAt: RECORDED_AT, metadata: { reason: 'test' } },
    )
    expect(entry).toEqual({
      tenantId: PRICE.tenantId,
      organizationId: PRICE.organizationId,
      priceId: PRICE.id,
      productId: PRICE.productId,
      variantId: PRICE.variantId,
      offerId: null,
      channelId: PRICE.channelId,
      priceKindId: PRICE.priceKindId,
      priceKindCode: 'regular',
      currencyCode: 'EUR',
      unitPriceNet: '81.3000',
      unitPriceGross: '100.0000',
      taxRate: '23.0000',
      taxAmount: '18.7000',
      minQuantity: 1,
      maxQuantity: null,
      startsAt: new Date('2026-06-01T00:00:00.000Z'),
      endsAt: new Date('2026-06-30T00:00:00.000Z'),
      recordedAt: RECORDED_AT,
      changeType: 'update',
      source: 'api',
      isAnnounced: true,
      idempotencyKey: sha256(`${PRICE.id}|update|2026-06-01T10:15:30.123Z`),
      metadata: { reason: 'test' },
    })
    expect(entry.recordedAt).toBeInstanceOf(Date)
    expect(entry.startsAt).toBeInstanceOf(Date)
  })

  it('records recorded_at as an app-set UTC timestamp with millisecond precision', () => {
    const before = Date.now()
    const entry = buildHistoryEntry(PRICE, 'create')
    const after = Date.now()
    expect(entry.recordedAt).toBeInstanceOf(Date)
    expect(entry.recordedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(entry.recordedAt.getTime()).toBeLessThanOrEqual(after)
    expect(entry.recordedAt.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const explicit = buildHistoryEntry(PRICE, 'create', { recordedAt: RECORDED_AT })
    expect(explicit.recordedAt.toISOString()).toBe('2026-06-01T10:15:30.123Z')
    expect(explicit.recordedAt).not.toBe(RECORDED_AT)
  })

  it.each([
    ['starts_at', { startsAt: '2026-06-01T00:00:00.000Z' }, {}, true],
    ['offer_id', { offerId: '88888888-8888-4888-8888-888888888888' }, {}, true],
    ['explicit announce', {}, { announce: true }, true],
    ['starts_at + offer_id + announce', { startsAt: new Date(), offerId: '88888888-8888-4888-8888-888888888888' }, { announce: true }, true],
    ['no signal', {}, {}, false],
    ['announce=false without other signals', {}, { announce: false }, false],
  ])('is_announced for %s', (_label, overrides, options, expected) => {
    const entry = buildHistoryEntry({ ...PRICE, ...overrides }, 'update', { recordedAt: RECORDED_AT, ...options })
    expect(entry.isAnnounced).toBe(expected)
  })

  it('never returns null for is_announced when no signal is present', () => {
    expect(buildHistoryEntry(PRICE, 'create').isAnnounced).toBe(false)
  })

  it('computes the idempotency key as sha256(price_id|change_type|recorded_at ISO)', () => {
    expect(buildPriceHistoryIdempotencyKey(PRICE.id, 'delete', RECORDED_AT)).toBe(
      sha256(`${PRICE.id}|delete|2026-06-01T10:15:30.123Z`),
    )
  })

  it('produces a deterministic key that is independent of the price values', () => {
    const first = buildHistoryEntry(PRICE, 'update', { recordedAt: RECORDED_AT })
    const second = buildHistoryEntry({ ...PRICE, unitPriceGross: '80.0000', unitPriceNet: '65.0400' }, 'update', {
      recordedAt: new Date(RECORDED_AT.getTime()),
    })
    expect(first.idempotencyKey).toBe(second.idempotencyKey)
  })

  it('produces different keys for a later timestamp or a different change type', () => {
    const base = buildHistoryEntry(PRICE, 'update', { recordedAt: RECORDED_AT })
    const later = buildHistoryEntry(PRICE, 'update', { recordedAt: new Date(RECORDED_AT.getTime() + 1) })
    const undo = buildHistoryEntry(PRICE, 'undo', { recordedAt: RECORDED_AT })
    expect(later.idempotencyKey).not.toBe(base.idempotencyKey)
    expect(undo.idempotencyKey).not.toBe(base.idempotencyKey)
  })

  it('leaves the idempotency key null for system rows', () => {
    const entry = buildHistoryEntry(PRICE, 'create', { recordedAt: RECORDED_AT, source: 'system' })
    expect(entry.source).toBe('system')
    expect(entry.idempotencyKey).toBeNull()
  })

  it('throws when the price has no product id', () => {
    expect(() => buildHistoryEntry({ ...PRICE, productId: null }, 'create')).toThrow('[internal]')
  })

  it('throws when the price has no price kind id', () => {
    expect(() => buildHistoryEntry({ ...PRICE, priceKindId: null }, 'create')).toThrow('[internal]')
  })
})

describe('priceHistoryInputFromRecord', () => {
  it('derives product, variant, offer and price kind ids from the price row associations', () => {
    const record = {
      id: PRICE.id,
      tenantId: PRICE.tenantId,
      organizationId: PRICE.organizationId,
      product: null,
      variant: { id: PRICE.variantId, product: { id: PRICE.productId } },
      offer: { id: '88888888-8888-4888-8888-888888888888', product: { id: PRICE.productId } },
      priceKind: { id: PRICE.priceKindId, code: 'promotion' },
      kind: 'regular',
      channelId: PRICE.channelId,
      currencyCode: 'EUR',
      unitPriceNet: '10.0000',
      unitPriceGross: '12.3000',
      taxRate: '23.0000',
      taxAmount: '2.3000',
      minQuantity: 2,
      maxQuantity: 10,
      startsAt: null,
      endsAt: null,
    } as unknown as CatalogProductPrice
    expect(priceHistoryInputFromRecord(record)).toEqual({
      id: PRICE.id,
      tenantId: PRICE.tenantId,
      organizationId: PRICE.organizationId,
      productId: PRICE.productId,
      variantId: PRICE.variantId,
      offerId: '88888888-8888-4888-8888-888888888888',
      channelId: PRICE.channelId,
      priceKindId: PRICE.priceKindId,
      priceKindCode: 'promotion',
      currencyCode: 'EUR',
      unitPriceNet: '10.0000',
      unitPriceGross: '12.3000',
      taxRate: '23.0000',
      taxAmount: '2.3000',
      minQuantity: 2,
      maxQuantity: 10,
      startsAt: null,
      endsAt: null,
    })
  })

  it('falls back to the denormalized kind code when the price kind is an unloaded reference', () => {
    const record = {
      ...PRICE,
      product: PRICE.productId,
      variant: null,
      offer: null,
      priceKind: PRICE.priceKindId,
      kind: 'regular',
    } as unknown as CatalogProductPrice
    const input = priceHistoryInputFromRecord(record)
    expect(input.productId).toBe(PRICE.productId)
    expect(input.priceKindId).toBe(PRICE.priceKindId)
    expect(input.priceKindCode).toBe('regular')
  })
})

describe('recordPriceHistoryEntry', () => {
  it('persists the entry on a forked entity manager', async () => {
    const fake = buildFakeEm()
    const result = await recordPriceHistoryEntry(fake.em, PRICE, 'create', { recordedAt: RECORDED_AT })
    expect(result).toBe('recorded')
    expect(fake.fork).toHaveBeenCalledTimes(1)
    const historyEm = fake.fork.mock.results[0].value as { create: jest.Mock }
    expect(historyEm.create).toHaveBeenCalledWith(CatalogPriceHistoryEntry, expect.objectContaining({ priceId: PRICE.id }))
    expect(fake.rows).toHaveLength(1)
    expect(fake.rows[0]).toMatchObject({ changeType: 'create', recordedAt: RECORDED_AT, isAnnounced: false })
  })

  it('treats an idempotency-key unique violation as an idempotent success', async () => {
    const violation = Object.assign(new Error('duplicate key value violates unique constraint "catalog_price_history_idempotency_uq"'), {
      code: '23505',
      constraint: 'catalog_price_history_idempotency_uq',
    })
    const fake = buildFakeEm(violation)
    await expect(recordPriceHistoryEntry(fake.em, PRICE, 'update', { recordedAt: RECORDED_AT })).resolves.toBe('duplicate')
  })

  it('rethrows other database errors', async () => {
    const fake = buildFakeEm(new Error('connection refused'))
    await expect(recordPriceHistoryEntry(fake.em, PRICE, 'update')).rejects.toThrow('connection refused')
  })
})

describe('capturePriceHistoryEntry', () => {
  let reportError: jest.Mock
  let unregister: () => void

  beforeEach(() => {
    reportError = jest.fn()
    unregister = registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
  })

  afterEach(() => {
    unregister()
  })

  it('swallows recording failures and reports them', async () => {
    const failure = new Error('database down')
    const fake = buildFakeEm(failure)
    await expect(capturePriceHistoryEntry(fake.em, PRICE, 'delete')).resolves.toBeNull()
    expect(reportError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ module: 'catalog', code: 'catalog.price_history_capture_failed' }),
    )
  })

  it('swallows build failures for prices without a product', async () => {
    const fake = buildFakeEm()
    await expect(capturePriceHistoryEntry(fake.em, { ...PRICE, productId: null }, 'create')).resolves.toBeNull()
    expect(fake.rows).toHaveLength(0)
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for a missing price', async () => {
    const fake = buildFakeEm()
    await expect(capturePriceHistoryEntry(fake.em, null, 'undo')).resolves.toBeNull()
    expect(fake.fork).not.toHaveBeenCalled()
  })

  it('returns the recording result on success', async () => {
    const fake = buildFakeEm()
    await expect(capturePriceHistoryEntry(fake.em, PRICE, 'undo')).resolves.toBe('recorded')
    expect(fake.rows[0]).toMatchObject({ changeType: 'undo' })
    expect(reportError).not.toHaveBeenCalled()
  })
})
