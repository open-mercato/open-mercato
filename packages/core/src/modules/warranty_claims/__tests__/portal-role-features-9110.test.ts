import { NextResponse } from 'next/server'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'

const mockGetAuth = jest.fn()
const mockHasFeatures = jest.fn()
const mockResolve = jest.fn()
const mockFindOne = jest.fn()
const mockRbac = { userHasAllFeatures: mockHasFeatures }

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
  requireCustomerFeature: jest.requireActual('@open-mercato/core/modules/customer_accounts/lib/customerAuth').requireCustomerFeature,
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: mockResolve }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args),
  findWithDecryption: jest.fn(async () => []),
}))

import { resolveLinkedCustomerAuth } from '../lib/portalAuthGuard'
import * as claims from '../api/portal/claims/route'
import * as detail from '../api/portal/claims/[id]/route'
import * as submit from '../api/portal/claims/[id]/submit/route'
import * as withdraw from '../api/portal/claims/[id]/withdraw/route'
import * as events from '../api/portal/events/route'
import * as attachments from '../api/portal/attachments/route'
import * as options from '../api/portal/options/route'
import * as troubleshooting from '../api/portal/troubleshooting/route'
import * as orders from '../api/portal/orders/route'
import * as lines from '../api/portal/orders/lines/route'
import { features } from '../acl'
import { setup } from '../setup'
import { metadata as listMetadata } from '../frontend/[orgSlug]/portal/claims/page.meta'
import { metadata as detailMetadata } from '../frontend/[orgSlug]/portal/claims/[id]/page.meta'
import { metadata as createMetadata } from '../frontend/[orgSlug]/portal/claims/new/page.meta'

const claimId = '11111111-1111-4111-8111-111111111111'
const auth = { sub: 'customer-user', tenantId: 'tenant', orgId: 'organization', customerEntityId: 'company' }
const routeContext = { params: Promise.resolve({ id: claimId }) }
const viewFeature = 'portal.warranty_claims.view'
const manageFeature = 'portal.warranty_claims.manage'
const request = new Request('http://localhost/api/warranty_claims/portal/claims')
const container = { resolve: mockResolve } as unknown as Parameters<typeof resolveLinkedCustomerAuth>[2]

type Endpoint = { name: string; feature: string; invoke: () => Promise<Response> }
const endpoints: Endpoint[] = [
  { name: 'GET claims', feature: viewFeature, invoke: () => claims.GET(request) },
  { name: 'POST claims', feature: manageFeature, invoke: () => claims.POST(request) },
  { name: 'GET claim detail', feature: viewFeature, invoke: () => detail.GET(request, routeContext) },
  { name: 'POST submit', feature: manageFeature, invoke: () => submit.POST(request, routeContext) },
  { name: 'POST withdraw', feature: manageFeature, invoke: () => withdraw.POST(request, routeContext) },
  { name: 'GET events', feature: viewFeature, invoke: () => events.GET(request) },
  { name: 'POST events', feature: manageFeature, invoke: () => events.POST(request) },
  { name: 'GET attachments', feature: viewFeature, invoke: () => attachments.GET(request) },
  { name: 'POST attachments', feature: manageFeature, invoke: () => attachments.POST(request) },
  { name: 'PUT attachments', feature: manageFeature, invoke: () => attachments.PUT(request) },
  { name: 'DELETE attachments', feature: manageFeature, invoke: () => attachments.DELETE(request) },
  { name: 'GET options', feature: viewFeature, invoke: () => options.GET(request) },
  { name: 'GET troubleshooting', feature: viewFeature, invoke: () => troubleshooting.GET(request) },
  { name: 'GET orders', feature: 'portal.orders.view', invoke: () => orders.GET(request) },
  { name: 'GET order lines', feature: 'portal.orders.view', invoke: () => lines.GET(new Request(`http://localhost/api/warranty_claims/portal/orders/lines?orderId=${claimId}`)) },
]

describe('issue 9110: warranty portal customer-role features', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue(auth)
    mockResolve.mockImplementation((name: string) => {
      if (name === 'customerRbacService') return mockRbac
      throw new Error('[internal] Data access must follow authorization')
    })
    mockHasFeatures.mockResolvedValue(false)
  })

  it.each(endpoints)('$name denies a role without $feature before data access', async ({ invoke, feature }) => {
    const response = await invoke()
    expect(response.status).toBe(403)
    expect(mockHasFeatures).toHaveBeenCalledWith(auth.sub, [feature], { tenantId: auth.tenantId, organizationId: auth.orgId })
    expect(mockResolve).toHaveBeenCalledTimes(1)
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it.each(endpoints)('$name returns 401 without a customer session', async ({ invoke }) => {
    mockGetAuth.mockResolvedValue(null)
    expect((await invoke()).status).toBe(401)
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it.each(endpoints.filter(({ feature }) => feature === manageFeature))('$name forbids viewer writes', async ({ invoke }) => {
    const grants = setup.defaultCustomerRoleFeatures?.viewer ?? []
    mockHasFeatures.mockImplementation(async (_user: string, required: string[]) => authorizeFeatures(required, { grantedFeatures: grants }))
    expect((await invoke()).status).toBe(403)
  })

  it.each([viewFeature, manageFeature, 'portal.orders.view'])('requires live RBAC even when the token claims %s', async (feature) => {
    mockGetAuth.mockResolvedValue({ ...auth, resolvedFeatures: [feature], isPortalAdmin: true })
    const result = await resolveLinkedCustomerAuth(request, feature, container)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
  })

  it.each(['*', 'portal.*', 'portal.warranty_claims.*', viewFeature])('honors an authorized %s grant through the realm service', async (grant) => {
    mockHasFeatures.mockImplementation(async (_user: string, required: string[]) => authorizeFeatures(required, { grantedFeatures: [grant] }))
    expect(await resolveLinkedCustomerAuth(request, viewFeature, container)).toEqual(auth)
  })

  it.each([viewFeature, manageFeature])('keeps buyers authorized for %s', async (feature) => {
    mockHasFeatures.mockImplementation(async (_user: string, required: string[]) => authorizeFeatures(required, { grantedFeatures: setup.defaultCustomerRoleFeatures?.buyer ?? [] }))
    expect(await resolveLinkedCustomerAuth(request, feature, container)).toEqual(auth)
  })

  it('keeps viewers authorized to read company claims', async () => {
    mockHasFeatures.mockImplementation(async (_user: string, required: string[]) => authorizeFeatures(required, { grantedFeatures: setup.defaultCustomerRoleFeatures?.viewer ?? [] }))
    expect(await resolveLinkedCustomerAuth(request, viewFeature, container)).toEqual(auth)
  })

  it('fails closed when the RBAC service is unavailable', async () => {
    mockResolve.mockImplementation(() => { throw new Error('[internal] RBAC unavailable') })
    expect((await resolveLinkedCustomerAuth(request, viewFeature, container) as Response).status).toBe(403)
  })

  it('fails closed when the RBAC lookup rejects', async () => {
    mockHasFeatures.mockRejectedValueOnce(new Error('[internal] RBAC unavailable'))
    expect((await resolveLinkedCustomerAuth(request, viewFeature, container) as Response).status).toBe(403)
  })

  it('preserves a feature guard response', async () => {
    const forbidden = NextResponse.json({ ok: false }, { status: 403 })
    mockHasFeatures.mockRejectedValueOnce(forbidden)
    expect(await resolveLinkedCustomerAuth(request, viewFeature, container)).toBe(forbidden)
  })

  it('denies unlinked customer accounts before RBAC', async () => {
    mockGetAuth.mockResolvedValue({ ...auth, customerEntityId: null })
    expect((await resolveLinkedCustomerAuth(request, viewFeature, container) as Response).status).toBe(403)
    expect(mockHasFeatures).not.toHaveBeenCalled()
  })

  it('declares both portal features and gates each page', () => {
    expect(features.map(({ id }) => id)).toEqual(expect.arrayContaining([viewFeature, manageFeature]))
    expect(listMetadata.requireCustomerFeatures).toEqual([viewFeature])
    expect(detailMetadata.requireCustomerFeatures).toEqual([viewFeature])
    expect(createMetadata.requireCustomerFeatures).toEqual([manageFeature])
  })
})
