/** @jest-environment node */
/**
 * The report sub-routes take their money decision from here and never re-derive
 * it, so this is the one place where an RBAC failure could open rates and costs
 * to a plain report viewer — the leak the branch exists to close.
 */
import { RATES_FEATURE } from '../../../../lib/time-tracking/moneyVisibility'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const reportId = '44444444-4444-4444-8444-444444444444'

let rbacService: unknown = null
let resolveThrows = false

const userHasAllFeatures = jest.fn()
const getGrantedFeatures = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (resolveThrows) throw new Error('[internal] rbacService not registered')
    if (name === 'rbacService') return rbacService
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ tenantId, sub: userId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId,
    selectedId: organizationId,
    filterIds: [organizationId],
    allowedIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

import { resolveReportRequestContext } from '../shared'

const request = () =>
  new Request(`http://localhost/api/staff/timesheets/reports/${reportId}/sheet`, { method: 'GET' })

const resolveContext = () => resolveReportRequestContext(request(), { segment: 'sheet' })

describe('resolveReportRequestContext money visibility', () => {
  beforeEach(() => {
    resolveThrows = false
    userHasAllFeatures.mockReset()
    getGrantedFeatures.mockReset()
    userHasAllFeatures.mockResolvedValue(true)
    getGrantedFeatures.mockResolvedValue(['staff.timesheets.reports.view', RATES_FEATURE])
    container.resolve.mockClear()
    rbacService = { userHasAllFeatures, getGrantedFeatures }
  })

  it('shows money when the service grants rates.view, and says the grants are real', async () => {
    const context = await resolveContext()
    expect(context.canSeeMoney).toBe(true)
    expect(context.featuresResolved).toBe(true)
    expect(context.grantedFeatures).toEqual(['staff.timesheets.reports.view', RATES_FEATURE])
    expect(context.reportId).toBe(reportId)
  })

  it('asks the one authority once, and asks it for rates.view', async () => {
    await resolveContext()
    expect(userHasAllFeatures).toHaveBeenCalledTimes(1)
    expect(userHasAllFeatures).toHaveBeenCalledWith(userId, [RATES_FEATURE], { tenantId, organizationId })
    expect(getGrantedFeatures).toHaveBeenCalledTimes(1)
  })

  it('hides money when the service refuses', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    const context = await resolveContext()
    expect(context.canSeeMoney).toBe(false)
    expect(context.featuresResolved).toBe(true)
  })

  it('hides money when the check throws', async () => {
    userHasAllFeatures.mockRejectedValue(new Error('[internal] rbac down'))
    const context = await resolveContext()
    expect(context.canSeeMoney).toBe(false)
    expect(context.featuresResolved).toBe(false)
    expect(context.grantedFeatures).toEqual([])
  })

  it('hides money when the grant list would have granted it but the authority did not', async () => {
    // The exact leak: the routes used to read `grantedFeatures === null || authorize(...)`,
    // and none of them requires rates.view in its metadata.
    userHasAllFeatures.mockResolvedValue(false)
    getGrantedFeatures.mockResolvedValue(['staff.*'])
    const context = await resolveContext()
    expect(context.canSeeMoney).toBe(false)
  })

  it('hides money when the service cannot answer feature checks', async () => {
    rbacService = { getGrantedFeatures }
    const context = await resolveContext()
    expect(context.canSeeMoney).toBe(false)
    expect(context.featuresResolved).toBe(false)
    expect(context.grantedFeatures).toEqual([])
  })

  it('hides money when rbacService cannot be resolved at all', async () => {
    resolveThrows = true
    const context = await resolveContext()
    expect(context.canSeeMoney).toBe(false)
    expect(context.featuresResolved).toBe(false)
    expect(context.grantedFeatures).toEqual([])
  })

  it('does not report an empty grant list as authoritative when the service cannot list grants', async () => {
    rbacService = { userHasAllFeatures }
    const context = await resolveContext()
    expect(context.canSeeMoney).toBe(true)
    expect(context.featuresResolved).toBe(false)
    expect(context.grantedFeatures).toEqual([])
  })
})
