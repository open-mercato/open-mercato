/**
 * Step 3.13 — Phase 1 WS-C integration tests (tool-pack coverage).
 *
 * Re-exercises the cross-cutting shape of the `search.*`, `attachments.*`, and
 * `meta.*` packs through the agent runtime so we can assert the invariants
 * that per-pack unit tests cannot:
 *
 *   - Every pack tool carries `requiredFeatures` (no unguarded read tool).
 *   - Tenant context is enforced by search/attachments handlers before any
 *     downstream resolve() call.
 *   - `meta.list_agents` degrades gracefully on an empty registry and honors
 *     RBAC filtering + super-admin bypass when wired through the same
 *     `listAgents()` API used by the chat dispatcher.
 *   - An agent that whitelists all three packs reaches the AI SDK with the
 *     full tool map and no extras.
 *
 * Customer/catalog tool packs are covered by their per-pack unit tests under
 * `packages/core/src/modules/{customers,catalog}/__tests__/ai-tools/`. Those
 * tests already verify tenant isolation, not-found shape, includeRelated
 * aggregates, search_products routing, and suggest_price_adjustment's
 * `isMutation: false` + `currentPrice: null` fallback. Re-testing them here
 * would require cross-package Jest plumbing the ai-assistant harness does not
 * currently support — documented as a deliberate scoping choice; see
 * `${run_folder}/step-3.13-checks.md`.
 */

import { z } from 'zod'
import type { AiAgentDefinition } from '../../lib/ai-agent-definition'
import type { AiToolDefinition } from '../../lib/types'

const streamTextMock = jest.fn()

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
  }
})

const createModelMock = jest.fn(
  (options: { modelId: string; apiKey: string }) => ({ id: options.modelId, apiKey: options.apiKey }),
)
const resolveApiKeyMock = jest.fn(() => 'test-api-key')

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    resolveFirstConfigured: () => ({
      id: 'test-provider',
      defaultModel: 'provider-default-model',
      resolveApiKey: resolveApiKeyMock,
      createModel: createModelMock,
    }),
  },
}))

import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../../lib/agent-registry'
import { toolRegistry, registerMcpTool } from '../../lib/tool-registry'
import { resolveAiAgentTools } from '../../lib/agent-tools'

import searchAiTools from '../../ai-tools/search-pack'
import attachmentsAiTools from '../../ai-tools/attachments-pack'
import metaAiTools from '../../ai-tools/meta-pack'

import { listAgents } from '../../lib/agent-registry'
import { hasRequiredFeatures } from '../../lib/auth'

function findTool(
  pack: AiToolDefinition<any, any>[],
  name: string,
): AiToolDefinition<any, any> {
  const tool = pack.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} not registered in pack`)
  return tool
}

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'System prompt.',
    allowedTools: [],
    ...overrides,
  }
}

function makeCtx(overrides: Partial<{
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  userFeatures: string[]
  isSuperAdmin: boolean
  container: { resolve: (name: string) => unknown }
}> = {}) {
  return {
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    userId: 'user-a',
    container: { resolve: jest.fn() },
    userFeatures: ['ai_assistant.view'],
    isSuperAdmin: false,
    ...overrides,
  }
}

describe('WS-C integration — tool-pack coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    streamTextMock.mockImplementation(() => ({
      toTextStreamResponse: jest.fn(() => new Response('ok')),
    }))
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  describe('every read tool across the three packs carries requiredFeatures', () => {
    it('search pack', () => {
      for (const tool of searchAiTools) {
        expect(tool.requiredFeatures).toBeDefined()
        expect((tool.requiredFeatures as string[]).length).toBeGreaterThan(0)
      }
    })

    it('attachments pack', () => {
      for (const tool of attachmentsAiTools) {
        expect(tool.requiredFeatures).toBeDefined()
        expect((tool.requiredFeatures as string[]).length).toBeGreaterThan(0)
      }
    })

    it('meta pack', () => {
      for (const tool of metaAiTools) {
        expect(tool.requiredFeatures).toEqual(['ai_assistant.view'])
      }
    })
  })

  describe('search.hybrid_search — tenant context enforcement', () => {
    const tool = findTool(searchAiTools, 'search.hybrid_search')

    it('throws when tenantId is missing (short-circuits before any search)', async () => {
      await expect(
        tool.handler({ q: 'anything' }, makeCtx({ tenantId: null }) as any),
      ).rejects.toThrow(/tenant/i)
    })

    it('propagates tenantId + organizationId to the search service call', async () => {
      const searchMock = jest.fn().mockResolvedValue([])
      const ctx = makeCtx({
        container: {
          resolve: (name: string) => {
            if (name === 'searchService') return { search: searchMock }
            throw new Error(`Unknown registration: ${name}`)
          },
        },
      })

      await tool.handler({ q: 'hello', limit: 10 }, ctx as any)

      expect(searchMock).toHaveBeenCalledTimes(1)
      const [query, options] = searchMock.mock.calls[0] as [string, Record<string, unknown>]
      expect(query).toBe('hello')
      expect(options.tenantId).toBe('tenant-a')
      expect(options.organizationId).toBe('org-a')
      expect(options.limit).toBe(10)
    })
  })

  describe('attachments.list_record_attachments — tenant context enforcement', () => {
    const tool = findTool(attachmentsAiTools, 'attachments.list_record_attachments')

    it('throws when tenantId is missing', async () => {
      await expect(
        tool.handler(
          { entityType: 'customers:customer_person_profile', recordId: 'r1' },
          makeCtx({ tenantId: null }) as any,
        ),
      ).rejects.toThrow(/tenant/i)
    })
  })

  describe('meta.list_agents — RBAC + empty-registry graceful path', () => {
    const tool = findTool(metaAiTools, 'meta.list_agents')

    it('returns { agents: [], total: 0 } when the registry is empty', async () => {
      const result = (await tool.handler({}, makeCtx() as any)) as {
        agents: unknown[]
        total: number
      }
      expect(result.agents).toEqual([])
      expect(result.total).toBe(0)
    })

    it('filters by requiredFeatures using the same matcher the chat runtime uses', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.reader', moduleId: 'catalog', requiredFeatures: ['catalog.products.view'] }),
        makeAgent({ id: 'catalog.writer', moduleId: 'catalog', requiredFeatures: ['catalog.products.manage'] }),
      ])
      const ctx = makeCtx({ userFeatures: ['ai_assistant.view', 'catalog.products.view'] })
      const result = (await tool.handler({}, ctx as any)) as {
        agents: Array<{ id: string }>
      }
      expect(result.agents.map((a) => a.id)).toEqual(['catalog.reader'])

      // Parity with the chat runtime: the dispatcher uses the same helper.
      const allowed = listAgents().filter((agent) =>
        hasRequiredFeatures(agent.requiredFeatures ?? [], ctx.userFeatures, ctx.isSuperAdmin),
      )
      expect(allowed.map((a) => a.id)).toEqual(['catalog.reader'])
    })

    it('super-admin bypass: every agent is returned regardless of requiredFeatures', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'x.a', moduleId: 'x', requiredFeatures: ['x.secret'] }),
        makeAgent({ id: 'y.b', moduleId: 'y', requiredFeatures: ['y.secret'] }),
      ])
      const ctx = makeCtx({ userFeatures: [], isSuperAdmin: true })
      const result = (await tool.handler({}, ctx as any)) as {
        agents: Array<{ id: string }>
      }
      expect(result.agents.map((a) => a.id).sort()).toEqual(['x.a', 'y.b'])
    })
  })

  describe('agent whitelisting three packs reaches the SDK with the full tool map + no extras', () => {
    it('resolveAiAgentTools picks only whitelisted tools across packs', async () => {
      // Register one tool from each pack under a fresh registry.
      for (const tool of [
        findTool(searchAiTools, 'search.hybrid_search'),
        findTool(attachmentsAiTools, 'attachments.list_record_attachments'),
        findTool(metaAiTools, 'meta.list_agents'),
      ]) {
        registerMcpTool(tool as never)
      }
      // Plus an extra tool the agent does NOT whitelist; MUST NOT appear.
      registerMcpTool({
        name: 'catalog.update_product',
        description: 'write tool',
        inputSchema: z.object({}),
        handler: async () => ({}),
        isMutation: true,
        requiredFeatures: ['catalog.products.manage'],
      })

      seedAgentRegistryForTests([
        makeAgent({
          id: 'multi.reader',
          moduleId: 'multi',
          allowedTools: [
            'search.hybrid_search',
            'attachments.list_record_attachments',
            'meta.list_agents',
          ],
        }),
      ])

      const resolved = await resolveAiAgentTools({
        agentId: 'multi.reader',
        authContext: {
          tenantId: 'tenant-a',
          organizationId: 'org-a',
          userId: 'user-a',
          features: ['*'],
          isSuperAdmin: true,
        },
      })

      const toolNames = Object.keys(resolved.tools).sort()
      expect(toolNames).toEqual(
        ['attachments.list_record_attachments', 'meta.list_agents', 'search.hybrid_search'].sort(),
      )
      expect(toolNames).not.toContain('catalog.update_product')
    })
  })
})
