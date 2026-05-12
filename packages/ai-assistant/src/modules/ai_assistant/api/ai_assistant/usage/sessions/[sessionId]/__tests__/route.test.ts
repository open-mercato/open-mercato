const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const listEventsForSessionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../../../../data/repositories/AiTokenUsageRepository', () => ({
  AiTokenUsageRepository: jest.fn().mockImplementation(() => ({
    listEventsForSession: listEventsForSessionMock,
  })),
}))

import { GET } from '../route'

const SESSION_ID = '11111111-1111-4111-8111-111111111111'

function buildRequest() {
  return new Request(`http://localhost/api/ai_assistant/usage/sessions/${SESSION_ID}`, { method: 'GET' })
}

function buildContext(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) }
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    tenantId: 'tenant-1',
    organizationId: null,
    userId: 'user-1',
    agentId: 'catalog.assistant',
    moduleId: 'catalog',
    sessionId: SESSION_ID,
    turnId: '22222222-2222-4222-8222-222222222222',
    stepIndex: 0,
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: null,
    reasoningTokens: null,
    finishReason: 'stop',
    loopAbortReason: null,
    createdAt: new Date('2026-05-01T12:00:00Z'),
    updatedAt: new Date('2026-05-01T12:00:00Z'),
    ...overrides,
  }
}

describe('GET /api/ai_assistant/usage/sessions/[sessionId]', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.settings.manage'], isSuperAdmin: false })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') return { loadAcl: loadAclMock, hasAllFeatures: (req: string[], have: string[]) => req.every((r) => have.includes(r)) }
        if (name === 'em') return {}
        throw new Error(`Unknown token: ${name}`)
      },
    })
    listEventsForSessionMock.mockResolvedValue([])
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null)
    const res = await GET(buildRequest() as Parameters<typeof GET>[0], buildContext(SESSION_ID))
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller lacks ai_assistant.settings.manage', async () => {
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.view'], isSuperAdmin: false })
    const res = await GET(buildRequest() as Parameters<typeof GET>[0], buildContext(SESSION_ID))
    expect(res.status).toBe(403)
  })

  it('returns 400 for an invalid (non-UUID) session id', async () => {
    const res = await GET(buildRequest() as Parameters<typeof GET>[0], buildContext('not-a-uuid'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_error')
  })

  it('returns 404 when no events exist for the session', async () => {
    listEventsForSessionMock.mockResolvedValue([])
    const res = await GET(buildRequest() as Parameters<typeof GET>[0], buildContext(SESSION_ID))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('session_not_found')
  })

  it('returns 200 with serialized events when events exist', async () => {
    listEventsForSessionMock.mockResolvedValue([makeEvent()])
    const res = await GET(buildRequest() as Parameters<typeof GET>[0], buildContext(SESSION_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(1)
    expect(body.events[0].agentId).toBe('catalog.assistant')
    expect(body.events[0].finishReason).toBe('stop')
    expect(body.total).toBe(1)
    expect(body.sessionId).toBe(SESSION_ID)
  })

  it('allows superadmin to bypass feature check', async () => {
    listEventsForSessionMock.mockResolvedValue([makeEvent()])
    loadAclMock.mockResolvedValue({ features: [], isSuperAdmin: true })
    const res = await GET(buildRequest() as Parameters<typeof GET>[0], buildContext(SESSION_ID))
    expect(res.status).toBe(200)
  })
})
