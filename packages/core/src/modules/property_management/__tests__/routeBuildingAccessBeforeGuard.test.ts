/** @jest-environment node */
import { Building, CommonArea, Floor, Lease, Space, Unavailability, Unit } from '../data/entities'
import { FakeEm, type EntityClass } from './support/fakeEm'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const ASSIGNED_BUILDING = '71000000-0000-4000-8000-000000000001'
const OTHER_BUILDING = '71000000-0000-4000-8000-000000000002'
const LEASE = '71000000-0000-4000-8000-000000000003'
const PROPOSAL = '71000000-0000-4000-8000-000000000004'
const UNAVAILABILITY = '71000000-0000-4000-8000-000000000005'
const STALE = '2026-01-01T00:00:00.000Z'
const CURRENT = '2026-02-01T00:00:00.000Z'

const RECORD = '71000000-0000-4000-8000-000000000006'

const state: { em: FakeEm } = { em: new FakeEm() }
const execute = jest.fn(async () => ({ result: {} }))
const crudExecute = jest.fn(async () => ({ result: {}, logEntry: null }))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => Promise<unknown>) => fn(),
}), { virtual: true })
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'em') return state.em
      if (name === 'commandBus') return { execute: crudExecute }
      throw new Error(`[internal] unexpected ${name}`)
    },
  }),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => {
  const auth = { sub: 'manager-1', orgId: '22222222-2222-4222-8222-222222222222', tenantId: '11111111-1111-4111-8111-111111111111', roles: ['employee'] }
  return { getAuthFromCookies: async () => auth, getAuthFromRequest: async () => auth }
})
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: '22222222-2222-4222-8222-222222222222',
    filterIds: ['22222222-2222-4222-8222-222222222222'],
    allowedIds: ['22222222-2222-4222-8222-222222222222'],
    tenantId: '11111111-1111-4111-8111-111111111111',
  })),
}))
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => ['71000000-0000-4000-8000-000000000001']) }
})

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('../api/routeContext', () => {
  const actual = jest.requireActual('../api/routeContext')
  return {
    ...actual,
    resolveStaffContext: jest.fn(async () => ({
      ctx: { container: { resolve: () => ({ execute }) }, auth: { sub: 'manager-1', tenantId: TENANT, orgId: ORG } },
      em: state.em,
      tenantId: TENANT,
      organizationId: ORG,
      userId: 'manager-1',
      translate: (_key: string, fallback?: string) => fallback ?? _key,
      permitted: [ASSIGNED_BUILDING],
    })),
    runStaffGuard: jest.fn(async () => ({
      ok: false,
      response: { status: 409, body: { code: 'optimistic_lock_conflict', currentUpdatedAt: CURRENT, expectedUpdatedAt: STALE } },
    })),
  }
})

import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { runStaffGuard } from '../api/routeContext'
import { DELETE as deleteBuilding, PUT as updateBuilding } from '../api/buildings/route'
import { DELETE as deleteCommonArea, PUT as updateCommonArea } from '../api/common-areas/route'
import { PUT as updateFloor } from '../api/floors/route'
import { DELETE as deleteSpace, PUT as updateSpace } from '../api/spaces/route'
import { DELETE as deleteUnit, PUT as updateUnit } from '../api/units/route'
import { POST as endLease } from '../api/leases/[id]/end/route'
import { POST as extendLease } from '../api/leases/[id]/extensions/route'
import { DELETE as withdrawProposal } from '../api/leases/[id]/proposals/[proposalId]/route'
import { POST as endUnavailability } from '../api/unavailabilities/[id]/end/route'

type RouteResult = { status: number; body: Record<string, unknown> }

function seed(buildingId: string): void {
  state.em = new FakeEm()
  state.em.seed(Lease, { id: LEASE, ...scope, buildingId, unitId: 'unit-1', status: 'active', deletedAt: null, updatedAt: new Date(CURRENT) } as never)
  state.em.seed(Unavailability, { id: UNAVAILABILITY, ...scope, buildingId, deletedAt: null, updatedAt: new Date(CURRENT) } as never)
}

function staleRequest(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/property_management/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-om-ext-optimistic-lock-expected-updated-at': STALE },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const routes: Array<{ name: string; call: () => Promise<unknown> }> = [
  { name: 'lease end', call: () => endLease(staleRequest({ endsOn: '2027-06-30' }), { params: Promise.resolve({ id: LEASE }) }) },
  { name: 'lease extension', call: () => extendLease(staleRequest({ months: 3, monthlyRate: 1200 }), { params: Promise.resolve({ id: LEASE }) }) },
  {
    name: 'proposal withdraw',
    call: () => withdrawProposal(staleRequest(), { params: Promise.resolve({ id: LEASE, proposalId: PROPOSAL }) }),
  },
  { name: 'unavailability end', call: () => endUnavailability(staleRequest(), { params: Promise.resolve({ id: UNAVAILABILITY }) }) },
]

beforeEach(() => jest.clearAllMocks())

describe.each(routes)('$name with a stale lock header', ({ call }) => {
  it('answers 404 without running the mutation guards for a building not assigned to the caller', async () => {
    seed(OTHER_BUILDING)
    const response = (await call()) as RouteResult
    expect(response.status).toBe(404)
    expect(response.body).not.toHaveProperty('currentUpdatedAt')
    expect(runStaffGuard).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('reports the lock conflict for a building assigned to the caller', async () => {
    seed(ASSIGNED_BUILDING)
    const response = (await call()) as RouteResult
    expect(response.status).toBe(409)
    expect(runStaffGuard).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })
})

const staleLockGuard = jest.fn(async () => ({
  ok: false,
  status: 409,
  body: { code: 'optimistic_lock_conflict', currentUpdatedAt: CURRENT, expectedUpdatedAt: STALE },
}))

function crudRequest(method: 'PUT' | 'DELETE', id: string): Request {
  return new Request(`http://localhost/api/property_management/records?id=${id}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-om-ext-optimistic-lock-expected-updated-at': STALE },
    body: JSON.stringify({ id }),
  })
}

type CrudCase = {
  name: string
  entity: EntityClass | null
  call: (id: string) => Promise<Response>
}

const crudRoutes: CrudCase[] = [
  { name: 'building update', entity: null, call: (id) => updateBuilding(crudRequest('PUT', id)) },
  { name: 'building delete', entity: null, call: (id) => deleteBuilding(crudRequest('DELETE', id)) },
  { name: 'floor update', entity: Floor, call: (id) => updateFloor(crudRequest('PUT', id)) },
  { name: 'space update', entity: Space, call: (id) => updateSpace(crudRequest('PUT', id)) },
  { name: 'space delete', entity: Space, call: (id) => deleteSpace(crudRequest('DELETE', id)) },
  { name: 'unit update', entity: Unit, call: (id) => updateUnit(crudRequest('PUT', id)) },
  { name: 'unit delete', entity: Unit, call: (id) => deleteUnit(crudRequest('DELETE', id)) },
  { name: 'common area update', entity: CommonArea, call: (id) => updateCommonArea(crudRequest('PUT', id)) },
  { name: 'common area delete', entity: CommonArea, call: (id) => deleteCommonArea(crudRequest('DELETE', id)) },
]

function seedRecord(entity: CrudCase['entity'], buildingId: string): string {
  state.em = new FakeEm()
  state.em.seed(Building, { id: buildingId, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null, updatedAt: new Date(CURRENT) } as never)
  if (!entity) return buildingId
  state.em.seed(entity, { id: RECORD, ...scope, buildingId, floorId: RECORD, deletedAt: null, updatedAt: new Date(CURRENT) } as never)
  return RECORD
}

describe.each(crudRoutes)('CRUD $name with a stale lock header', ({ entity, call }) => {
  beforeEach(() => {
    crudExecute.mockClear()
    staleLockGuard.mockClear()
    registerMutationGuards([{
      moduleId: 'test',
      guards: [{ id: 'test.stale-lock', targetEntity: '*', operations: ['update', 'delete'], validate: staleLockGuard }],
    }])
  })

  afterAll(() => registerMutationGuards([]))

  it('answers 404 without running the mutation guards for a building not assigned to the caller', async () => {
    const id = seedRecord(entity, OTHER_BUILDING)
    const response = await call(id)
    expect(response.status).toBe(404)
    expect(await response.json()).not.toHaveProperty('currentUpdatedAt')
    expect(staleLockGuard).not.toHaveBeenCalled()
    expect(crudExecute).not.toHaveBeenCalled()
  })

  it('reports the lock conflict for a building assigned to the caller', async () => {
    const id = seedRecord(entity, ASSIGNED_BUILDING)
    const response = await call(id)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ currentUpdatedAt: CURRENT })
    expect(staleLockGuard).toHaveBeenCalledTimes(1)
    expect(crudExecute).not.toHaveBeenCalled()
  })
})
