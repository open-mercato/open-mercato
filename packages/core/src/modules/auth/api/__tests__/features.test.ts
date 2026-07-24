/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/auth/api/features'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  getModules: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/entities/lib/restrictedEntityFeatures', () => ({
  synthesizeRestrictedEntityFeatures: jest.fn(),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getModules } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { synthesizeRestrictedEntityFeatures } from '@open-mercato/core/modules/entities/lib/restrictedEntityFeatures'

const mockGetAuth = getAuthFromRequest as jest.Mock
const mockGetModules = getModules as jest.Mock
const mockCreateContainer = createRequestContainer as jest.Mock
const mockSynthesize = synthesizeRestrictedEntityFeatures as jest.Mock

function makeReq() {
  return new Request('http://localhost/api/auth/features')
}

describe('GET /api/auth/features', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue({ sub: 'u1', tenantId: 't1', orgId: 'o1' })
    mockCreateContainer.mockResolvedValue({ resolve: () => ({}) })
    mockSynthesize.mockResolvedValue([])
  })

  it('returns 401 when not authenticated', async () => {
    mockGetAuth.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns features without dependsOn when none declared', async () => {
    mockGetModules.mockReturnValue([
      {
        id: 'auth',
        info: { title: 'Auth' },
        features: [{ id: 'auth.users.list', title: 'List users', module: 'auth' }],
      },
    ])
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([{ id: 'auth.users.list', title: 'List users', module: 'auth' }])
    expect(body.items[0]).not.toHaveProperty('dependsOn')
  })

  it('forwards dependsOn when declared', async () => {
    mockGetModules.mockReturnValue([
      {
        id: 'customers',
        info: { title: 'Customers' },
        features: [
          { id: 'customers.people.view', title: 'View people', module: 'customers' },
          {
            id: 'customers.people.manage',
            title: 'Manage people',
            module: 'customers',
            dependsOn: ['customers.people.view'],
          },
        ],
      },
    ])
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toContainEqual({
      id: 'customers.people.manage',
      title: 'Manage people',
      module: 'customers',
      dependsOn: ['customers.people.view'],
    })
  })

  it('normalizes dependsOn (trims, drops empties, dedupes)', async () => {
    mockGetModules.mockReturnValue([
      {
        id: 'm',
        info: { title: 'M' },
        features: [
          {
            id: 'm.b',
            title: 'B',
            module: 'm',
            dependsOn: ['  m.a  ', '', '   ', 'm.a', 'm.c'],
          },
          { id: 'm.a', title: 'A', module: 'm' },
          { id: 'm.c', title: 'C', module: 'm' },
        ],
      },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    const b = body.items.find((it: any) => it.id === 'm.b')
    expect(b.dependsOn).toEqual(['m.a', 'm.c'])
  })

  it('omits dependsOn when it normalizes to empty', async () => {
    mockGetModules.mockReturnValue([
      {
        id: 'm',
        info: { title: 'M' },
        features: [{ id: 'm.a', title: 'A', module: 'm', dependsOn: ['', '   '] }],
      },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.items[0]).not.toHaveProperty('dependsOn')
  })

  it('deduplicates feature ids across modules (keeps first)', async () => {
    mockGetModules.mockReturnValue([
      { id: 'a', info: { title: 'A' }, features: [{ id: 'shared.thing', title: 'First', module: 'a' }] },
      { id: 'b', info: { title: 'B' }, features: [{ id: 'shared.thing', title: 'Second', module: 'b' }] },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.items).toEqual([{ id: 'shared.thing', title: 'First', module: 'a' }])
  })

  it('appends synthesized per-entity features for restricted custom entities', async () => {
    mockGetModules.mockReturnValue([
      {
        id: 'entities',
        info: { title: 'Entities' },
        features: [{ id: 'entities.records.view', title: 'View records', module: 'entities' }],
      },
    ])
    mockSynthesize.mockResolvedValue([
      {
        id: 'entities.records.hr:salaries.view',
        title: 'View records: Salaries',
        module: 'entities',
        dependsOn: ['entities.records.view'],
      },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(mockSynthesize).toHaveBeenCalledWith(expect.anything(), 't1')
    expect(body.items).toContainEqual({
      id: 'entities.records.hr:salaries.view',
      title: 'View records: Salaries',
      module: 'entities',
      dependsOn: ['entities.records.view'],
    })
  })

  it('still returns the static catalog when synthesis throws', async () => {
    mockGetModules.mockReturnValue([
      { id: 'auth', info: { title: 'Auth' }, features: [{ id: 'auth.users.list', title: 'List users', module: 'auth' }] },
    ])
    mockSynthesize.mockRejectedValue(new Error('db down'))
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([{ id: 'auth.users.list', title: 'List users', module: 'auth' }])
  })
})
