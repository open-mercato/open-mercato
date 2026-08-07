import { createHash } from 'crypto'
import {
  buildHistoryEntry,
  buildOmnibusCacheTags,
  computeIdempotencyKey,
  invalidateOmnibusCache,
} from '../omnibus'
import type { PriceHistorySnapshot } from '../omnibusTypes'

function snapshot(overrides: Partial<PriceHistorySnapshot> = {}): PriceHistorySnapshot {
  return {
    id: 'price-1',
    productId: 'product-1',
    variantId: null,
    offerId: null,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    currencyCode: 'PLN',
    priceKindId: 'kind-1',
    priceKindCode: 'regular',
    minQuantity: 1,
    maxQuantity: null,
    unitPriceNet: '81.3008',
    unitPriceGross: '100.0000',
    taxRate: '23.0000',
    taxAmount: '18.6992',
    channelId: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  }
}

describe('buildHistoryEntry', () => {
  it('maps every snapshot field onto the history entry', () => {
    const recordedAt = new Date('2026-06-01T08:30:00.123Z')
    const entry = buildHistoryEntry({
      snapshot: snapshot({ variantId: 'variant-1', offerId: 'offer-1', channelId: 'channel-1' }),
      changeType: 'update',
      source: 'api',
      recordedAt,
    })

    expect(entry).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      priceId: 'price-1',
      productId: 'product-1',
      variantId: 'variant-1',
      offerId: 'offer-1',
      channelId: 'channel-1',
      priceKindId: 'kind-1',
      priceKindCode: 'regular',
      currencyCode: 'PLN',
      unitPriceNet: '81.3008',
      unitPriceGross: '100.0000',
      taxRate: '23.0000',
      taxAmount: '18.6992',
      minQuantity: 1,
      maxQuantity: null,
      changeType: 'update',
      source: 'api',
    })
    expect(entry.recordedAt).toBeInstanceOf(Date)
    expect(entry.recordedAt.toISOString()).toBe('2026-06-01T08:30:00.123Z')
  })

  it('converts snapshot date strings into Date instances', () => {
    const entry = buildHistoryEntry({
      snapshot: snapshot({ startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-30T00:00:00.000Z' }),
      changeType: 'create',
      source: 'api',
    })
    expect(entry.startsAt).toBeInstanceOf(Date)
    expect(entry.endsAt).toBeInstanceOf(Date)
  })

  it('throws when the snapshot has no product id', () => {
    expect(() =>
      buildHistoryEntry({ snapshot: snapshot({ productId: null }), changeType: 'create', source: 'api' }),
    ).toThrow(/productId/)
  })

  describe('isAnnounced', () => {
    it('is true when the price has a validity start', () => {
      const entry = buildHistoryEntry({
        snapshot: snapshot({ startsAt: '2026-06-01T00:00:00.000Z' }),
        changeType: 'update',
        source: 'api',
      })
      expect(entry.isAnnounced).toBe(true)
    })

    it('is true when the price belongs to an offer', () => {
      const entry = buildHistoryEntry({
        snapshot: snapshot({ offerId: 'offer-1' }),
        changeType: 'update',
        source: 'api',
      })
      expect(entry.isAnnounced).toBe(true)
    })

    it('is true when the caller explicitly announces the change', () => {
      const entry = buildHistoryEntry({ snapshot: snapshot(), changeType: 'update', source: 'api', announce: true })
      expect(entry.isAnnounced).toBe(true)
    })

    // A silent repricing (including a tax-only change) must never look like an announcement:
    // Art. 6a applies to announced reductions only.
    it('is false — never null — when no announcement signal is present', () => {
      const entry = buildHistoryEntry({ snapshot: snapshot(), changeType: 'update', source: 'api' })
      expect(entry.isAnnounced).toBe(false)
    })
  })
})

describe('computeIdempotencyKey', () => {
  it('matches sha256(price_id|change_type|recorded_at.toISOString())', () => {
    const recordedAt = new Date('2026-06-01T08:30:00.123Z')
    const expected = createHash('sha256')
      .update(['price-1', 'update', '2026-06-01T08:30:00.123Z'].join('|'))
      .digest('hex')
    expect(computeIdempotencyKey('price-1', 'update', recordedAt)).toBe(expected)
  })

  it('is stable for a retry of the same write', () => {
    const recordedAt = new Date('2026-06-01T08:30:00.123Z')
    expect(computeIdempotencyKey('price-1', 'update', recordedAt)).toBe(
      computeIdempotencyKey('price-1', 'update', recordedAt),
    )
  })

  it('differs across prices recorded at the same instant', () => {
    const recordedAt = new Date('2026-06-01T08:30:00.123Z')
    expect(computeIdempotencyKey('price-1', 'update', recordedAt)).not.toBe(
      computeIdempotencyKey('price-2', 'update', recordedAt),
    )
  })

  // A recurring sale that returns a price to a previously-seen value must still be recorded.
  // A content-based key would collide here and silently drop the row from the legal log.
  it('differs for the same price at a later instant, even with identical price values', () => {
    expect(computeIdempotencyKey('price-1', 'update', new Date('2026-06-01T08:30:00.123Z'))).not.toBe(
      computeIdempotencyKey('price-1', 'update', new Date('2026-06-01T08:30:00.124Z')),
    )
  })

  it('differs across change types at the same instant', () => {
    const recordedAt = new Date('2026-06-01T08:30:00.123Z')
    expect(computeIdempotencyKey('price-1', 'update', recordedAt)).not.toBe(
      computeIdempotencyKey('price-1', 'undo', recordedAt),
    )
  })
})

describe('buildOmnibusCacheTags', () => {
  it('emits a tenant/org tag plus product and variant tags', () => {
    expect(
      buildOmnibusCacheTags({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        productId: 'product-1',
        variantId: 'variant-1',
      }),
    ).toEqual([
      'omnibus:tenant-1:org-1',
      'omnibus:tenant-1:org-1:product:product-1',
      'omnibus:tenant-1:org-1:variant:variant-1',
    ])
  })

  it('omits scope tags that are absent', () => {
    expect(buildOmnibusCacheTags({ tenantId: 'tenant-1', organizationId: 'org-1' })).toEqual([
      'omnibus:tenant-1:org-1',
    ])
  })
})

describe('invalidateOmnibusCache', () => {
  it('deletes the scoped tags a price write can affect', async () => {
    const cache = { deleteByTags: jest.fn().mockResolvedValue(2) }
    await invalidateOmnibusCache(cache, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productId: 'product-1',
      variantId: 'variant-1',
    })
    expect(cache.deleteByTags).toHaveBeenCalledWith([
      'omnibus:tenant-1:org-1:product:product-1',
      'omnibus:tenant-1:org-1:variant:variant-1',
    ])
  })

  it('does nothing when there is no scope to invalidate', async () => {
    const cache = { deleteByTags: jest.fn() }
    await invalidateOmnibusCache(cache, { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(cache.deleteByTags).not.toHaveBeenCalled()
  })

  it('tolerates an absent cache', async () => {
    await expect(
      invalidateOmnibusCache(null, { tenantId: 'tenant-1', organizationId: 'org-1', productId: 'product-1' }),
    ).resolves.toBeUndefined()
  })
})

// Compliance case C2, capture half. A VAT reclassification moves the gross the
// customer sees without any reduction being announced, so the entry it produces
// must not look like a promotion to the resolver.
describe('buildHistoryEntry — tax-only change (C2)', () => {
  it('records a VAT reclassification as not announced', () => {
    const entry = buildHistoryEntry({
      snapshot: snapshot({
        // Same net, new rate: gross moves because the tax band changed, not
        // because anyone cut the price.
        unitPriceNet: '81.3008',
        taxRate: '8.0000',
        taxAmount: '6.5041',
        unitPriceGross: '87.8049',
        startsAt: null,
        offerId: null,
      }),
      changeType: 'update',
      source: 'api',
      recordedAt: new Date('2026-06-01T08:30:00.123Z'),
    })

    expect(entry.isAnnounced).toBe(false)
    expect(entry.startsAt).toBeNull()
    expect(entry.offerId).toBeNull()
    // The rate still has to be captured — it is what proves the gross moved for
    // tax reasons rather than commercial ones.
    expect(entry.taxRate).toBe('8.0000')
    expect(entry.unitPriceGross).toBe('87.8049')
  })
})
