jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  BalanceLookupError,
  fetchBalanceAvailable,
  fetchBalanceOnHand,
  loadLotOptionsForBalanceLocation,
} from '../inventoryMutationLoaders'

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

describe('fetchBalanceOnHand', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('returns the on-hand quantity when a single balance row matches', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: { items: [{ lot_id: null, quantity_on_hand: 12 }] },
    } as any)

    const onHand = await fetchBalanceOnHand({
      warehouseId: 'wh-1',
      locationId: 'loc-1',
      catalogVariantId: 'variant-1',
    })

    expect(onHand).toBe(12)
  })

  it('resolves the row matching the given lotId when multiple lots exist at the location', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        items: [
          { lot_id: 'lot-a', quantity_on_hand: 5 },
          { lot_id: 'lot-b', quantity_on_hand: 9 },
        ],
      },
    } as any)

    const onHand = await fetchBalanceOnHand({
      warehouseId: 'wh-1',
      locationId: 'loc-1',
      catalogVariantId: 'variant-1',
      lotId: 'lot-b',
    })

    expect(onHand).toBe(9)
  })

  it('throws a LOT_REQUIRED BalanceLookupError when multiple lot-bearing rows match and no lot is specified', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        items: [
          { lot_id: 'lot-a', quantity_on_hand: 5 },
          { lot_id: 'lot-b', quantity_on_hand: 9 },
        ],
      },
    } as any)

    await expect(
      fetchBalanceOnHand({
        warehouseId: 'wh-1',
        locationId: 'loc-1',
        catalogVariantId: 'variant-1',
        lotId: null,
      }),
    ).rejects.toMatchObject({
      name: 'BalanceLookupError',
      code: 'LOT_REQUIRED',
      candidateLotIds: ['lot-a', 'lot-b'],
    })
  })

  it('throws a LOT_NOT_FOUND BalanceLookupError when the requested lot has no matching row', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        items: [
          { lot_id: 'lot-a', quantity_on_hand: 5 },
          { lot_id: 'lot-b', quantity_on_hand: 9 },
        ],
      },
    } as any)

    await expect(
      fetchBalanceOnHand({
        warehouseId: 'wh-1',
        locationId: 'loc-1',
        catalogVariantId: 'variant-1',
        lotId: 'lot-c',
      }),
    ).rejects.toMatchObject({
      name: 'BalanceLookupError',
      code: 'LOT_NOT_FOUND',
    })
  })

  it('throws a default LOOKUP_FAILED BalanceLookupError when the API call fails', async () => {
    mockApiCall.mockResolvedValue({ ok: false } as any)

    const error = await fetchBalanceOnHand({
      warehouseId: 'wh-1',
      locationId: 'loc-1',
      catalogVariantId: 'variant-1',
    }).catch((err) => err)

    expect(error).toBeInstanceOf(BalanceLookupError)
    expect(error.code).toBe('LOOKUP_FAILED')
  })
})

describe('fetchBalanceAvailable', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('throws a LOT_REQUIRED BalanceLookupError when multiple lot-bearing rows match and no lot is specified', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        items: [
          { lot_id: 'lot-a', quantity_available: 3 },
          { lot_id: 'lot-b', quantity_available: 4 },
        ],
      },
    } as any)

    await expect(
      fetchBalanceAvailable({
        warehouseId: 'wh-1',
        locationId: 'loc-1',
        catalogVariantId: 'variant-1',
      }),
    ).rejects.toMatchObject({
      name: 'BalanceLookupError',
      code: 'LOT_REQUIRED',
    })
  })
})

describe('loadLotOptionsForBalanceLocation', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('resolves only the lot options actually present at the given location', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/wms/inventory/balances')) {
        return {
          ok: true,
          result: {
            items: [
              { lot_id: 'lot-a', quantity_on_hand: 5 },
              { lot_id: 'lot-b', quantity_on_hand: 9 },
            ],
          },
        } as any
      }
      if (url.startsWith('/api/wms/lots')) {
        return {
          ok: true,
          result: {
            items: [
              { id: 'lot-a', lot_number: 'LOT-A' },
              { id: 'lot-b', lot_number: 'LOT-B' },
            ],
          },
        } as any
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const options = await loadLotOptionsForBalanceLocation({
      warehouseId: 'wh-1',
      locationId: 'loc-1',
      catalogVariantId: 'variant-1',
    })

    expect(options).toEqual([
      { value: 'lot-a', label: 'LOT-A' },
      { value: 'lot-b', label: 'LOT-B' },
    ])
  })

  it('filters resolved options by the search query', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/wms/inventory/balances')) {
        return {
          ok: true,
          result: {
            items: [
              { lot_id: 'lot-a', quantity_on_hand: 5 },
              { lot_id: 'lot-b', quantity_on_hand: 9 },
            ],
          },
        } as any
      }
      return {
        ok: true,
        result: {
          items: [
            { id: 'lot-a', lot_number: 'LOT-A' },
            { id: 'lot-b', lot_number: 'LOT-B' },
          ],
        },
      } as any
    })

    const options = await loadLotOptionsForBalanceLocation({
      warehouseId: 'wh-1',
      locationId: 'loc-1',
      catalogVariantId: 'variant-1',
      query: 'lot-b',
    })

    expect(options).toEqual([{ value: 'lot-b', label: 'LOT-B' }])
  })

  it('returns no options when the location has no lot-bearing balances', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: { items: [{ lot_id: null, quantity_on_hand: 12 }] },
    } as any)

    const options = await loadLotOptionsForBalanceLocation({
      warehouseId: 'wh-1',
      locationId: 'loc-1',
      catalogVariantId: 'variant-1',
    })

    expect(options).toEqual([])
  })

  it('returns no options when a required scope field is missing', async () => {
    const options = await loadLotOptionsForBalanceLocation({
      warehouseId: '',
      locationId: 'loc-1',
      catalogVariantId: 'variant-1',
    })

    expect(options).toEqual([])
    expect(mockApiCall).not.toHaveBeenCalled()
  })
})
