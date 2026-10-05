const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const staffMemberId = '44444444-4444-4444-8444-444444444444'

const resolveCapacityForRange = jest.fn()

const em = {
  fork: () => em,
  find: jest.fn(async () => []),
  getConnection: () => ({
    execute: jest.fn(async () => [
      { today_minutes: 60, week_minutes: 600, month_minutes: 1200, month_nonbillable_minutes: 0 },
    ]),
  }),
}

const container = {
  hasRegistration: () => true,
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'moduleConfigService') return { getRecord: async () => null }
    if (name === 'rbacService') {
      return { userHasAllFeatures: async () => false, getGrantedFeatures: async () => ['staff.timesheets.view'] }
    }
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ tenantId, sub: userId, orgId: organizationId })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => ({ id: staffMemberId, displayName: 'Ada' })),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('../../../../lib/timesheets-projects/computeProjectFinancials', () => ({
  computeProjectFinancials: jest.fn(async () => new Map()),
}))

jest.mock('../../../../lib/time-tracking/capacityService', () => ({
  resolveCapacityForRange: (...args: unknown[]) => resolveCapacityForRange(...args),
}))

import { GET } from '../route'

const request = () => new Request('http://localhost/api/staff/timesheets/my-work')

describe('GET /api/staff/timesheets/my-work capacity (#6934)', () => {
  beforeEach(() => {
    resolveCapacityForRange.mockReset()
  })

  it('keeps the flat daily-hours KPIs when capacity resolution fails', async () => {
    resolveCapacityForRange.mockRejectedValue(new Error('[internal] provider down'))
    const response = await GET(request())
    expect(response.status).toBe(200)
    const { kpis } = await response.json()
    expect(kpis.dailyTargetMinutes).not.toBeNull()
    expect(kpis.weekTargetMinutes).toBe(kpis.dailyTargetMinutes * kpis.weekWorkingDays)
    expect(kpis.monthTargetMinutes).toBe(kpis.dailyTargetMinutes * kpis.monthWorkingDays)
  })

  it("uses a contributed provider's week and month targets for the caller", async () => {
    const contributed = (totalTargetMinutes: number) => ({
      targetMinutesByDate: {},
      totalTargetMinutes,
      providerId: 'app.contract_hours',
      isBuiltIn: false,
    })
    resolveCapacityForRange.mockResolvedValueOnce(contributed(1200)).mockResolvedValueOnce(contributed(5040))
    const response = await GET(request())
    expect(response.status).toBe(200)
    const { kpis } = await response.json()
    expect(resolveCapacityForRange).toHaveBeenCalledWith(expect.objectContaining({ staffMemberId, tenantId, organizationId }))
    expect(kpis.dailyTargetMinutes).toBeNull()
    expect(kpis.weekTargetMinutes).toBe(1200)
    expect(kpis.monthTargetMinutes).toBe(5040)
  })
})
