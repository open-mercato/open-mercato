/** @jest-environment node */
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { Building, Floor, Lease, PropertyManagementSettings, Space, Unit } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const BUILDING = '50000000-0000-4000-8000-000000000001'
const FLOOR = '50000000-0000-4000-8000-000000000002'
const SPACE = '50000000-0000-4000-8000-000000000003'
const UNIT = '50000000-0000-4000-8000-000000000004'
const COMPANY = '50000000-0000-4000-8000-000000000005'
const PERSON = '50000000-0000-4000-8000-000000000006'
const DATE = '2026-11-11'
const scope = { tenantId: TENANT, organizationId: ORG }

const mockState: { em: FakeEm | null; granted: string[] } = { em: null, granted: [] }

jest.mock('../api/routeContext', () => ({
  resolveStaffContext: jest.fn(async () => ({
    em: mockState.em,
    ctx: {
      container: {
        resolve: () => ({
          userHasAllFeatures: async (_user: string, features: string[]) => features.every((feature) => mockState.granted.includes(feature)),
        }),
      },
      auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
    },
    tenantId: TENANT,
    organizationId: ORG,
    userId: 'user-1',
    translate: (_key: string, fallback?: string) => fallback ?? '',
    permitted: null,
  })),
  readRouteParam: jest.fn(async () => FLOOR),
  handleRouteError: jest.fn((err: unknown) => {
    throw err
  }),
}))

jest.mock('../lib/productUse', () => ({
  loadProductNames: jest.fn(async () => new Map()),
  loadCategoryNames: jest.fn(async () => new Map()),
  loadProductUses: jest.fn(async () => new Map([['product-office', { use: 'leasable', billingUnit: 'month' }]])),
}))

jest.mock('../lib/usageGuards', () => ({
  findUnitsWithUpcomingBookings: jest.fn(async () => []),
  leaseBlockersOf: jest.fn(() => []),
}))

import { GET } from '../api/floors/[id]/layout/route'

const updatedAt = new Date('2026-11-01T00:00:00Z')

function seed(): FakeEm {
  const em = new FakeEm()
  em.seed(Building, { id: BUILDING, ...scope, name: 'HQ', address: 'Main 1', status: 'active', updatedAt, deletedAt: null } as never)
  em.seed(Floor, { id: FLOOR, ...scope, buildingId: BUILDING, number: 0, name: 'Ground', sizeX: '20', sizeY: '10', updatedAt, deletedAt: null } as never)
  em.seed(Space, { id: SPACE, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Main', purpose: null, isDefault: true, x: '0', y: '0', width: '20', depth: '10', updatedAt, deletedAt: null } as never)
  em.seed(Unit, { id: UNIT, ...scope, buildingId: BUILDING, floorId: FLOOR, spaceId: SPACE, name: 'U1', catalogCategoryId: 'category-1', catalogProductId: 'product-office', x: '0', y: '0', width: '5', depth: '5', updatedAt, deletedAt: null } as never)
  em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, leaseEndingThresholdDays: 30 } as never)
  em.seed(Lease, { id: 'lease-1', ...scope, reference: 'L-1', status: 'active', unitId: UNIT, startsOn: '2026-01-01', endsOn: '2027-12-31', customerCompanyId: COMPANY, primaryContactPersonId: PERSON, deletedAt: null } as never)
  em.seed(CustomerEntity, { id: COMPANY, ...scope, displayName: 'Vertex Robotics', primaryEmail: null, deletedAt: null } as never)
  em.seed(CustomerEntity, { id: PERSON, ...scope, displayName: 'Priya Natarajan', primaryEmail: 'priya@example.com', deletedAt: null } as never)
  return em
}

async function layout(granted: string[]) {
  mockState.em = seed()
  mockState.granted = granted
  const response = await GET(new Request(`http://localhost/api/property_management/floors/${FLOOR}/layout?date=${DATE}`), { params: Promise.resolve({ id: FLOOR }) })
  expect(response.status).toBe(200)
  return (await response.json()) as { crmAccess: { people: boolean; companies: boolean }; units: Array<{ lease?: Record<string, unknown> | null }> }
}

describe('GET /api/property_management/floors/{id}/layout CRM gating', () => {
  it('returns the CRM names and email with both customers view features', async () => {
    const body = await layout(['customers.people.view', 'customers.companies.view'])
    expect(body.crmAccess).toEqual({ people: true, companies: true })
    expect(body.units[0].lease).toMatchObject({ companyName: 'Vertex Robotics', contactName: 'Priya Natarajan', contactEmail: 'priya@example.com' })
  })

  it('omits every CRM-derived field without the customers view features', async () => {
    const body = await layout([])
    expect(body.crmAccess).toEqual({ people: false, companies: false })
    const lease = body.units[0].lease ?? {}
    expect(lease).toMatchObject({ reference: 'L-1', customerCompanyId: COMPANY, contactPersonId: PERSON })
    expect(lease).not.toHaveProperty('companyName')
    expect(lease).not.toHaveProperty('contactName')
    expect(lease).not.toHaveProperty('contactEmail')
    expect(JSON.stringify(body)).not.toContain('priya@example.com')
  })

  it('gates people and companies independently', async () => {
    const body = await layout(['customers.companies.view'])
    expect(body.crmAccess).toEqual({ people: false, companies: true })
    expect(body.units[0].lease).toMatchObject({ companyName: 'Vertex Robotics' })
    expect(body.units[0].lease).not.toHaveProperty('contactEmail')
  })
})
