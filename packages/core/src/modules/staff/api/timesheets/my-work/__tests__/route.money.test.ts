/** @jest-environment node */
const mockCanSeeRates = { value: true }

const mockProjectRow = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Cart migration',
  code: 'CART',
  color: null,
  customerSnapshot: null,
  hourlyRate: '1234567890123456789.1200',
  currencyCode: 'KWD',
  budgetKind: 'none',
  budgetValue: null,
  budgetWarnAtPercent: null,
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => {
    const em = {
      fork: () => em,
      find: async () => [{ timeProjectId: mockProjectRow.id }],
      getConnection: () => ({ execute: async () => [{}] }),
    }
    return {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') {
          return { userHasAllFeatures: async () => mockCanSeeRates.value }
        }
        throw new Error(`[internal] ${name} is not registered`)
      },
    }
  },
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ tenantId: 'tenant-1' }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeFilter', () => ({
  resolveSingleOrganizationIdOrDeny: () => 'org-1',
}))

jest.mock('../../_shared/withTimesheetInterceptors', () => {
  const { NextResponse } = jest.requireActual('next/server')
  return {
    readSearchParamsRecord: () => ({}),
    runTimesheetInterceptors: async () => ({
      ok: true,
      session: { respond: (status: number, body: unknown) => NextResponse.json(body, { status }) },
    }),
  }
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => {
  const entities = jest.requireActual('../../../../data/entities')
  return {
    findOneWithDecryption: async () => ({ id: 'member-1', displayName: 'Ada L.' }),
    findWithDecryption: async (_em: unknown, entity: unknown) =>
      entity === entities.StaffTimeProject ? [mockProjectRow] : [],
  }
})

jest.mock('../../../../lib/timesheets-projects/computeProjectFinancials', () => ({
  computeProjectFinancials: async () => new Map(),
  resolveProjectAmountDecimalPlaces: async () => ({}),
}))

import { GET } from '../route'

type MyWorkProject = { hourlyRate?: number | null; hourlyRateExact?: string | null; currencyCode?: string | null }

async function loadProject(): Promise<MyWorkProject> {
  const response = await GET(new Request('http://localhost/api/staff/timesheets/my-work'))
  expect(response.status).toBe(200)
  const body = (await response.json()) as { projects: MyWorkProject[] }
  expect(body.projects).toHaveLength(1)
  return body.projects[0]
}

describe('GET /api/staff/timesheets/my-work project money', () => {
  it('publishes the exact hourly rate beside the float for a holder of the rates feature', async () => {
    mockCanSeeRates.value = true
    const project = await loadProject()
    expect(project).toMatchObject({
      hourlyRate: 1234567890123456789.12,
      hourlyRateExact: '1234567890123456789.12',
      currencyCode: 'KWD',
    })
  })

  it('omits the exact hourly rate with the float for a caller without the rates feature', async () => {
    mockCanSeeRates.value = false
    const project = await loadProject()
    expect(project).not.toHaveProperty('hourlyRate')
    expect(project).not.toHaveProperty('hourlyRateExact')
    expect(project).not.toHaveProperty('currencyCode')
  })
})
