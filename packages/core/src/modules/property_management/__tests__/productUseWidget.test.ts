/** @jest-environment node */
const mockApiCall = jest.fn()
const mockFlash = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => mockApiCall(...args) }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))

import widget from '../widgets/injection/catalog-product-use/widget'

const PRODUCT = '50000000-0000-4000-8000-000000000001'
const context = { resourceId: PRODUCT, t: (key: string) => key }
const changedToBookable = { 'property_management.use': 'bookable', 'property_management.billingUnit': 'day', _property_management: { use: null, billingUnit: null } }

function storedUse(item: Record<string, unknown> | null) {
  mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { items: item ? [item] : [] } })
}

describe('catalog product-use widget after save', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockFlash.mockReset()
  })

  it('warns when the space use did not reach the product', async () => {
    storedUse(null)
    await widget.eventHandlers?.onAfterSave?.(changedToBookable, context)
    expect(mockApiCall).toHaveBeenCalledWith(expect.stringContaining(`productIds=${PRODUCT}`), undefined, { fallback: {} })
    expect(mockFlash).toHaveBeenCalledWith('property_management.errors.productUseSyncFailed', 'warning')
  })

  it('stays quiet when the use was saved, nothing changed, or the check itself failed', async () => {
    storedUse({ catalogProductId: PRODUCT, use: 'bookable', billingUnit: 'day' })
    await widget.eventHandlers?.onAfterSave?.(changedToBookable, context)

    await widget.eventHandlers?.onAfterSave?.({ 'property_management.use': 'none', _property_management: { use: null } }, context)

    mockApiCall.mockResolvedValue({ ok: false, status: 500, result: {} })
    await widget.eventHandlers?.onAfterSave?.(changedToBookable, context)

    expect(mockFlash).not.toHaveBeenCalled()
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })
})
