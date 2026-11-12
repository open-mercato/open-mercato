import type { EntityManager } from '@mikro-orm/postgresql'

const mockReportError = jest.fn()
const mockTelemetry = jest.fn()

const mockResolveAuth = jest.fn()
const mockLoadClaim = jest.fn()
const mockLoadLabel = jest.fn()
const mockFindLines = jest.fn()
const mockFork = jest.fn()
const dictionaryEm = {} as EntityManager
const em = { fork: mockFork } as unknown as EntityManager

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => mockTelemetry(),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => em }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindLines(...args),
}))
jest.mock('../lib/portalAuthGuard', () => ({
  resolveLinkedCustomerAuth: (...args: unknown[]) => mockResolveAuth(...args),
}))
jest.mock('../lib/portalClaimAccess', () => ({
  loadPortalOwnedClaim: (...args: unknown[]) => mockLoadClaim(...args),
}))
jest.mock('../lib/dictionaries', () => ({
  loadWarrantyClaimDictionaryLabel: (...args: unknown[]) => mockLoadLabel(...args),
}))

import { GET } from '../api/portal/claims/[id]/route'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1', customerId: 'customer-1' }
const claim = { id: 'claim-1', status: 'rejected', rejectionReasonCode: 'tenant-rejection' }
const request = new Request('http://localhost/api/warranty_claims/portal/claims/claim-1?tenantId=other&customerId=other')
const context = { params: Promise.resolve({ id: claim.id }) }

describe('portal claim rejection dictionary label', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockTelemetry.mockReturnValue({ reportError: mockReportError })
    mockResolveAuth.mockResolvedValue({ tenantId: scope.tenantId, orgId: scope.organizationId, customerEntityId: scope.customerId })
    mockLoadClaim.mockResolvedValue(claim)
    mockFindLines.mockResolvedValue([])
    mockFork.mockReturnValue(dictionaryEm)
    mockLoadLabel.mockResolvedValue('Tenant service policy exclusion')
  })

  it('returns only the selected label after ownership, using server-resolved tenant and organization', async () => {
    const response = await GET(request, context)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.item).toMatchObject({ rejectionReasonCode: 'tenant-rejection', rejectionReasonLabel: 'Tenant service policy exclusion' })
    expect(mockLoadClaim).toHaveBeenCalledWith(em, scope, claim.id)
    expect(mockLoadLabel).toHaveBeenCalledWith(dictionaryEm, { tenantId: scope.tenantId, organizationId: scope.organizationId }, 'warranty-claim-rejection-reason', 'tenant-rejection')
    expect(mockLoadClaim.mock.invocationCallOrder[0]).toBeLessThan(mockLoadLabel.mock.invocationCallOrder[0])
  })

  it.each(['unknown', 'unavailable'])('preserves the claim and code when the dictionary is %s', async (scenario) => {
    if (scenario === 'unknown') mockLoadLabel.mockResolvedValue(null)
    else mockLoadLabel.mockRejectedValue(new Error('[internal] Dictionary unavailable'))
    const response = await GET(request, context)
    expect(response.status).toBe(200)
    expect((await response.json()).item).toMatchObject({ rejectionReasonCode: 'tenant-rejection', rejectionReasonLabel: null })
  })

  it.each([true, false])('falls back on a failed lookup with telemetry enabled: %s', async (enabled) => {
    mockTelemetry.mockReturnValue(enabled ? { reportError: mockReportError } : undefined)
    const error = new Error('[internal] Dictionary unavailable')
    mockLoadLabel.mockRejectedValue(error)
    const response = await GET(request, context)
    expect(response.status).toBe(200)
    expect((await response.json()).item.rejectionReasonLabel).toBeNull()
    if (enabled) expect(mockReportError).toHaveBeenCalledWith(error, {
      module: 'warranty_claims', code: 'warranty_claims.portal_rejection_label_failed',
    })
    else expect(mockReportError).not.toHaveBeenCalled()
  })

  it('does not look up a dictionary without a rejection code', async () => {
    mockLoadClaim.mockResolvedValue({ ...claim, rejectionReasonCode: null })
    const response = await GET(request, context)
    expect((await response.json()).item.rejectionReasonLabel).toBeNull()
    expect(mockLoadLabel).not.toHaveBeenCalled()
  })

  it('denies a different customer before reading lines or dictionary labels', async () => {
    mockResolveAuth.mockResolvedValue({ tenantId: scope.tenantId, orgId: scope.organizationId, customerEntityId: 'customer-2' })
    mockLoadClaim.mockResolvedValue(null)
    const response = await GET(request, context)
    expect(response.status).toBe(404)
    expect(mockLoadClaim).toHaveBeenCalledWith(em, { ...scope, customerId: 'customer-2' }, claim.id)
    expect(mockFindLines).not.toHaveBeenCalled()
    expect(mockLoadLabel).not.toHaveBeenCalled()
  })

  it('requires a linked authenticated customer before any data read', async () => {
    mockResolveAuth.mockResolvedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(request, context)).status).toBe(401)
    expect(mockLoadClaim).not.toHaveBeenCalled()
    expect(mockLoadLabel).not.toHaveBeenCalled()
  })
})
