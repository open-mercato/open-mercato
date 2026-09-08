import type { NextRequest } from 'next/server'

const authMock = jest.fn()
const createRequestContainerMock = jest.fn()
const loadAclMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../../lib/agent-registry', () => ({
  loadAgentRegistry: jest.fn(async () => undefined),
  listAgents: jest.fn(() => []),
  isAgentTaskPlanEnabled: jest.fn(() => false),
}))

import { GET } from '../route'

const ORIGINAL_ENV = process.env

function envWithoutProviderKeys(): NodeJS.ProcessEnv {
  const stripped: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (/API_KEY/i.test(key)) continue
    stripped[key] = value
  }
  return stripped
}

async function callGet(): Promise<{ status: number; body: { aiConfigured?: boolean } }> {
  const response = await GET({} as NextRequest)
  return { status: response.status, body: await response.json() }
}

describe('GET /api/ai_assistant/ai/agents — aiConfigured', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = envWithoutProviderKeys()
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.view'], isSuperAdmin: false })
    createRequestContainerMock.mockResolvedValue({
      resolve: () => ({ loadAcl: loadAclMock }),
    })
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('reports aiConfigured true on a cold process when a provider key is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key'

    const { status, body } = await callGet()

    expect(status).toBe(200)
    expect(body.aiConfigured).toBe(true)
  })

  it('reports aiConfigured false when no provider key is set', async () => {
    const { status, body } = await callGet()

    expect(status).toBe(200)
    expect(body.aiConfigured).toBe(false)
  })
})
