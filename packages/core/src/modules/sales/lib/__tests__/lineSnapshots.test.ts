/** @jest-environment node */

/**
 * The § 3 producer invariant from
 * `.ai/specs/2026-08-07-sales-line-discount-amount-contract.md` (acceptance
 * criterion 9), plus the per-operand split the upsert paths depend on.
 *
 * Two fields describe a line discount's origin and they mean different things:
 * `discountAmountBasis` is a *caller* assertion, `discountAmountFromStoredRow`
 * says the value was rebuilt from a persisted row. Keeping them separable is
 * what lets the engine tell "someone told us how to read this" from "we read
 * this back out of the database" — and it is the property that keeps the spec's
 * § Alternatives E adoptable later without a type change. If a mapper ever
 * starts setting a basis, a stored line total begins outranking
 * `discount_percent` on every recalculation, and the self-healing behaviour
 * disappears in a way the arithmetic tests cannot detect.
 */

import {
  mapOrderLineEntityToSnapshot,
  mapQuoteLineEntityToSnapshot,
  resolveUpsertDiscountFields,
} from '../lineSnapshots'
import type { SalesOrderLine, SalesQuoteLine } from '../../data/entities'
import { orderLineCreateSchema, quoteLineCreateSchema } from '../../data/validators'

function persistedLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    lineNumber: 1,
    kind: 'product',
    productId: null,
    productVariantId: null,
    name: 'Widget',
    description: null,
    comment: null,
    quantity: '3',
    quantityUnit: null,
    normalizedQuantity: null,
    normalizedUnit: null,
    uomSnapshot: null,
    currencyCode: 'USD',
    unitPriceNet: '85',
    unitPriceGross: '85',
    discountAmount: '12.75',
    discountPercent: '5',
    taxRate: '0',
    taxAmount: null,
    totalNetAmount: '242.25',
    totalGrossAmount: '242.25',
    configuration: null,
    promotionCode: null,
    metadata: null,
    customFieldSetId: null,
    ...overrides,
  }
}

describe('entity-to-snapshot mappers', () => {
  it.each([
    ['order', mapOrderLineEntityToSnapshot],
    ['quote', mapQuoteLineEntityToSnapshot],
  ])('marks a rebuilt %s line as stored-row sourced and never asserts a basis', (_kind, map) => {
    const snapshot = (map as (line: never) => ReturnType<typeof mapOrderLineEntityToSnapshot>)(
      persistedLine() as never,
    )

    expect(snapshot.discountAmountFromStoredRow).toBe(true)
    expect(snapshot.discountAmountBasis).toBeUndefined()
  })

  it('coerces the numeric-string column shape the database returns', () => {
    const snapshot = mapOrderLineEntityToSnapshot(persistedLine() as unknown as SalesOrderLine)

    expect(snapshot.discountAmount).toBe(12.75)
    expect(snapshot.quantity).toBe(3)
    expect(snapshot.unitPriceNet).toBe(85)
  })

  it('coerces a non-finite stored value to zero rather than propagating NaN', () => {
    const snapshot = mapQuoteLineEntityToSnapshot(
      persistedLine({ discountAmount: 'not-a-number' }) as unknown as SalesQuoteLine,
    )

    expect(snapshot.discountAmount).toBe(0)
  })
})

describe('resolveUpsertDiscountFields', () => {
  it('treats a caller-supplied amount as a caller assertion, defaulting to the unit basis', () => {
    const fields = resolveUpsertDiscountFields(5, undefined, { discountAmount: 99 })

    expect(fields).toEqual({ discountAmount: 5, discountAmountBasis: 'unit' })
    expect(fields.discountAmountFromStoredRow).toBeUndefined()
  })

  it('honours an explicit caller basis', () => {
    expect(resolveUpsertDiscountFields(5, 'line', null)).toEqual({
      discountAmount: 5,
      discountAmountBasis: 'line',
    })
  })

  it('treats an explicit caller zero as supplied, not as absent', () => {
    // The engine decides what a zero means; this layer only has to preserve the
    // fact that the caller sent one rather than collapsing it into the stored
    // value.
    expect(resolveUpsertDiscountFields(0, undefined, { discountAmount: 99 })).toEqual({
      discountAmount: 0,
      discountAmountBasis: 'unit',
    })
  })

  it('falls back to the stored amount as a line total when the caller sends nothing', () => {
    const fields = resolveUpsertDiscountFields(undefined, undefined, { discountAmount: 12.75 })

    expect(fields).toEqual({ discountAmount: 12.75, discountAmountFromStoredRow: true })
    expect(fields.discountAmountBasis).toBeUndefined()
  })

  it('yields a null amount rather than zero when there is neither a caller value nor a row', () => {
    // `?? 0` here would erase the difference between "explicitly zero" and
    // "not supplied" before the engine ever sees it.
    expect(resolveUpsertDiscountFields(undefined, undefined, null)).toEqual({
      discountAmount: null,
      discountAmountFromStoredRow: false,
    })
  })

  it('never sets both origin fields at once', () => {
    const cases = [
      resolveUpsertDiscountFields(5, 'line', { discountAmount: 99 }),
      resolveUpsertDiscountFields(undefined, undefined, { discountAmount: 99 }),
      resolveUpsertDiscountFields(null, undefined, null),
    ]

    for (const fields of cases) {
      const hasBasis = fields.discountAmountBasis !== undefined
      const hasOrigin = fields.discountAmountFromStoredRow !== undefined
      expect(hasBasis && hasOrigin).toBe(false)
    }
  })
})

describe('request schemas (§ 3 invariant, acceptance criterion 9)', () => {
  const baseLine = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    kind: 'product' as const,
    currencyCode: 'USD',
    quantity: 3,
    unitPriceNet: 85,
  }

  it.each([
    ['order line', orderLineCreateSchema, { orderId: '33333333-3333-4333-8333-333333333333' }],
    ['quote line', quoteLineCreateSchema, { quoteId: '44444444-4444-4444-8444-444444444444' }],
  ])('never lets a %s request populate the mapper-only origin flag', (_label, schema, ref) => {
    const parsed = (schema as typeof orderLineCreateSchema).parse({
      ...baseLine,
      ...ref,
      discountAmount: 5,
      discountAmountFromStoredRow: true,
    })

    // A caller that tries to assert the mapper-only flag must not be able to
    // make the engine read its per-unit amount as a line total.
    expect('discountAmountFromStoredRow' in parsed).toBe(false)
  })

  it.each([
    ['order line', orderLineCreateSchema, { orderId: '33333333-3333-4333-8333-333333333333' }],
    ['quote line', quoteLineCreateSchema, { quoteId: '44444444-4444-4444-8444-444444444444' }],
  ])('accepts the caller-facing basis on a %s request', (_label, schema, ref) => {
    const parsed = (schema as typeof orderLineCreateSchema).parse({
      ...baseLine,
      ...ref,
      discountAmount: 5,
      discountAmountBasis: 'line',
    })

    expect(parsed.discountAmountBasis).toBe('line')
  })

  it.each([
    ['order line', orderLineCreateSchema, { orderId: '33333333-3333-4333-8333-333333333333' }],
    ['quote line', quoteLineCreateSchema, { quoteId: '44444444-4444-4444-8444-444444444444' }],
  ])('leaves the basis absent on a %s request that omits it, preserving the documented default', (_label, schema, ref) => {
    const parsed = (schema as typeof orderLineCreateSchema).parse({
      ...baseLine,
      ...ref,
      discountAmount: 5,
    })

    expect(parsed.discountAmountBasis).toBeUndefined()
  })

  it('rejects a basis value outside the documented enum', () => {
    expect(() =>
      orderLineCreateSchema.parse({
        ...baseLine,
        orderId: '33333333-3333-4333-8333-333333333333',
        discountAmount: 5,
        discountAmountBasis: 'per-unit',
      }),
    ).toThrow()
  })
})
