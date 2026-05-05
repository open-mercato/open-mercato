import type { AiAgentDefinition } from '../../../../../../lib/ai-agent-definition'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../../../../../../lib/agent-registry'

const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const repoGetMock = jest.fn()
const repoSetMock = jest.fn()
const repoClearMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../../../../data/repositories/AiAgentMutationPolicyOverrideRepository', () => ({
  AiAgentMutationPolicyOverrideRepository: jest.fn().mockImplementation(() => ({
    get: repoGetMock,
    set: repoSetMock,
    clear: repoClearMock,
  })),
}))

import { DELETE, GET, POST } from '../route'

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

function buildRequest(body: unknown, method: 'GET' | 'POST' | 'DELETE' = 'POST'): Request {
  return new Request(
    'http://localhost/api/ai_assistant/ai/agents/catalog.assistant/mutation-policy',
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    },
  )
}

function buildParams(agentId: string) {
  return { params: Promise.resolve({ agentId }) }
}

describe('mutation-policy route (Step 5.4)', () => {
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
      features: ['ai_assistant.view', 'ai_assistant.settings.manage'],
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
        if (name === 'em') {
          return {}
        }
        return null
      },
    })
    repoGetMock.mockResolvedValue(null)
    repoSetMock.mockImplementation(async (input: any) => ({
      id: 'row-1',
      agentId: input.agentId,
      mutationPolicy: input.mutationPolicy,
      notes: input.notes ?? null,
      createdByUserId: null,
      createdAt: new Date('2026-04-18T00:00:00Z'),
      updatedAt: new Date('2026-04-18T00:00:01Z'),
    }))
    repoClearMock.mockResolvedValue(true)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      authMock.mockResolvedValueOnce(null)
      const response = await GET(
        buildRequest(null, 'GET') as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(401)
    })

    it('returns 404 for an unknown agent id', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
      ])
      const response = await GET(
        buildRequest(null, 'GET') as any,
        buildParams('catalog.missing'),
      )
      expect(response.status).toBe(404)
      const json = await response.json()
      expect(json.code).toBe('agent_unknown')
    })

    it('returns { codeDeclared, override: null } when no override exists', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'catalog.assistant',
          moduleId: 'catalog',
          mutationPolicy: 'confirm-required',
        }),
      ])
      repoGetMock.mockResolvedValueOnce(null)

      const response = await GET(
        buildRequest(null, 'GET') as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.agentId).toBe('catalog.assistant')
      expect(json.codeDeclared).toBe('confirm-required')
      expect(json.override).toBeNull()
    })

    it('returns serialized override when one exists', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'catalog.assistant',
          moduleId: 'catalog',
          mutationPolicy: 'confirm-required',
        }),
      ])
      repoGetMock.mockResolvedValueOnce({
        id: 'row-1',
        agentId: 'catalog.assistant',
        mutationPolicy: 'read-only',
        notes: 'lock it',
        createdByUserId: 'user-1',
        createdAt: new Date('2026-04-17T00:00:00Z'),
        updatedAt: new Date('2026-04-18T00:00:00Z'),
      })

      const response = await GET(
        buildRequest(null, 'GET') as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.codeDeclared).toBe('confirm-required')
      expect(json.override.mutationPolicy).toBe('read-only')
    })
  })

  describe('POST', () => {
    it('returns 401 when unauthenticated', async () => {
      authMock.mockResolvedValueOnce(null)
      const response = await POST(
        buildRequest({ mutationPolicy: 'read-only' }) as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(401)
    })

    it('returns 403 when the caller lacks ai_assistant.settings.manage', async () => {
      loadAclMock.mockResolvedValueOnce({
        features: ['ai_assistant.view'],
        isSuperAdmin: false,
      })
      seedAgentRegistryForTests([
        makeAgent({
          id: 'catalog.assistant',
          moduleId: 'catalog',
          mutationPolicy: 'confirm-required',
        }),
      ])

      const response = await POST(
        buildRequest({ mutationPolicy: 'read-only' }) as any,
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
        buildRequest({ mutationPolicy: 'read-only' }) as any,
        buildParams('catalog.missing'),
      )
      expect(response.status).toBe(404)
    })

    it('returns 400 with validation_error when body is malformed', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
      ])
      const response = await POST(
        buildRequest({ mutationPolicy: 'not-a-valid-policy' }) as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('validation_error')
    })

    it('rejects escalation (read-only agent → confirm-required override) with escalation_not_allowed', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'catalog.assistant',
          moduleId: 'catalog',
          mutationPolicy: 'read-only',
        }),
      ])
      const response = await POST(
        buildRequest({ mutationPolicy: 'confirm-required' }) as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('escalation_not_allowed')
      expect(json.codeDeclared).toBe('read-only')
      expect(json.requested).toBe('confirm-required')
      expect(repoSetMock).not.toHaveBeenCalled()
    })

    it('rejects escalation (destructive-confirm-required agent → confirm-required override)', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'catalog.assistant',
          moduleId: 'catalog',
          mutationPolicy: 'destructive-confirm-required',
        }),
      ])
      const response = await POST(
        buildRequest({ mutationPolicy: 'confirm-required' }) as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('escalation_not_allowed')
    })

    it('accepts a downgrade (confirm-required → read-only) with 200', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'catalog.assistant',
          moduleId: 'catalog',
          mutationPolicy: 'confirm-required',
        }),
      ])
      const response = await POST(
        buildRequest({ mutationPolicy: 'read-only' }) as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.ok).toBe(true)
      expect(json.override.mutationPolicy).toBe('read-only')
      expect(json.codeDeclared).toBe('confirm-required')
      expect(repoSetMock).toHaveBeenCalledTimes(1)
    })

    it('accepts a same-level save (confirm-required → confirm-required) as a no-op override', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'catalog.assistant',
          moduleId: 'catalog',
          mutationPolicy: 'confirm-required',
        }),
      ])
      const response = await POST(
        buildRequest({ mutationPolicy: 'confirm-required' }) as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(200)
    })
  })

  describe('DELETE', () => {
    it('returns 401 when unauthenticated', async () => {
      authMock.mockResolvedValueOnce(null)
      const response = await DELETE(
        buildRequest(null, 'DELETE') as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(401)
    })

    it('returns 403 when the caller lacks ai_assistant.settings.manage', async () => {
      loadAclMock.mockResolvedValueOnce({
        features: ['ai_assistant.view'],
        isSuperAdmin: false,
      })
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
      ])
      const response = await DELETE(
        buildRequest(null, 'DELETE') as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(403)
    })

    it('clears the override and subsequent GET returns override: null', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'catalog.assistant',
          moduleId: 'catalog',
          mutationPolicy: 'confirm-required',
        }),
      ])
      repoClearMock.mockResolvedValueOnce(true)

      const delResponse = await DELETE(
        buildRequest(null, 'DELETE') as any,
        buildParams('catalog.assistant'),
      )
      expect(delResponse.status).toBe(200)
      const delJson = await delResponse.json()
      expect(delJson.ok).toBe(true)
      expect(delJson.cleared).toBe(true)
      expect(delJson.override).toBeNull()

      repoGetMock.mockResolvedValueOnce(null)
      const getResponse = await GET(
        buildRequest(null, 'GET') as any,
        buildParams('catalog.assistant'),
      )
      const getJson = await getResponse.json()
      expect(getJson.override).toBeNull()
    })
  })
})
