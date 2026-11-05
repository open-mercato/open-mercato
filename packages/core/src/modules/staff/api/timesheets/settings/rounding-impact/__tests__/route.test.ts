/** @jest-environment node */
/**
 * The impact preview is the only thing standing between a rounding change and a
 * surprised client, so what it excludes matters as much as what it counts.
 */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const configStore = new Map<string, unknown>()

const moduleConfigService = {
  async getRecord(moduleId: string, name: string, scope?: { tenantId?: string | null }) {
    const key = `${scope?.tenantId ?? 'global'}::${name}`
    if (!configStore.has(key)) return null
    return { moduleId, name, value: configStore.get(key) ?? null, source: 'tenant' as const }
  },
  async setValue() {
    return null
  },
}

const execute = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') return moduleConfigService
    if (name === 'em') return { getConnection: () => ({ execute }) }
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = { tenantId, sub: userId, orgId: organizationId }
let organizationScope: Record<string, unknown> | null = {
  tenantId,
  selectedId: organizationId,
  filterIds: [organizationId],
  allowedIds: [organizationId],
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => organizationScope),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

import { GET, metadata, DEFAULT_IMPACT_WINDOW_DAYS } from '../route'

function request(query = ''): Request {
  return new Request(`http://localhost/api/staff/timesheets/settings/rounding-impact${query}`)
}

function respondWith(buckets: Array<{ duration_minutes: number; entry_count: number }>, lockedCount = 0) {
  execute.mockReset()
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes('locked_report_id IS NOT NULL')) return [{ locked_count: lockedCount }]
    return buckets
  })
}

describe('rounding impact route', () => {
  beforeEach(() => {
    configStore.clear()
    container.resolve.mockClear()
    authValue = { tenantId, sub: userId, orgId: organizationId }
    organizationScope = {
      tenantId,
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
    }
    respondWith([])
  })

  it('is gated on the settings manage feature', () => {
    expect(metadata.GET.requireFeatures).toEqual(['staff.timesheets.settings.manage'])
  })

  it('rejects an unauthenticated caller', async () => {
    authValue = null
    const response = await GET(request())
    expect(response.status).toBe(401)
  })

  it('projects the candidate rule over a 90 day window by default', async () => {
    respondWith([
      { duration_minutes: 62, entry_count: 2 },
      { duration_minutes: 120, entry_count: 1 },
    ])

    const response = await GET(request('?unitMinutes=15&direction=up'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.windowDays).toBe(DEFAULT_IMPACT_WINDOW_DAYS)
    expect(body.rounding).toEqual({ unitMinutes: 15, direction: 'up' })
    expect(body.projected).toEqual({
      entryCount: 3,
      rawMinutes: 62 * 2 + 120,
      roundedMinutes: 75 * 2 + 120,
      deltaMinutes: 26,
    })
  })

  it('answers with the stored rule as the current column, so the screen can show the move', async () => {
    configStore.set(`${tenantId}::rounding.unitMinutes`, 0)
    respondWith([{ duration_minutes: 62, entry_count: 1 }])

    const body = await (await GET(request('?unitMinutes=15&direction=up'))).json()

    expect(body.current).toEqual({ entryCount: 1, rawMinutes: 62, roundedMinutes: 62, deltaMinutes: 0 })
    expect(body.projected.roundedMinutes).toBe(75)
  })

  it('falls back to the stored rule when the query names none', async () => {
    configStore.set(`${tenantId}::rounding.unitMinutes`, 10)
    configStore.set(`${tenantId}::rounding.direction`, 'nearest')
    respondWith([{ duration_minutes: 62, entry_count: 1 }])

    const body = await (await GET(request())).json()

    expect(body.rounding).toEqual({ unitMinutes: 10, direction: 'nearest' })
    expect(body.projected.roundedMinutes).toBe(60)
  })

  it('ignores a rounding unit the rule does not have', async () => {
    respondWith([{ duration_minutes: 62, entry_count: 1 }])
    const body = await (await GET(request('?unitMinutes=7'))).json()
    expect(body.rounding.unitMinutes).toBe(0)
  })

  it('excludes locked entries from the projection and reports them separately', async () => {
    respondWith([{ duration_minutes: 62, entry_count: 4 }], 9)

    const body = await (await GET(request('?unitMinutes=15&direction=up'))).json()

    expect(body.projected.entryCount).toBe(4)
    expect(body.lockedEntryCount).toBe(9)

    const projectionSql = execute.mock.calls.find(([sql]) => String(sql).includes('GROUP BY'))?.[0]
    expect(String(projectionSql)).toContain('locked_report_id IS NULL')
  })

  it('scopes every query to the caller tenant and organizations', async () => {
    respondWith([])
    await GET(request())

    for (const [sql, params] of execute.mock.calls) {
      expect(String(sql)).toContain('tenant_id = ?')
      expect(String(sql)).toContain('organization_id IN (?)')
      expect(params[0]).toBe(tenantId)
      expect(params).toContain(organizationId)
    }
  })

  it('covers every organization of the tenant when the caller is not narrowed to one', async () => {
    organizationScope = { tenantId, selectedId: null, filterIds: null, allowedIds: null }
    respondWith([])
    await GET(request())

    for (const [sql] of execute.mock.calls) {
      expect(String(sql)).not.toContain('organization_id IN (')
    }
  })

  it('honours an explicit window', async () => {
    respondWith([])
    const body = await (await GET(request('?windowDays=30'))).json()
    expect(body.windowDays).toBe(30)
    expect(new Date(body.to).getTime() - new Date(body.from).getTime()).toBe(29 * 24 * 60 * 60 * 1000)
  })

  it('rejects a window outside the allowed range', async () => {
    const response = await GET(request('?windowDays=4000'))
    expect(response.status).toBe(400)
  })

  it('returns zeroes rather than failing on an empty window', async () => {
    respondWith([])
    const body = await (await GET(request())).json()
    expect(body.projected).toEqual({ entryCount: 0, rawMinutes: 0, roundedMinutes: 0, deltaMinutes: 0 })
  })

  it('reports a projection failure as a 500 without leaking the cause', async () => {
    execute.mockReset()
    execute.mockRejectedValue(new Error('[internal] db down'))

    const response = await GET(request())
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Internal server error')
  })
})
