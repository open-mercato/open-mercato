import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { POST } from '../route'

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const selectedOrganizationId = '22222222-2222-4222-8222-222222222222'
const alternateOrganizationId = '33333333-3333-4333-8333-333333333333'

const resolveAncestorIds = jest.fn()
const userHasAllFeatures = jest.fn()
const generate = jest.fn()
const services = {
  organizationHierarchyService: { resolveAncestorIds },
  rbacService: { userHasAllFeatures },
  salesDocumentNumberGenerator: { generate },
}

function scopeWith(allowedIds: string[] | null) {
  jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
    tenantId,
    selectedId: selectedOrganizationId,
    allowedIds,
    filterIds: [selectedOrganizationId],
  })
}

function generateNumber(organizationId?: string, targetTenantId?: string) {
  return POST(new Request('https://example.test', {
    method: 'POST',
    body: JSON.stringify({ kind: 'order', organizationId, tenantId: targetTenantId }),
  }))
}

describe('document number target authorization', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'actor-1', tenantId, orgId: selectedOrganizationId })
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: (name: keyof typeof services) => services[name],
    } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
    scopeWith([selectedOrganizationId])
    resolveAncestorIds.mockResolvedValue([])
    userHasAllFeatures.mockResolvedValue(true)
    generate.mockResolvedValue({ number: 'ORD-17', format: 'ORD-{seq}', sequence: 17 })
  })

  it('rejects an unavailable organization before looking it up or allocating a number', async () => {
    expect((await generateNumber(alternateOrganizationId)).status).toBe(403)
    expect(resolveAncestorIds).not.toHaveBeenCalled()
    expect(userHasAllFeatures).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()

    const response = await generateNumber()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sequence: 17 })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ tenantId, organizationId: selectedOrganizationId }))
  })

  it('validates and checks permissions in the same authorized target scope used by the generator', async () => {
    scopeWith([selectedOrganizationId, alternateOrganizationId])
    const target = { tenantId, organizationId: alternateOrganizationId }

    expect((await generateNumber(alternateOrganizationId)).status).toBe(200)
    expect(resolveAncestorIds).toHaveBeenCalledWith(target)
    expect(userHasAllFeatures).toHaveBeenCalledWith('actor-1', ['sales.orders.manage', 'sales.documents.number.edit'], target)
    expect(generate).toHaveBeenCalledWith(expect.objectContaining(target))
  })

  it('requires an organization in the effective tenant even for an unrestricted actor', async () => {
    scopeWith(null)
    resolveAncestorIds.mockResolvedValue(null)

    expect((await generateNumber(alternateOrganizationId)).status).toBe(403)
    expect(resolveAncestorIds).toHaveBeenCalledWith({ tenantId, organizationId: alternateOrganizationId })
    expect(userHasAllFeatures).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })

  it('uses the validated target tenant for a superadmin override', async () => {
    const targetTenantId = '44444444-4444-4444-8444-444444444444'
    const target = { tenantId: targetTenantId, organizationId: alternateOrganizationId }
    jest.mocked(getAuthFromRequest).mockResolvedValue({
      sub: 'actor-1', tenantId, orgId: selectedOrganizationId, isSuperAdmin: true,
    })
    scopeWith(null)

    expect((await generateNumber(alternateOrganizationId, targetTenantId)).status).toBe(200)
    expect(resolveAncestorIds).toHaveBeenCalledWith(target)
    expect(userHasAllFeatures).toHaveBeenCalledWith('actor-1', ['sales.orders.manage', 'sales.documents.number.edit'], target)
    expect(generate).toHaveBeenCalledWith(expect.objectContaining(target))
  })

  it('requires both permissions in the target organization', async () => {
    scopeWith([selectedOrganizationId, alternateOrganizationId])
    userHasAllFeatures.mockImplementation(async (_actor, _features, scope) => scope.organizationId === selectedOrganizationId)

    expect((await generateNumber(alternateOrganizationId)).status).toBe(403)
    expect(generate).not.toHaveBeenCalled()
  })
})
