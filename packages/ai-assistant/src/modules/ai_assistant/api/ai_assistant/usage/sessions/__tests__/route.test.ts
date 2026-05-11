const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const executeMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

import { GET } from '../route'

function buildRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/ai_assistant/usage/sessions')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new Request(url.toString(), { method: 'GET' })
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    agent_id: 'catalog.assistant',
    module_id: 'catalog',
    user_id: 'user-1',
    started_at: new Date('2026-05-01T12:00:00Z'),
    last_event_at: new Date('2026-05-01T12:01:00Z'),
    step_count: '3',
    turn_count: '1',
    input_tokens: '100',
    output_tokens: '50',
    cached_input_tokens: '0',
    reasoning_tokens: '0',
    ...overrides,
  }
}

describe('GET /api/ai_assistant/usage/sessions', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.settings.manage'], isSuperAdmin: false })
    executeMock.mockResolvedValue([])
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') {
          return {
            loadAcl: loadAclMock,
            hasAllFeatures: (required: string[], have: string[]) =>
              required.every((feature) => have.includes(feature)),
          }
        }
        if (name === 'em') return { getConnection: () => ({ execute: executeMock }) }
        throw new Error(`Unknown token: ${name}`)
      },
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null)
    const res = await GET(buildRequest({ from: '2026-05-01', to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(401)
  })

  it('returns 403 when the caller lacks ai_assistant.settings.manage', async () => {
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.view'], isSuperAdmin: false })
    const res = await GET(buildRequest({ from: '2026-05-01', to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(403)
  })

  it('returns 400 when from is missing', async () => {
    const res = await GET(buildRequest({ to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_error')
  })

  it('returns 400 when limit is out of range', async () => {
    const res = await GET(
      buildRequest({ from: '2026-05-01', to: '2026-05-31', limit: '1000' }) as Parameters<typeof GET>[0],
    )
    expect(res.status).toBe(400)
  })

  it('returns 200 with empty sessions when no data exists', async () => {
    executeMock.mockImplementation(async (sql: string) => {
      if (sql.includes('count(distinct session_id)')) return [{ total: '0' }]
      return []
    })
    const res = await GET(buildRequest({ from: '2026-05-01', to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toEqual([])
    expect(body.total).toBe(0)
    expect(body.limit).toBe(100)
    expect(body.offset).toBe(0)
  })

  it('returns 200 with paginated serialized sessions', async () => {
    executeMock.mockImplementation(async (sql: string) => {
      if (sql.includes('count(distinct session_id)')) return [{ total: '5' }]
      return [makeSessionRow(), makeSessionRow({ session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })]
    })
    const res = await GET(
      buildRequest({ from: '2026-05-01', to: '2026-05-31', limit: '10', offset: '0' }) as Parameters<typeof GET>[0],
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toHaveLength(2)
    expect(body.sessions[0].sessionId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(body.sessions[0].stepCount).toBe(3)
    expect(body.sessions[0].turnCount).toBe(1)
    expect(body.total).toBe(5)
    expect(body.limit).toBe(10)
  })

  it('passes agentId filter to the SQL connection', async () => {
    executeMock.mockImplementation(async (sql: string) => {
      if (sql.includes('count(distinct session_id)')) return [{ total: '0' }]
      return []
    })
    const res = await GET(
      buildRequest({ from: '2026-05-01', to: '2026-05-31', agentId: 'catalog.assistant' }) as Parameters<typeof GET>[0],
    )
    expect(res.status).toBe(200)
    // Both the count and data queries MUST receive agentId in their bound params
    const countCall = executeMock.mock.calls.find((call) =>
      typeof call[0] === 'string' && (call[0] as string).includes('count(distinct session_id)'),
    )
    expect(countCall).toBeDefined()
    expect(countCall![1]).toContain('catalog.assistant')
  })

  it('allows superadmin to bypass feature check', async () => {
    loadAclMock.mockResolvedValue({ features: [], isSuperAdmin: true })
    executeMock.mockImplementation(async (sql: string) => {
      if (sql.includes('count(distinct session_id)')) return [{ total: '0' }]
      return []
    })
    const res = await GET(buildRequest({ from: '2026-05-01', to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(200)
  })

  it('returns 500 when the database throws', async () => {
    executeMock.mockRejectedValue(new Error('DB unreachable'))
    const res = await GET(buildRequest({ from: '2026-05-01', to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('internal_error')
  })
})
