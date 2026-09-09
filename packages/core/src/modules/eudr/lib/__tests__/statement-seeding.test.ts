import {
  buildDuplicateSeed,
  pickUnambiguousCommodity,
  resolveSeedingParams,
} from '../statement-seeding'

const DUPLICATE_ID = '11111111-1111-4111-8111-111111111111'
const ORDER_ID = '22222222-2222-4222-8222-222222222222'

function searchParams(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name] ?? null
    },
  }
}

describe('resolveSeedingParams', () => {
  it('gives a valid duplicate source precedence and signals an ignored valid order', () => {
    expect(resolveSeedingParams(searchParams({
      duplicateFrom: DUPLICATE_ID,
      orderId: ORDER_ID,
    }))).toEqual({
      mode: 'duplicate',
      id: DUPLICATE_ID,
      ignoredOrder: true,
    })
  })

  it('treats invalid UUID parameters as absent', () => {
    expect(resolveSeedingParams(searchParams({
      duplicateFrom: 'not-a-uuid',
      orderId: 'also-not-a-uuid',
    }))).toEqual({ mode: 'none' })
  })
})

describe('buildDuplicateSeed', () => {
  it('copies exactly the allowed structural fields', () => {
    const source = {
      id: DUPLICATE_ID,
      title: 'Monthly cocoa DDS',
      commodity: 'cocoa',
      activityType: 'import',
      actorRole: 'operator',
      orderId: ORDER_ID,
      orderSnapshot: { orderNumber: 'ORD-2026-0042' },
      quantityKg: '125.500',
      supplementaryUnit: 'bags',
      supplementaryQuantity: '10',
      notes: 'Repeat shipment',
      status: 'available',
      referenceNumber: 'DDS-REF-42',
      verificationNumber: 'VERIFY-42',
      referencedStatements: [{ referenceNumber: 'UPSTREAM-1' }],
      submittedAt: '2026-07-20T10:00:00.000Z',
      referenceIssuedAt: '2026-07-21T10:00:00.000Z',
      latestRisk: { conclusion: 'negligible' },
      createdAt: '2026-07-19T10:00:00.000Z',
      updatedAt: '2026-07-21T10:00:00.000Z',
    }

    const seed = buildDuplicateSeed(source)

    expect(seed).toEqual({
      title: 'Monthly cocoa DDS',
      commodity: 'cocoa',
      activityType: 'import',
      actorRole: 'operator',
      orderId: ORDER_ID,
      quantityKg: '125.500',
      supplementaryUnit: 'bags',
      supplementaryQuantity: '10',
      notes: 'Repeat shipment',
    })
    for (const forbiddenKey of [
      'status',
      'referenceNumber',
      'verificationNumber',
      'referencedStatements',
      'submittedAt',
      'referenceIssuedAt',
    ]) {
      expect(seed).not.toHaveProperty(forbiddenKey)
    }
  })
})

describe('pickUnambiguousCommodity', () => {
  it('returns the sole distinct in-scope commodity', () => {
    expect(pickUnambiguousCommodity([
      { commodity: 'wood', isInScope: true },
      { commodity: 'wood', isInScope: true },
    ])).toBe('wood')
  })

  it('returns null for two distinct in-scope commodities', () => {
    expect(pickUnambiguousCommodity([
      { commodity: 'wood', isInScope: true },
      { commodity: 'cocoa', isInScope: true },
    ])).toBeNull()
  })

  it('ignores out-of-scope mappings', () => {
    expect(pickUnambiguousCommodity([
      { commodity: 'wood', isInScope: true },
      { commodity: 'cocoa', isInScope: false },
    ])).toBe('wood')
  })

  it('returns null for an empty mapping set', () => {
    expect(pickUnambiguousCommodity([])).toBeNull()
  })
})
