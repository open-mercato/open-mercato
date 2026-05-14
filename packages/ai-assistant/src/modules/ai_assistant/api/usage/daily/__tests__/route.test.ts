const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const listDailyRollupMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../../data/repositories/AiTokenUsageRepository', () => ({
  AiTokenUsageRepository: jest.fn().mockImplementation(() => ({
    listDailyRollup: listDailyRollupMock,
  })),
}))

import { GET } from '../route'

function buildRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/ai_assistant/usage/daily')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new Request(url.toString(), { method: 'GET' })
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    tenantId: 'tenant-1',
    organizationId: null,
    day: '2026-05-01',
    agentId: 'catalog.assistant',
    modelId: 'claude-haiku-4-5',
    providerId: 'anthropic',
    inputTokens: '1000',
    outputTokens: '500',
    cachedInputTokens: '0',
    reasoningTokens: '0',
    stepCount: '5',
    turnCount: '3',
    sessionCount: '2',
    createdAt: new Date('2026-05-01T12:00:00Z'),
    updatedAt: new Date('2026-05-01T12:00:00Z'),
    ...overrides,
  }
}

describe('GET /api/ai_assistant/usage/daily', () => {
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
    listDailyRollupMock.mockResolvedValue([])
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

  it('returns 400 when from has an invalid date format', async () => {
    const res = await GET(buildRequest({ from: 'not-a-date', to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(400)
  })

  it('returns 200 with empty rows when no data', async () => {
    const res = await GET(buildRequest({ from: '2026-05-01', to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toEqual([])
    expect(body.total).toBe(0)
  })

  it('returns 200 with serialized rows', async () => {
    listDailyRollupMock.mockResolvedValue([makeRow()])
    const res = await GET(buildRequest({ from: '2026-05-01', to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].agentId).toBe('catalog.assistant')
    expect(body.total).toBe(1)
  })

  it('serializes bigint counters and string timestamps returned by the database driver', async () => {
    listDailyRollupMock.mockResolvedValue([
      makeRow({
        inputTokens: 1000n,
        outputTokens: 500n,
        cachedInputTokens: 10n,
        reasoningTokens: 20n,
        stepCount: 5n,
        turnCount: 3n,
        sessionCount: 2n,
        createdAt: '2026-05-01T12:00:00.000Z',
        updatedAt: '2026-05-01T12:30:00.000Z',
      }),
    ])

    const res = await GET(buildRequest({ from: '2026-05-01', to: '2026-05-31' }) as Parameters<typeof GET>[0])

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows[0]).toMatchObject({
      inputTokens: '1000',
      outputTokens: '500',
      cachedInputTokens: '10',
      reasoningTokens: '20',
      stepCount: '5',
      turnCount: '3',
      sessionCount: '2',
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:30:00.000Z',
    })
  })

  it('passes agentId filter to the repository', async () => {
    const res = await GET(buildRequest({ from: '2026-05-01', to: '2026-05-31', agentId: 'catalog.assistant' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(200)
    expect(listDailyRollupMock).toHaveBeenCalledWith('tenant-1', '2026-05-01', '2026-05-31', { agentId: 'catalog.assistant', modelId: undefined })
  })

  it('allows superadmin to bypass feature check', async () => {
    loadAclMock.mockResolvedValue({ features: [], isSuperAdmin: true })
    const res = await GET(buildRequest({ from: '2026-05-01', to: '2026-05-31' }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(200)
  })
})
