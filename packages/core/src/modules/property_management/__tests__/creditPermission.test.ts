/** @jest-environment node */
import { matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'
import { hasCreditPermission, resolveSalesAccess } from '../lib/creditPermission'

const reportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError }) }))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

function containerGranting(granted: string[]) {
  const userHasAllFeatures = jest.fn(async (_userId: string, required: string[]) =>
    required.every((feature) => granted.some((grant) => matchFeature(feature, grant))),
  )
  return { container: { resolve: () => ({ userHasAllFeatures }) }, userHasAllFeatures }
}

const auth = { sub: 'user-1', tenantId: scope.tenantId, orgId: scope.organizationId }

describe('resolveSalesAccess', () => {
  it('reports each sales document group by its own feature', async () => {
    const { container, userHasAllFeatures } = containerGranting(['sales.orders.view', 'sales.invoices.manage'])
    expect(await resolveSalesAccess(container as never, auth as never, scope)).toEqual({ orders: true, quotes: false, invoices: true })
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.quotes.view'], scope)
  })

  it('honours a sales wildcard grant through the rbac service', async () => {
    const { container } = containerGranting(['sales.*'])
    expect(await resolveSalesAccess(container as never, auth as never, scope)).toEqual({ orders: true, quotes: true, invoices: true })
    expect(await hasCreditPermission(container as never, auth as never, scope)).toBe(true)
  })

  it('grants nothing without a signed-in user', async () => {
    const { container } = containerGranting([])
    expect(await resolveSalesAccess(container as never, null, scope)).toEqual({ orders: false, quotes: false, invoices: false })
  })

  it('leaves a super admin to the rbac service instead of granting by the auth flag', async () => {
    const denied = containerGranting([])
    expect(await resolveSalesAccess(denied.container as never, { ...auth, isSuperAdmin: true } as never, scope)).toEqual({ orders: false, quotes: false, invoices: false })
    expect(denied.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], scope)
    const granted = containerGranting(['sales.*'])
    expect(await hasCreditPermission(granted.container as never, { ...auth, isSuperAdmin: true } as never, scope)).toBe(true)
  })

  it('grants nothing when the rbac service cannot be resolved', async () => {
    const container = { resolve: () => { throw new Error('[internal] missing rbacService') } }
    expect(await resolveSalesAccess(container as never, auth as never, scope)).toEqual({ orders: false, quotes: false, invoices: false })
  })

  it('reports a failed permission check instead of silently denying', async () => {
    reportError.mockClear()
    const failure = new Error('[internal] rbac down')
    const container = { resolve: () => ({ userHasAllFeatures: async () => { throw failure } }) }
    expect(await hasCreditPermission(container as never, auth as never, scope)).toBe(false)
    expect(reportError).toHaveBeenCalledWith(failure, {
      module: 'property_management',
      code: 'property_management.credit_permission_check_failed',
      attributes: { feature: 'sales.credit_memos.manage' },
    })
  })
})
