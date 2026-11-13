const latestIdsMock = jest.fn()
const findWithDecryptionMock = jest.fn()

jest.mock('../omnibusHistoryQueries', () => ({
  fetchOmnibusLatestPriceEntryIds: (...args: unknown[]) => latestIdsMock(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { isPromotionPriceKind, resolveOmnibusPresentedEntries } from '../omnibusPresentedEntry'
import type { PriceRow } from '../pricing'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const em = {} as EntityManager

function makePrice(id: string, overrides: Record<string, unknown> = {}): PriceRow {
  return {
    id,
    tenantId,
    organizationId,
    startsAt: null,
    offer: null,
    priceKind: { id: 'kind', isPromotion: false },
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-02T00:00:00.000Z'),
    ...overrides,
  } as unknown as PriceRow
}

describe('resolveOmnibusPresentedEntries', () => {
  beforeEach(() => {
    latestIdsMock.mockReset()
    findWithDecryptionMock.mockReset()
  })

  it('maps each price to its latest history entry with tenant and organization scoping', async () => {
    latestIdsMock.mockResolvedValue(['hist-1'])
    const recordedAt = new Date('2026-06-01T08:30:00.000Z')
    const startsAt = new Date('2026-06-01T00:00:00.000Z')
    findWithDecryptionMock.mockResolvedValue([
      { id: 'hist-1', priceId: 'price-1', changeType: 'update', recordedAt, startsAt, offerId: null, isAnnounced: true },
    ])

    const entries = await resolveOmnibusPresentedEntries(em, [makePrice('price-1'), makePrice('price-1')])

    expect(latestIdsMock).toHaveBeenCalledWith(em, [{ tenantId, organizationId, priceId: 'price-1' }])
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({ id: { $in: ['hist-1'] }, tenantId, organizationId })
    expect(entries.get('price-1')).toEqual({
      priceId: 'price-1',
      changeType: 'update',
      recordedAt,
      startsAt,
      offerId: null,
      isAnnounced: true,
    })
  })

  it('falls back to the price row when no history entry exists', async () => {
    latestIdsMock.mockResolvedValue([null])
    const startsAt = new Date('2026-06-01T00:00:00.000Z')

    const entries = await resolveOmnibusPresentedEntries(em, [makePrice('price-1', { startsAt, offer: 'offer-1' })])

    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(entries.get('price-1')).toEqual({
      priceId: 'price-1',
      changeType: 'update',
      recordedAt: new Date('2026-05-02T00:00:00.000Z'),
      startsAt,
      offerId: 'offer-1',
      isAnnounced: null,
    })
  })

  it('returns an empty map without querying when there are no prices', async () => {
    const entries = await resolveOmnibusPresentedEntries(em, [])
    expect(entries.size).toBe(0)
    expect(latestIdsMock).not.toHaveBeenCalled()
  })
})

describe('isPromotionPriceKind', () => {
  it('reads the populated price kind flag', () => {
    expect(isPromotionPriceKind(makePrice('p', { priceKind: { id: 'k', isPromotion: true } }))).toBe(true)
    expect(isPromotionPriceKind(makePrice('p', { priceKind: 'k' }))).toBe(false)
    expect(isPromotionPriceKind(null)).toBe(false)
  })
})
