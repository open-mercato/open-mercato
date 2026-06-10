const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const listMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../data/repositories/AiModerationFlagRepository', () => ({
  AiModerationFlagRepository: jest.fn().mockImplementation(() => ({ list: listMock })),
}))

import { GET } from '../route'

function buildRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/ai_assistant/moderation-flags')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url.toString(), { method: 'GET' })
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flag-1',
    tenantId: 'tenant-1',
    organizationId: null,
    agentId: 'catalog.assistant',
    userId: 'user-9',
    providerId: 'openai',
    modelId: 'gpt-5-mini',
    categories: { hate: { flagged: true, score: 0.97 } },
    createdAt: new Date('2026-06-10T12:00:00Z'),
    ...overrides,
  }
}

describe('GET /api/ai_assistant/moderation-flags', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.settings.manage'], isSuperAdmin: false })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') {
          return {
            loadAcl: loadAclMock,
            hasAllFeatures: (req: string[], have: string[]) => req.every((r) => have.includes(r)),
          }
        }
        if (name === 'em') return {}
        throw new Error(`Unknown token: ${name}`)
      },
    })
    listMock.mockResolvedValue({ items: [], total: 0 })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null)
    const res = await GET(buildRequest() as never)
    expect(res.status).toBe(401)
  })

  it('returns 403 when the caller lacks ai_assistant.settings.manage', async () => {
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.view'], isSuperAdmin: false })
    const res = await GET(buildRequest() as never)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden')
  })

  it('rejects pageSize above the 100 cap with a validation error', async () => {
    const res = await GET(buildRequest({ pageSize: '101' }) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('validation_error')
    expect(listMock).not.toHaveBeenCalled()
  })

  it('lists tenant-scoped rows and echoes pagination', async () => {
    listMock.mockResolvedValue({ items: [makeRow()], total: 1 })
    const res = await GET(buildRequest({ page: '2', pageSize: '25' }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.total).toBe(1)
    expect(json.page).toBe(2)
    expect(json.pageSize).toBe(25)
    expect(json.items[0]).toMatchObject({ id: 'flag-1', userId: 'user-9', categories: { hate: { flagged: true, score: 0.97 } } })
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1', page: 2, pageSize: 25 }),
    )
  })

  it('passes agentId/userId/date filters through to the repository', async () => {
    await GET(buildRequest({ agentId: 'catalog.assistant', userId: 'user-9', from: '2026-06-01', to: '2026-06-10' }) as never)
    const call = listMock.mock.calls[0][0]
    expect(call.agentId).toBe('catalog.assistant')
    expect(call.userId).toBe('user-9')
    expect(call.from).toBeInstanceOf(Date)
    expect(call.to).toBeInstanceOf(Date)
    // `to` is extended to end-of-day so same-day rows are included.
    expect((call.to as Date).toISOString()).toBe('2026-06-10T23:59:59.999Z')
  })

  it('returns an empty page (no repo call) when the caller has no tenant scope', async () => {
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: null, orgId: null })
    const res = await GET(buildRequest() as never)
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
    expect(listMock).not.toHaveBeenCalled()
  })
})
