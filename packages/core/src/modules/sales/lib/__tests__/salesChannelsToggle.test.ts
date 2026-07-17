const mockGetBoolConfig = jest.fn()
const mockResolve = jest.fn()
const mockCreateRequestContainer = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

import { isSalesChannelsEnabledForTenant, SALES_CHANNELS_TOGGLE_ID } from '../salesChannelsToggle'

describe('isSalesChannelsEnabledForTenant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateRequestContainer.mockResolvedValue({ resolve: mockResolve })
    mockResolve.mockReturnValue({ getBoolConfig: mockGetBoolConfig })
  })

  it('disables channels only when the toggle explicitly resolves to false', async () => {
    mockGetBoolConfig.mockResolvedValue({ ok: true, value: false })
    await expect(isSalesChannelsEnabledForTenant('tenant-1')).resolves.toBe(false)
    expect(mockGetBoolConfig).toHaveBeenCalledWith(SALES_CHANNELS_TOGGLE_ID, 'tenant-1')
  })

  it('keeps channels enabled when the toggle resolves to true', async () => {
    mockGetBoolConfig.mockResolvedValue({ ok: true, value: true })
    await expect(isSalesChannelsEnabledForTenant('tenant-1')).resolves.toBe(true)
  })

  it('fails open when the toggle definition is missing', async () => {
    mockGetBoolConfig.mockResolvedValue({ ok: false, error: { code: 'MISSING_TOGGLE' } })
    await expect(isSalesChannelsEnabledForTenant('tenant-1')).resolves.toBe(true)
  })

  it('fails open when the feature toggles service is absent', async () => {
    mockResolve.mockImplementation(() => {
      throw new Error('unknown registration: featureTogglesService')
    })
    await expect(isSalesChannelsEnabledForTenant('tenant-1')).resolves.toBe(true)
  })

  it('fails open without a tenant context and skips the container entirely', async () => {
    await expect(isSalesChannelsEnabledForTenant(null)).resolves.toBe(true)
    await expect(isSalesChannelsEnabledForTenant(undefined)).resolves.toBe(true)
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })
})
