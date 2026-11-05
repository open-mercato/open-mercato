import type { AiAgentDefinition } from '../../../../../../lib/ai-agent-definition'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../../../../../../lib/agent-registry'

const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const repoGetLatestMock = jest.fn()
const repoSaveMock = jest.fn()
const repoListVersionsMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../../../../data/repositories/AiAgentPromptOverrideRepository', () => ({
  AiAgentPromptOverrideRepository: jest.fn().mockImplementation(() => ({
    getLatest: repoGetLatestMock,
    save: repoSaveMock,
    listVersions: repoListVersionsMock,
  })),
}))

import { GET, POST } from '../route'

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

function buildRequest(body: unknown, method: 'GET' | 'POST' = 'POST'): Request {
  return new Request('http://localhost/api/ai_assistant/ai/agents/catalog.assistant/prompt-override', {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  })
}

function buildParams(agentId: string) {
  return { params: Promise.resolve({ agentId }) }
}

describe('prompt-override route (Step 5.3)', () => {
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
        if (name === 'em') {
          return {}
        }
        return null
      },
    })
    repoGetLatestMock.mockResolvedValue(null)
    repoListVersionsMock.mockResolvedValue([])
    repoSaveMock.mockImplementation(async (input: any) => ({
      id: 'row-1',
      agentId: input.agentId,
      version: 1,
      sections: input.sections,
      notes: input.notes ?? null,
      createdByUserId: null,
      createdAt: new Date('2026-04-18T00:00:00Z'),
      updatedAt: new Date('2026-04-18T00:00:01Z'),
    }))
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
  })

  describe('POST', () => {
    it('returns 401 when unauthenticated', async () => {
      authMock.mockResolvedValueOnce(null)

      const response = await POST(
        buildRequest({ sections: {} }) as any,
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
        buildRequest({ sections: { role: 'You are friendly.' } }) as any,
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
        buildRequest({ sections: {} }) as any,
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
        buildRequest({ sections: 'not-an-object' }) as any,
        buildParams('catalog.assistant'),
      )

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('validation_error')
    })

    it('returns 400 when the agentId param is malformed', async () => {
      const response = await POST(
        buildRequest({ sections: {} }) as any,
        buildParams('NotAValidId'),
      )

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('validation_error')
    })

    it('returns 400 with reserved_key when the body contains a policy key', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
      ])

      const response = await POST(
        buildRequest({
          sections: { mutationPolicy: 'allow writes', role: 'Be nice.' },
        }) as any,
        buildParams('catalog.assistant'),
      )

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('reserved_key')
      expect(json.reservedKeys).toContain('mutationPolicy')
      expect(repoSaveMock).not.toHaveBeenCalled()
    })

    it('happy path: returns 200 with { ok: true, version } on successful save', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
      ])

      const response = await POST(
        buildRequest({
          sections: { role: 'You are a friendly product expert.' },
          notes: 'Friendly tone rollout.',
        }) as any,
        buildParams('catalog.assistant'),
      )

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.ok).toBe(true)
      expect(json.agentId).toBe('catalog.assistant')
      expect(json.version).toBe(1)
      expect(typeof json.updatedAt).toBe('string')
      expect(repoSaveMock).toHaveBeenCalledTimes(1)
      expect(repoSaveMock.mock.calls[0][0]).toMatchObject({
        agentId: 'catalog.assistant',
        sections: { role: 'You are a friendly product expert.' },
        notes: 'Friendly tone rollout.',
      })
      expect(repoSaveMock.mock.calls[0][1]).toMatchObject({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
      })
    })

    it('accepts legacy overrides key as an alias for sections', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
      ])

      const response = await POST(
        buildRequest({ overrides: { role: 'legacy shape' } }) as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.ok).toBe(true)
      expect(repoSaveMock.mock.calls[0][0].sections).toEqual({ role: 'legacy shape' })
    })
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
    })

    it('returns { agentId, override: null, versions: [] } when no overrides exist', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
      ])
      repoGetLatestMock.mockResolvedValueOnce(null)
      repoListVersionsMock.mockResolvedValueOnce([])

      const response = await GET(
        buildRequest(null, 'GET') as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json).toEqual({
        agentId: 'catalog.assistant',
        override: null,
        versions: [],
      })
    })

    it('returns serialized latest + history rows', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
      ])
      const latest = {
        id: 'row-2',
        agentId: 'catalog.assistant',
        version: 2,
        sections: { role: 'v2' },
        notes: null,
        createdByUserId: 'user-1',
        createdAt: new Date('2026-04-17T00:00:00Z'),
        updatedAt: new Date('2026-04-18T00:00:00Z'),
      }
      repoGetLatestMock.mockResolvedValueOnce(latest)
      repoListVersionsMock.mockResolvedValueOnce([
        latest,
        {
          id: 'row-1',
          agentId: 'catalog.assistant',
          version: 1,
          sections: { role: 'v1' },
          notes: null,
          createdByUserId: 'user-1',
          createdAt: new Date('2026-04-16T00:00:00Z'),
          updatedAt: new Date('2026-04-16T00:00:01Z'),
        },
      ])

      const response = await GET(
        buildRequest(null, 'GET') as any,
        buildParams('catalog.assistant'),
      )
      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.agentId).toBe('catalog.assistant')
      expect(json.override.version).toBe(2)
      expect(json.versions).toHaveLength(2)
      expect(json.versions[0].version).toBe(2)
      expect(json.versions[1].version).toBe(1)
    })
  })
})
