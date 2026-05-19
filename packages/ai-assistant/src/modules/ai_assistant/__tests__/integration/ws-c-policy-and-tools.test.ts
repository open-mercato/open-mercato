/**
 * Step 3.13 — Phase 1 WS-C integration tests (policy gate + tool resolution).
 *
 * These tests sit between the per-module unit tests (under each pack's own
 * `__tests__/`) and the HTTP Playwright coverage under `.ai/qa/tests/ai-framework/`.
 * The goal is to exercise the full runtime pipeline — agent registry → policy
 * gate → tool resolution → AI SDK adapter — against realistic fixtures and
 * assert the cross-cutting invariants that neither layer alone can catch.
 *
 * Why mock the AI SDK at the module boundary instead of a true HTTP e2e:
 * the Vercel AI SDK model factory tries to reach a real LLM provider by
 * default. The existing `agent-runtime-parity.test.ts` contract suite adopted
 * the same mock stance; this integration suite mirrors that choice so we
 * remain deterministic, hermetic, and provider-agnostic.
 */

import { z } from 'zod'
import type { AiAgentDefinition } from '../../lib/ai-agent-definition'
import type { AiChatRequestContext } from '../../lib/attachment-bridge-types'
import type { AiToolDefinition } from '../../lib/types'

// --- SDK mocks (mirrors agent-runtime-parity.test.ts) ---------------------

const streamTextMock = jest.fn()
const generateObjectMock = jest.fn()
const streamObjectMock = jest.fn()

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    streamObject: (...args: unknown[]) => streamObjectMock(...args),
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
import { resolveAiAgentTools, AgentPolicyError } from '../../lib/agent-tools'
import { checkAgentPolicy } from '../../lib/agent-policy'
import { runAiAgentText } from '../../lib/agent-runtime'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'System prompt base.',
    allowedTools: [],
    ...overrides,
  }
}

function makeTool(
  overrides: Partial<AiToolDefinition> & Pick<AiToolDefinition, 'name'>,
): AiToolDefinition {
  return {
    description: `${overrides.name} description`,
    inputSchema: z.object({}),
    handler: async () => ({ ok: true }),
    ...overrides,
  }
}

function makeAuth(overrides: Partial<AiChatRequestContext> = {}): AiChatRequestContext {
  return {
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    userId: 'user-a',
    features: [],
    isSuperAdmin: false,
    ...overrides,
  }
}

function fakeStreamTextResult() {
  return {
    toTextStreamResponse: jest.fn(
      () =>
        new Response('ok', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ),
    toUIMessageStreamResponse: jest.fn(
      () =>
        new Response('ok', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ),
  }
}

describe('WS-C integration — agent policy gate + tool resolution', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    streamTextMock.mockImplementation(() => fakeStreamTextResult())
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('unknown agent throws AgentPolicyError(agent_unknown)', async () => {
    await expect(
      resolveAiAgentTools({
        agentId: 'does.not_exist',
        authContext: makeAuth({ isSuperAdmin: true }),
      }),
    ).rejects.toBeInstanceOf(AgentPolicyError)

    await expect(
      resolveAiAgentTools({
        agentId: 'does.not_exist',
        authContext: makeAuth({ isSuperAdmin: true }),
      }),
    ).rejects.toMatchObject({ code: 'agent_unknown' })
  })

  it('forbidden agent (missing requiredFeatures) throws agent_features_denied', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        requiredFeatures: ['customers.assistant.use'],
      }),
    ])

    await expect(
      resolveAiAgentTools({
        agentId: 'customers.assistant',
        authContext: makeAuth({ features: ['customers.people.view'] }),
      }),
    ).rejects.toMatchObject({
      name: 'AgentPolicyError',
      code: 'agent_features_denied',
    })
  })

  it('super-admin bypass: agent.requiredFeatures does not block a super-admin caller', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        requiredFeatures: ['customers.assistant.use'],
      }),
    ])

    const resolved = await resolveAiAgentTools({
      agentId: 'customers.assistant',
      authContext: makeAuth({ isSuperAdmin: true, features: [] }),
    })
    expect(resolved.agent.id).toBe('customers.assistant')
    expect(resolved.tools).toEqual({})
  })

  it('allowedTools filtering: tools listed in allowedTools are resolved; extras never leak', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.assistant',
        moduleId: 'catalog',
        allowedTools: ['catalog.list_products'],
      }),
    ])
    registerMcpTool(
      makeTool({
        name: 'catalog.list_products',
        requiredFeatures: ['catalog.products.view'],
      }),
    )
    // A tool that the agent did NOT whitelist. Resolution MUST NOT include it.
    registerMcpTool(
      makeTool({
        name: 'catalog.delete_product',
        isMutation: true,
        requiredFeatures: ['catalog.products.manage'],
      }),
    )

    const resolved = await resolveAiAgentTools({
      agentId: 'catalog.assistant',
      authContext: makeAuth({ isSuperAdmin: true }),
    })

    expect(Object.keys(resolved.tools).sort()).toEqual(['catalog__list_products'])
    expect(Object.prototype.hasOwnProperty.call(resolved.tools, 'catalog__delete_product')).toBe(false)
  })

  it('tool-level requiredFeatures: tool is skipped with a warn when caller lacks the feature; remaining tools still reach the model', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.assistant',
        moduleId: 'catalog',
        allowedTools: ['catalog.list_products', 'catalog.get_product'],
      }),
    ])
    registerMcpTool(
      makeTool({
        name: 'catalog.list_products',
        requiredFeatures: ['catalog.products.view'],
      }),
    )
    registerMcpTool(
      makeTool({
        name: 'catalog.get_product',
        requiredFeatures: ['catalog.products.secret'],
      }),
    )

    const resolved = await resolveAiAgentTools({
      agentId: 'catalog.assistant',
      authContext: makeAuth({ features: ['catalog.products.view'], isSuperAdmin: false }),
    })
    expect(Object.keys(resolved.tools)).toEqual(['catalog__list_products'])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('catalog.get_product'),
    )
  })

  it('mutation tool blocked by readOnly agent: checkAgentPolicy returns mutation_blocked_by_readonly', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.assistant',
        moduleId: 'catalog',
        allowedTools: ['catalog.delete_product'],
        readOnly: true,
      }),
    ])
    registerMcpTool(
      makeTool({
        name: 'catalog.delete_product',
        isMutation: true,
      }),
    )

    const decision = checkAgentPolicy({
      agentId: 'catalog.assistant',
      toolName: 'catalog.delete_product',
      authContext: { userFeatures: ['*'], isSuperAdmin: true },
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.code).toBe('mutation_blocked_by_readonly')
    }
  })

  it('runAiAgentText end-to-end: unknown agent produces AgentPolicyError before the SDK is called', async () => {
    await expect(
      runAiAgentText({
        agentId: 'missing.agent',
        messages: [
          { role: 'user', id: 'm1', parts: [{ type: 'text' as const, text: 'hi' }] } as never,
        ],
        authContext: makeAuth({ isSuperAdmin: true }),
      }),
    ).rejects.toMatchObject({ name: 'AgentPolicyError', code: 'agent_unknown' })
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('runAiAgentText end-to-end: allowedTools filter passes through to the SDK tool map', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.assistant',
        moduleId: 'catalog',
        allowedTools: ['catalog.list_products'],
      }),
    ])
    registerMcpTool(
      makeTool({
        name: 'catalog.list_products',
        requiredFeatures: ['catalog.products.view'],
      }),
    )
    // Tool not whitelisted by the agent; MUST NOT appear in the SDK args.
    registerMcpTool(
      makeTool({
        name: 'catalog.update_product',
        isMutation: true,
        requiredFeatures: ['catalog.products.manage'],
      }),
    )

    await runAiAgentText({
      agentId: 'catalog.assistant',
      messages: [
        { role: 'user', id: 'm1', parts: [{ type: 'text' as const, text: 'hi' }] } as never,
      ],
      authContext: makeAuth({ isSuperAdmin: true }),
    })

    expect(streamTextMock).toHaveBeenCalledTimes(1)
    const sdkArg = streamTextMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(sdkArg).toBeDefined()
    const toolsArg = (sdkArg?.tools ?? {}) as Record<string, unknown>
    expect(Object.keys(toolsArg)).toEqual(['catalog__list_products'])
    expect(Object.prototype.hasOwnProperty.call(toolsArg, 'catalog__update_product')).toBe(false)
  })
})
