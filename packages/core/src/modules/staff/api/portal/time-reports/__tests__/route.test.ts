/**
 * EP-50 — the customer-portal report surface, and the one thing it must never get
 * wrong.
 *
 * This is the only time-tracking surface reachable by a person who is not an
 * employee, so the assertions below are about ownership and disclosure rather than
 * about shape:
 *
 *  - every query carries `tenant_id`, `organization_id`, `customer_id` and
 *    `status = 'closed'` — all four, in the same WHERE clause, taken from the
 *    session and never from the request;
 *  - a report id belonging to another customer of the same organization is a
 *    `404`, not a `403`, because a `403` confirms it exists;
 *  - the response carries no rate, cost, amount or currency, at all, ever.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION = '22222222-2222-4222-8222-222222222222'
const OWN_CUSTOMER = '33333333-3333-4333-8333-333333333333'
const REPORT_ID = '44444444-4444-4444-8444-444444444444'
const FOREIGN_REPORT_ID = '55555555-5555-4555-8555-555555555555'

type ExecuteCall = { sql: string; params: unknown[] }

const executeCalls: ExecuteCall[] = []

let customerAuthValue: Record<string, unknown> | null = {
  sub: 'customer-user-1',
  sid: 'session-1',
  type: 'customer',
  tenantId: TENANT,
  orgId: ORGANIZATION,
  email: 'client@example.com',
  displayName: 'Client',
  customerEntityId: OWN_CUSTOMER,
  resolvedFeatures: ['portal.time_reports.view'],
}

let grantedPortalFeatures: string[] = ['portal.time_reports.view']

const reportRow = {
  id: REPORT_ID,
  reference: 'RAP-2026-001',
  title: 'January delivery',
  period_from: '2026-01-01',
  period_to: '2026-01-31',
  closed_at: '2026-02-01T09:00:00.000Z',
  total_billable_minutes: 480,
  total_nonbillable_minutes: 60,
}

function rowsFor(sql: string, params: unknown[]): unknown[] {
  const normalized = sql.replace(/\s+/g, ' ').trim()
  if (normalized.startsWith('SELECT COUNT(*)')) return [{ total: 1 }]
  if (normalized.includes('FROM staff_time_report_entries')) {
    return [
      {
        time_project_id: '66666666-6666-4666-8666-666666666666',
        project_name: 'Migration',
        billable_minutes: 480,
        nonbillable_minutes: 60,
      },
    ]
  }
  if (normalized.includes('FROM staff_time_reports')) {
    const requestedId = params[params.length - 1]
    if (normalized.includes('AND id = ?')) {
      return requestedId === REPORT_ID ? [reportRow] : []
    }
    return [reportRow]
  }
  return []
}

const connection = {
  execute: jest.fn(async (sql: string, params: unknown[] = []) => {
    executeCalls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
    return rowsFor(sql, params)
  }),
}

const em = { fork: () => em, getConnection: () => connection }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'customerRbacService') {
      return {
        userHasAllFeatures: async (_userId: string, required: string[]) =>
          required.every((feature) => grantedPortalFeatures.includes(feature)),
      }
    }
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: jest.fn(async () => customerAuthValue),
  requireCustomerFeature: jest.fn(
    async (
      auth: { sub: string },
      features: string[],
      rbac: { userHasAllFeatures: (userId: string, required: string[]) => Promise<boolean> },
    ) => {
      const ok = await rbac.userHasAllFeatures(auth.sub, features)
      if (!ok) {
        throw new Response(JSON.stringify({ ok: false, error: 'Insufficient permissions' }), { status: 403 })
      }
    },
  ),
}))

import { GET as listReports } from '../route'
import { GET as readReport } from '../[id]/route'

const MONEY_KEY_PATTERN = /(rate|cost|amount|currency)/i

function assertNoMoney(value: unknown, path = 'response'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoMoney(item, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const isMinutes = /Minutes$/.test(key)
      expect({ path: `${path}.${key}`, money: !isMinutes && MONEY_KEY_PATTERN.test(key) }).toEqual({
        path: `${path}.${key}`,
        money: false,
      })
      assertNoMoney(nested, `${path}.${key}`)
    }
  }
}

beforeEach(() => {
  executeCalls.length = 0
  connection.execute.mockClear()
  grantedPortalFeatures = ['portal.time_reports.view']
  customerAuthValue = {
    sub: 'customer-user-1',
    sid: 'session-1',
    type: 'customer',
    tenantId: TENANT,
    orgId: ORGANIZATION,
    email: 'client@example.com',
    displayName: 'Client',
    customerEntityId: OWN_CUSTOMER,
    resolvedFeatures: ['portal.time_reports.view'],
  }
})

describe('GET /api/staff/portal/time-reports', () => {
  it('scopes every query by tenant, organization, customer and closed status', async () => {
    const response = await listReports(new Request('http://localhost/api/staff/portal/time-reports'))
    expect(response.status).toBe(200)

    expect(executeCalls.length).toBeGreaterThan(0)
    for (const call of executeCalls) {
      expect(call.sql).toContain('tenant_id = ?')
      expect(call.sql).toContain('organization_id = ?')
      expect(call.sql).toContain('customer_id = ?')
      expect(call.sql).toContain("status = 'closed'")
      expect(call.sql).toContain('deleted_at IS NULL')
      expect(call.params.slice(0, 3)).toEqual([TENANT, ORGANIZATION, OWN_CUSTOMER])
    }
  })

  it('returns hours and no money', async () => {
    const response = await listReports(new Request('http://localhost/api/staff/portal/time-reports'))
    const body = await response.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ reference: 'RAP-2026-001', totalBillableMinutes: 480 })
    assertNoMoney(body)
  })

  it('refuses a portal session with no customer entity', async () => {
    customerAuthValue = { ...(customerAuthValue as Record<string, unknown>), customerEntityId: null }
    const response = await listReports(new Request('http://localhost/api/staff/portal/time-reports'))
    expect(response.status).toBe(403)
    expect(connection.execute).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    customerAuthValue = null
    const response = await listReports(new Request('http://localhost/api/staff/portal/time-reports'))
    expect(response.status).toBe(401)
    expect(connection.execute).not.toHaveBeenCalled()
  })

  it('refuses a portal role without the feature', async () => {
    grantedPortalFeatures = []
    const response = await listReports(new Request('http://localhost/api/staff/portal/time-reports'))
    expect(response.status).toBe(403)
    expect(connection.execute).not.toHaveBeenCalled()
  })
})

describe('GET /api/staff/portal/time-reports/[id]', () => {
  it('reads the caller’s own report', async () => {
    const response = await readReport(
      new Request(`http://localhost/api/staff/portal/time-reports/${REPORT_ID}`),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ id: REPORT_ID, reference: 'RAP-2026-001' })
    expect(body.projects).toHaveLength(1)
    assertNoMoney(body)
  })

  /**
   * The id in the path is caller-supplied. The report is loaded WITH the
   * ownership predicates rather than loaded and then checked, so a foreign id
   * cannot be read even for a moment.
   */
  it('answers 404 for another customer’s report, without confirming it exists', async () => {
    const response = await readReport(
      new Request(`http://localhost/api/staff/portal/time-reports/${FOREIGN_REPORT_ID}`),
    )
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body).toEqual({ ok: false, error: 'staff.errors.notFound' })
    const reportQuery = executeCalls.find((call) => call.sql.includes('FROM staff_time_reports'))
    expect(reportQuery?.sql).toContain('customer_id = ?')
    expect(reportQuery?.params).toEqual([TENANT, ORGANIZATION, OWN_CUSTOMER, FOREIGN_REPORT_ID])
  })

  it('scopes the project breakdown to the same tenant and organization', async () => {
    await readReport(new Request(`http://localhost/api/staff/portal/time-reports/${REPORT_ID}`))
    const breakdown = executeCalls.find((call) => call.sql.includes('FROM staff_time_report_entries'))
    expect(breakdown).toBeDefined()
    expect(breakdown?.sql).toContain('line.tenant_id = ?')
    expect(breakdown?.sql).toContain('line.organization_id = ?')
    expect(breakdown?.params).toEqual([REPORT_ID, TENANT, ORGANIZATION])
    expect(breakdown?.sql).not.toContain('frozen_amount')
    expect(breakdown?.sql).not.toContain('frozen_rate_amount')
  })

  it('rejects a malformed id before touching the database', async () => {
    const response = await readReport(new Request('http://localhost/api/staff/portal/time-reports/not-a-uuid'))
    expect(response.status).toBe(400)
    expect(connection.execute).not.toHaveBeenCalled()
  })
})
