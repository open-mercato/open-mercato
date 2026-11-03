/** @jest-environment node */
import { GET as listActions } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/route'
import { GET as exportActions } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/export/route'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'

type QueryWindow = { limit: number | null; offset: number | null }

const TOTAL_ROWS = 480
const recordedWindows: QueryWindow[] = []

function createRecordingKysely() {
  return {
    selectFrom() {
      const window: QueryWindow = { limit: null, offset: null }
      const builder: Record<string, unknown> = {}
      const proxy: unknown = new Proxy(builder, {
        get(_target, property) {
          if (property === 'then') return undefined
          if (property === 'limit') {
            return (value: number) => {
              window.limit = value
              return proxy
            }
          }
          if (property === 'offset') {
            return (value: number) => {
              window.offset = value
              return proxy
            }
          }
          if (property === 'execute') {
            return async () => {
              recordedWindows.push(window)
              return []
            }
          }
          if (property === 'executeTakeFirst') return async () => ({ count: TOTAL_ROWS })
          return () => proxy
        },
      })
      return proxy
    },
  }
}

const mockRbac = { userHasAllFeatures: jest.fn() }
const mockEm = { getKysely: () => createRecordingKysely(), find: jest.fn(async () => []) }
const actionLogService = new ActionLogService(mockEm as unknown as ConstructorParameters<typeof ActionLogService>[0])

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'rbacService') return mockRbac
      if (token === 'actionLogService') return actionLogService
      if (token === 'em') return mockEm
      return null
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/audit_logs/api/audit-logs/display', () => ({
  loadAuditLogDisplayMaps: jest.fn(),
}))

const LIST_URL = 'http://localhost/api/audit_logs/audit-logs/actions'
const EXPORT_URL = 'http://localhost/api/audit_logs/audit-logs/actions/export'

async function requestList(queryString: string) {
  const res = await listActions(new Request(`${LIST_URL}${queryString}`, { method: 'GET' }))
  expect(res.status).toBe(200)
  expect(recordedWindows).toHaveLength(1)
  return { window: recordedWindows[0], body: await res.json() }
}

describe('action log list pagination window', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    recordedWindows.length = 0
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      orgId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
    })
    const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
      scope: { allowedIds: null },
    })
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
  })

  it('reads the default window when no pagination parameter is sent', async () => {
    const { window, body } = await requestList('')
    expect(window).toEqual({ limit: 50, offset: 0 })
    expect(body).toMatchObject({ page: 1, pageSize: 50, total: TOTAL_ROWS, totalPages: 10 })
  })

  it('moves the window forward for page-based requests', async () => {
    const { window, body } = await requestList('?page=3&pageSize=25')
    expect(window).toEqual({ limit: 25, offset: 50 })
    expect(body).toMatchObject({ page: 3, pageSize: 25, total: TOTAL_ROWS, totalPages: 20 })
  })

  it('keeps the default page size when only the page is sent', async () => {
    const { window } = await requestList('?page=2')
    expect(window).toEqual({ limit: 50, offset: 50 })
  })

  it('honors limit when no page size is sent', async () => {
    const { window, body } = await requestList('?limit=20')
    expect(window).toEqual({ limit: 20, offset: 0 })
    expect(body.pageSize).toBe(20)
  })

  it('honors a limit above the page size ceiling up to its own maximum', async () => {
    const { window } = await requestList('?limit=5000')
    expect(window).toEqual({ limit: 1000, offset: 0 })
  })

  it('honors legacy limit and offset windows', async () => {
    const { window } = await requestList('?limit=50&offset=100')
    expect(window).toEqual({ limit: 50, offset: 100 })
  })

  it('lets an explicit offset override the page and an explicit page size override the limit', async () => {
    const { window } = await requestList('?page=4&pageSize=10&limit=30&offset=7')
    expect(window).toEqual({ limit: 10, offset: 7 })
  })

  it('still supports page size with an explicit offset', async () => {
    const { window } = await requestList('?pageSize=1&offset=1')
    expect(window).toEqual({ limit: 1, offset: 1 })
  })

  it('combines a page with a limit when no page size is sent', async () => {
    const { window } = await requestList('?page=3&limit=20')
    expect(window).toEqual({ limit: 20, offset: 40 })
  })

  it('keeps echoing the requested page when an explicit offset wins', async () => {
    const { window, body } = await requestList('?page=2&offset=0')
    expect(window).toEqual({ limit: 50, offset: 0 })
    expect(body.page).toBe(2)
  })

  it('falls back to the defaults for malformed pagination values', async () => {
    const { window, body } = await requestList('?page=abc&pageSize=&limit=x&offset=y')
    expect(window).toEqual({ limit: 50, offset: 0 })
    expect(body).toMatchObject({ page: 1, pageSize: 50 })
  })

  it('treats blank pagination values as absent', async () => {
    const { window } = await requestList('?page=&pageSize=%20&limit=&offset=')
    expect(window).toEqual({ limit: 50, offset: 0 })
  })

  it('clamps out-of-range values instead of rejecting them', async () => {
    const { window } = await requestList('?page=0&pageSize=999')
    expect(window).toEqual({ limit: 200, offset: 0 })
    recordedWindows.length = 0
    const legacy = await requestList('?limit=0&offset=-5')
    expect(legacy.window).toEqual({ limit: 1, offset: 0 })
  })

  it('returns an empty page with the real total beyond the last page', async () => {
    const { window, body } = await requestList('?page=11&pageSize=50')
    expect(window).toEqual({ limit: 50, offset: 500 })
    expect(body).toMatchObject({ items: [], page: 11, total: TOTAL_ROWS, totalPages: 10 })
  })

  it('exports up to 1000 rows by default', async () => {
    const res = await exportActions(new Request(EXPORT_URL, { method: 'GET' }))
    expect(res.status).toBe(200)
    expect(recordedWindows).toEqual([{ limit: 1000, offset: 0 }])
  })

  it('exports the requested number of rows', async () => {
    const res = await exportActions(new Request(`${EXPORT_URL}?limit=300`, { method: 'GET' }))
    expect(res.status).toBe(200)
    expect(recordedWindows).toEqual([{ limit: 300, offset: 0 }])
  })
})
