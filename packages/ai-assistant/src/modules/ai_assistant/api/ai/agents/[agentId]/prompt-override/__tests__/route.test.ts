import type { AiAgentDefinition } from '../../../../../../lib/ai-agent-definition'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../../../../../../lib/agent-registry'

const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

import { POST } from '../route'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    ...overrides,
  }
}

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/ai_assistant/ai/agents/catalog.assistant/prompt-override', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildParams(agentId: string) {
  return { params: Promise.resolve({ agentId }) }
}

describe('POST /api/ai_assistant/ai/agents/:agentId/prompt-override (placeholder)', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    loadAclMock.mockResolvedValue({
      features: ['ai_assistant.settings.manage'],
      isSuperAdmin: false,
    })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') {
          return {
            loadAcl: loadAclMock,
            hasAllFeatures: (required: string[], granted: string[]) =>
              required.every((feature) => granted.includes(feature)),
          }
        }
        return null
      },
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null)

    const response = await POST(
      buildRequest({ overrides: {} }) as any,
      buildParams('catalog.assistant'),
    )

    expect(response.status).toBe(401)
    const json = await response.json()
    expect(json.code).toBe('unauthenticated')
  })

  it('returns 403 when the caller lacks ai_assistant.settings.manage', async () => {
    loadAclMock.mockResolvedValueOnce({
      features: ['ai_assistant.view'],
      isSuperAdmin: false,
    })
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
    ])

    const response = await POST(
      buildRequest({ overrides: { role: 'You are friendly.' } }) as any,
      buildParams('catalog.assistant'),
    )

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.code).toBe('forbidden')
  })

  it('returns 404 for an unknown agent id', async () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
    ])

    const response = await POST(
      buildRequest({ overrides: {} }) as any,
      buildParams('catalog.missing'),
    )

    expect(response.status).toBe(404)
    const json = await response.json()
    expect(json.code).toBe('agent_unknown')
  })

  it('returns 400 when body is not JSON-shaped as expected', async () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
    ])

    const response = await POST(
      buildRequest({ overrides: 'not-an-object' }) as any,
      buildParams('catalog.assistant'),
    )

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('validation_error')
  })

  it('returns 400 when the agentId param is malformed', async () => {
    const response = await POST(
      buildRequest({ overrides: {} }) as any,
      buildParams('NotAValidId'),
    )

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('validation_error')
  })

  it('returns 200 with pending:true on success', async () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
    ])

    const response = await POST(
      buildRequest({
        overrides: {
          role: 'You are a friendly product expert.',
          scope: 'Answer catalog questions only.',
        },
      }) as any,
      buildParams('catalog.assistant'),
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toEqual({
      pending: true,
      agentId: 'catalog.assistant',
      message: 'Persistence lands in Phase 3 Step 5.3.',
    })
  })

  it('returns 200 when the caller is a super admin even without the specific feature', async () => {
    loadAclMock.mockResolvedValueOnce({
      features: [],
      isSuperAdmin: true,
    })
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
    ])

    const response = await POST(
      buildRequest({ overrides: {} }) as any,
      buildParams('catalog.assistant'),
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.pending).toBe(true)
  })
})
