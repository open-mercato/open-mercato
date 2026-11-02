import { isAiCategorizationEffectiveForTenant } from '../isEffectiveForTenant'

const mockGetStatus = jest.fn()
const mockResolve = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: mockResolve })),
}))

describe('isAiCategorizationEffectiveForTenant', () => {
  beforeEach(() => {
    mockGetStatus.mockReset()
    mockResolve.mockReset()
    mockResolve.mockReturnValue({ getStatus: mockGetStatus })
  })

  it('returns false without a tenant and never reads status', async () => {
    expect(await isAiCategorizationEffectiveForTenant(null)).toBe(false)
    expect(mockGetStatus).not.toHaveBeenCalled()
  })

  it('returns the effective flag for the tenant', async () => {
    mockGetStatus.mockResolvedValueOnce({ effective: true })
    expect(await isAiCategorizationEffectiveForTenant('tenant-1')).toBe(true)
    expect(mockGetStatus).toHaveBeenCalledWith({ tenantId: 'tenant-1' })
    mockGetStatus.mockResolvedValueOnce({ effective: false })
    expect(await isAiCategorizationEffectiveForTenant('tenant-1')).toBe(false)
  })

  it('fails closed when the service cannot be resolved', async () => {
    mockResolve.mockImplementation(() => {
      throw new Error('[internal] not registered')
    })
    expect(await isAiCategorizationEffectiveForTenant('tenant-1')).toBe(false)
  })
})
