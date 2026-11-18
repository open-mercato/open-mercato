/** @jest-environment node */
import { matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'
import { hasGrantedFeature } from '../lib/featureAccess'
import { resolveCrmAccess } from '../lib/crmAccess'
import { hasSalesFeature } from '../lib/creditPermission'

const reportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError }) }))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const auth = { sub: 'user-1', tenantId: scope.tenantId, orgId: scope.organizationId }

function containerGranting(granted: string[]) {
  const userHasAllFeatures = jest.fn(async (_userId: string, required: string[]) =>
    required.every((feature) => granted.some((grant) => matchFeature(feature, grant))),
  )
  return { resolve: () => ({ userHasAllFeatures }) }
}

function failingContainer(failure: Error) {
  return { resolve: () => ({ userHasAllFeatures: async () => { throw failure } }) }
}

describe('hasGrantedFeature', () => {
  beforeEach(() => reportError.mockClear())

  it('asks the rbac service, so wildcard grants count', async () => {
    expect(await hasGrantedFeature(containerGranting(['customers.*']) as never, auth as never, scope, 'customers.people.view', 'code')).toBe(true)
    expect(await hasGrantedFeature(containerGranting(['sales.*']) as never, auth as never, scope, 'customers.people.view', 'code')).toBe(false)
  })

  it('grants nothing without a signed-in user', async () => {
    expect(await hasGrantedFeature(containerGranting(['*']) as never, null, scope, 'customers.people.view', 'code')).toBe(false)
  })

  it('keeps the CRM and sales failure codes apart', async () => {
    const failure = new Error('[internal] rbac down')
    expect(await resolveCrmAccess(failingContainer(failure) as never, auth as never, scope)).toEqual({ people: false, companies: false })
    expect(reportError).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'property_management.crm_permission_check_failed' }))
    reportError.mockClear()
    expect(await hasSalesFeature(failingContainer(failure) as never, auth as never, scope, 'sales.orders.view')).toBe(false)
    expect(reportError).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'property_management.credit_permission_check_failed' }))
  })
})
