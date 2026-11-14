/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react'
import { ForbiddenError } from '@open-mercato/ui/backend/utils/api'
import { useAsnDetailLabelCache } from '../useAsnDetailLabelCache'

const resolveCatalogVariantLabel = jest.fn()
const resolveWarehouseLabel = jest.fn()
const resolveLocationLabel = jest.fn()

jest.mock('../inventoryMutationLoaders', () => ({
  resolveCatalogVariantLabel: (...args: unknown[]) => resolveCatalogVariantLabel(...args),
  resolveWarehouseLabel: (...args: unknown[]) => resolveWarehouseLabel(...args),
  resolveLocationLabel: (...args: unknown[]) => resolveLocationLabel(...args),
}))

const VARIANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('useAsnDetailLabelCache', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveWarehouseLabel.mockResolvedValue(null)
    resolveLocationLabel.mockResolvedValue(null)
    resolveCatalogVariantLabel.mockResolvedValue(null)
  })

  it('looks up a missing variant once when the catalog returns an empty result', async () => {
    const line = { catalog_variant_id: VARIANT_ID, target_staging_location_id: null }
    const { rerender } = renderHook(
      ({ lines }) => useAsnDetailLabelCache({ warehouseId: null, lines }),
      { initialProps: { lines: [line] } },
    )

    await waitFor(() => expect(resolveCatalogVariantLabel).toHaveBeenCalledTimes(1))

    for (let attempt = 0; attempt < 5; attempt += 1) {
      rerender({ lines: [{ ...line }] })
    }

    await waitFor(() => expect(resolveCatalogVariantLabel).toHaveBeenCalledTimes(1))
    expect(resolveCatalogVariantLabel).toHaveBeenCalledWith(VARIANT_ID)
  })

  it('treats a catalog permission error as a resolved miss', async () => {
    resolveCatalogVariantLabel.mockRejectedValue(new ForbiddenError('Forbidden'))
    const line = { catalog_variant_id: VARIANT_ID, target_staging_location_id: null }
    const { result, rerender } = renderHook(
      ({ lines }) => useAsnDetailLabelCache({ warehouseId: null, lines }),
      { initialProps: { lines: [line] } },
    )

    await waitFor(() => expect(resolveCatalogVariantLabel).toHaveBeenCalledTimes(1))
    rerender({ lines: [{ ...line }] })
    await waitFor(() => expect(resolveCatalogVariantLabel).toHaveBeenCalledTimes(1))
    expect(result.current[VARIANT_ID]).toBeUndefined()
  })
})
