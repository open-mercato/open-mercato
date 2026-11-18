/** @jest-environment node */
import { Unavailability } from '../data/entities'
import { loadUnavailabilities, notOverAt } from '../lib/availabilityResolver'
import { findLeaseIdsWithUnavailableUnit, UNAVAILABLE_LEASE_ID_LIMIT } from '../lib/leaseAvailability'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

const mockContext: { em: FakeEm | null } = { em: null }

jest.mock('../api/routeContext', () => ({
  resolveStaffContext: jest.fn(async () => ({
    em: mockContext.em,
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    permitted: null,
  })),
  handleRouteError: jest.fn((err: unknown) => {
    throw err
  }),
  runStaffGuard: jest.fn(),
}))

import { RawQueryFragment } from '@mikro-orm/core'
import { GET, POST } from '../api/unavailabilities/route'
import { resolveStaffContext } from '../api/routeContext'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '50000000-0000-4000-8000-000000000001'
const UNIT = '50000000-0000-4000-8000-000000000002'
const COMPANY = '50000000-0000-4000-8000-000000000003'
const LEASE = '50000000-0000-4000-8000-000000000004'

function seedClosure(em: FakeEm, id: string, data: { startsAt: string; endsAt?: string | null; endedAt?: string | null; subjectId?: string }) {
  em.seed(Unavailability, {
    id,
    ...scope,
    buildingId: BUILDING,
    subjectType: 'unit',
    subjectId: data.subjectId ?? UNIT,
    reasonEntryId: null,
    reasonText: 'Renovation',
    startsAt: data.startsAt,
    endsAt: data.endsAt ?? null,
    endedAt: data.endedAt ?? null,
    applyStatus: 'applied',
    cancelledBookingCount: 0,
    deletedAt: null,
  } as never)
}

describe('notOverAt', () => {
  it('requires both the planned and the actual end to lie after the moment, in stored wall-clock form', () => {
    expect(notOverAt('2026-11-11T09:30')).toEqual([
      { $or: [{ endsAt: null }, { endsAt: { $gt: '2026-11-11T09:30:00' } }] },
      { $or: [{ endedAt: null }, { endedAt: { $gt: '2026-11-11T09:30:00' } }] },
    ])
  })
})

describe('loadUnavailabilities', () => {
  it('leaves out closures ended before the range starts', async () => {
    const em = new FakeEm()
    seedClosure(em, 'ended-open', { startsAt: '2026-01-01T00:00:00', endedAt: '2026-02-01T00:00:00' })
    seedClosure(em, 'ended-planned', { startsAt: '2026-01-01T00:00:00', endsAt: '2027-01-01T00:00:00', endedAt: '2026-02-01T00:00:00' })
    seedClosure(em, 'ending-later', { startsAt: '2026-01-01T00:00:00', endedAt: '2026-12-01T00:00:00' })
    seedClosure(em, 'open', { startsAt: '2026-01-01T00:00:00' })
    const windows = await loadUnavailabilities(em as never, scope, [UNIT], { start: '2026-11-11T00:00', end: null })
    expect(windows.map((window) => window.id).sort((left, right) => (left ?? '').localeCompare(right ?? ''))).toEqual(['ending-later', 'open'])
  })
})

describe('findLeaseIdsWithUnavailableUnit', () => {
  it('finds the flagged leases in one EXISTS query without loading closures, units or leases', async () => {
    const em = new FakeEm()
    const find = jest.spyOn(em, 'find')
    em.respond = () => [{ id: 'lease-1' }, { id: 'lease-2' }]
    expect(await findLeaseIdsWithUnavailableUnit(em as never, scope, [BUILDING], {}, '2026-11-11')).toEqual(['lease-1', 'lease-2'])
    expect(find).not.toHaveBeenCalled()
    expect(em.executed).toHaveLength(1)
    const [{ sql, params }] = em.executed
    expect(sql).toContain('exists (')
    expect(sql).toContain('from property_management_unavailabilities closure')
    expect(sql).toContain('least(closure.ends_at, closure.ended_at)')
    expect(sql).toContain('unit.building_id in (?)')
    expect(sql).toContain('closure.building_id = unit.building_id')
    expect(sql).toContain('order by lease.ends_on, lease.id')
    expect(params).toEqual([ORG, TENANT, 'proposed', 'pending_order', 'active', BUILDING, '2026-11-11', '2026-11-11', UNAVAILABLE_LEASE_ID_LIMIT + 1])
  })

  it('narrows the query by the other list filters and bounds the ids it returns', async () => {
    const em = new FakeEm()
    em.respond = () => [{ id: 'lease-1' }, { id: 'lease-2' }, { id: 'lease-3' }]
    const narrowing = { statuses: ['active', 'expired'], unitId: UNIT, customerCompanyId: COMPANY, leaseId: LEASE, limit: 2 }
    expect(await findLeaseIdsWithUnavailableUnit(em as never, scope, [BUILDING], narrowing, '2026-11-11')).toEqual(['lease-1', 'lease-2'])
    const [{ sql, params }] = em.executed
    expect(sql).toContain('lease.status in (?)')
    expect(sql).toContain('and lease.unit_id = ?')
    expect(sql).toContain('and lease.customer_company_id = ?')
    expect(sql).toContain('and lease.id = ?')
    expect(sql).toMatch(/limit \?$/)
    expect(params).toEqual([ORG, TENANT, 'active', BUILDING, UNIT, COMPANY, LEASE, '2026-11-11', '2026-11-11', 3])
  })

  it('skips the query when no requested status can reserve a unit', async () => {
    const em = new FakeEm()
    expect(await findLeaseIdsWithUnavailableUnit(em as never, scope, null, { statuses: ['ended', 'declined'] }, '2026-11-11')).toEqual([])
    expect(em.executed).toHaveLength(0)
  })

  it('reads every building when unrestricted and nothing when no building is permitted', async () => {
    const em = new FakeEm()
    em.respond = () => []
    expect(await findLeaseIdsWithUnavailableUnit(em as never, scope, [], {}, '2026-11-11')).toEqual([])
    expect(em.executed).toHaveLength(0)
    await findLeaseIdsWithUnavailableUnit(em as never, scope, null, {}, '2026-11-11')
    expect(em.executed[0].sql).not.toContain('unit.building_id in')
  })
})

describe('GET /api/property_management/unavailabilities?active=true', () => {
  it('returns a live closure even when 500 older ended closures exist', async () => {
    const em = new FakeEm()
    for (let index = 0; index < 500; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0')
      seedClosure(em, `ended-${index}`, { startsAt: `2020-01-${day}T00:00:00`, endedAt: '2021-01-01T00:00:00' })
    }
    seedClosure(em, 'live', { startsAt: '2025-06-01T00:00:00' })
    mockContext.em = em
    const response = await GET(new Request('http://localhost/api/property_management/unavailabilities?active=true'))
    const body = (await response.json()) as { items: Array<{ id: string }>; total: number; truncated: boolean }
    expect(body.items.map((item) => item.id)).toEqual(['live'])
    expect(body).toMatchObject({ total: 1, truncated: false })
  })

  it('reports the total and that the list was truncated past 500 rows', async () => {
    const em = new FakeEm()
    for (let index = 0; index < 503; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0')
      seedClosure(em, `closure-${index}`, { startsAt: `2026-12-${day}T00:00:00` })
    }
    mockContext.em = em
    const response = await GET(new Request('http://localhost/api/property_management/unavailabilities?active=false'))
    const body = (await response.json()) as { items: Array<{ id: string }>; total: number; truncated: boolean }
    expect(body.items).toHaveLength(500)
    expect(body).toMatchObject({ total: 503, truncated: true })
  })

  it('does not flag a list of exactly 500 rows as truncated', async () => {
    const em = new FakeEm()
    for (let index = 0; index < 500; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0')
      seedClosure(em, `closure-${index}`, { startsAt: `2026-12-${day}T00:00:00` })
    }
    mockContext.em = em
    const response = await GET(new Request('http://localhost/api/property_management/unavailabilities?active=false'))
    const body = (await response.json()) as { items: Array<{ id: string }>; total: number; truncated: boolean }
    expect(body.items).toHaveLength(500)
    expect(body).toMatchObject({ total: 500, truncated: false })
  })
})

function windowConditionOf(where: Record<string | symbol, unknown>): string | null {
  const [key] = Object.getOwnPropertySymbols(where)
  if (!key) return null
  return RawQueryFragment.getKnownFragment(key)?.sql ?? null
}

describe('GET /api/property_management/unavailabilities total', () => {
  it('counts truncated active rows with the same filters it lists, including the void-window condition', async () => {
    const em = new FakeEm()
    for (let index = 0; index < 501; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0')
      seedClosure(em, `closure-${index}`, { startsAt: `2099-12-${day}T00:00:00` })
    }
    mockContext.em = em
    const find = jest.spyOn(em, 'find')
    const count = jest.spyOn(em, 'count')
    const response = await GET(new Request('http://localhost/api/property_management/unavailabilities?active=true'))
    const body = (await response.json()) as { total: number; truncated: boolean }
    expect(body).toMatchObject({ total: 501, truncated: true })
    const listed = find.mock.calls[0][1] as Record<string | symbol, unknown>
    const counted = count.mock.calls[0][1] as Record<string | symbol, unknown>
    expect(windowConditionOf(listed)).toContain('least("ends_at", "ended_at") > "starts_at"')
    expect(windowConditionOf(counted)).toContain('least("ends_at", "ended_at") > "starts_at"')
    expect(counted.$and).toEqual(listed.$and)
  })

  it('returns as many items as the counted predicate matches, up to the cap, with no extra in-memory filter', async () => {
    const em = new FakeEm()
    seedClosure(em, 'void-a', { startsAt: '2099-11-01T10:00:00', endsAt: '2099-11-01T10:00:00' })
    seedClosure(em, 'void-b', { startsAt: '2099-11-02T10:00:00', endsAt: '2099-11-02T10:00:00' })
    for (let index = 0; index < 501; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0')
      seedClosure(em, `closure-${index}`, { startsAt: `2099-12-${day}T00:00:00` })
    }
    mockContext.em = em
    const response = await GET(new Request('http://localhost/api/property_management/unavailabilities?active=true'))
    const body = (await response.json()) as { items: Array<{ id: string }>; total: number; truncated: boolean }
    expect(body.truncated).toBe(true)
    expect(body.items).toHaveLength(Math.min(500, body.total))
    expect(body.total).toBe(await em.count(Unavailability, {}))
  })

  it('adds no void-window condition when listing every period', async () => {
    const em = new FakeEm()
    seedClosure(em, 'closure', { startsAt: '2099-12-01T00:00:00' })
    mockContext.em = em
    const find = jest.spyOn(em, 'find')
    await GET(new Request('http://localhost/api/property_management/unavailabilities?active=false'))
    expect(windowConditionOf(find.mock.calls[0][1] as Record<string | symbol, unknown>)).toBeNull()
  })
})

describe('POST /api/property_management/unavailabilities validation', () => {
  it('returns translated field errors and no raw zod issues', async () => {
    jest.mocked(resolveStaffContext).mockResolvedValueOnce({
      em: new FakeEm(),
      tenantId: TENANT,
      organizationId: ORG,
      permitted: null,
      translate: (key: string, fallback?: string) => `t:${key}:${fallback ?? ''}`,
    } as never)
    const response = await POST(
      new Request('http://localhost/api/property_management/unavailabilities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectType: 'unit', subjectId: UNIT, startsAt: '2099-01-02T10:00', endsAt: '2099-01-01T10:00', reasonText: '' }),
      }),
    )
    expect(response.status).toBe(422)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('issues')
    expect(body.fieldErrors).toEqual({
      endsAt: 't:property_management.errors.unavailabilityRangeInvalid:t:property_management.errors.invalidInput:Invalid input',
      reasonText: 't:property_management.errors.invalidInput:Invalid input',
    })
  })
})
