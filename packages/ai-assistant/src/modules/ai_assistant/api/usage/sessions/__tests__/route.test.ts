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

function defaultParams(overrides: Record<string, string> = {}) {
  return {
    from: '2026-05-01',
    to: '2026-05-31',
    ...overrides,
  }
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: '11111111-1111-4111-8111-111111111111',
    agent_id: 'catalog.assistant',
    module_id: 'catalog',
    user_id: '22222222-2222-4222-8222-222222222222',
    started_at: '2026-05-01T12:00:00.000Z',
    last_event_at: '2026-05-01T12:30:00.000Z',
    step_count: 5n,
    turn_count: 3n,
    input_tokens: 1000n,
    output_tokens: 500n,
    cached_input_tokens: 10n,
    reasoning_tokens: 20n,
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
    executeMock
      .mockResolvedValueOnce([{ total: 1n }])
      .mockResolvedValueOnce([makeSessionRow()])
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') return { loadAcl: loadAclMock, hasAllFeatures: (req: string[], have: string[]) => req.every((r) => have.includes(r)) }
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
    const res = await GET(buildRequest(defaultParams()) as Parameters<typeof GET>[0])
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller lacks ai_assistant.settings.manage', async () => {
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.view'], isSuperAdmin: false })
    const res = await GET(buildRequest(defaultParams()) as Parameters<typeof GET>[0])
    expect(res.status).toBe(403)
  })

  it('returns 400 when from is missing', async () => {
    const res = await GET(buildRequest({ to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_error')
  })

  it('serializes bigint aggregates and string timestamps returned by the database driver', async () => {
    const res = await GET(buildRequest(defaultParams({ limit: '50', offset: '0' })) as Parameters<typeof GET>[0])

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0]).toMatchObject({
      sessionId: '11111111-1111-4111-8111-111111111111',
      agentId: 'catalog.assistant',
      moduleId: 'catalog',
      userId: '22222222-2222-4222-8222-222222222222',
      startedAt: '2026-05-01T12:00:00.000Z',
      lastEventAt: '2026-05-01T12:30:00.000Z',
      stepCount: 5,
      turnCount: 3,
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 10,
      reasoningTokens: 20,
    })
  })

  it('passes the agent filter to the aggregate queries', async () => {
    const res = await GET(buildRequest(defaultParams({ agentId: 'catalog.assistant' })) as Parameters<typeof GET>[0])

    expect(res.status).toBe(200)
    expect(executeMock.mock.calls[0][1]).toEqual(['tenant-1', '2026-05-01', '2026-05-31', 'catalog.assistant'])
    expect(executeMock.mock.calls[1][1]).toEqual(['tenant-1', '2026-05-01', '2026-05-31', 'catalog.assistant', 100, 0])
  })
})
