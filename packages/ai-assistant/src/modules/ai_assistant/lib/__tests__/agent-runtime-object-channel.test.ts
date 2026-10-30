import type { AwilixContainer } from 'awilix'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'

const generateObjectMock = jest.fn()
const generateTextMock = jest.fn()
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)
const prepareMutationMock = jest.fn()

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    generateText: (...args: unknown[]) => generateTextMock(...args),
    convertToModelMessages: (...args: unknown[]) => convertToModelMessagesMock(...args),
  }
})

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    resolveFirstConfigured: () => ({
      id: 'test-provider',
      defaultModel: 'provider-default-model',
      resolveApiKey: () => 'test-api-key',
      createModel: (options: { modelId: string }) => ({ id: options.modelId }),
      isConfigured: () => true,
    }),
  },
}))

jest.mock('../prepare-mutation', () => {
  const actual = jest.requireActual('../prepare-mutation')
  return {
    ...actual,
    prepareMutation: (...args: unknown[]) => prepareMutationMock(...args),
  }
})

import { z } from 'zod'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { toolRegistry, registerMcpTool } from '../tool-registry'
import { runAiAgentObject } from '../agent-runtime'

const outputSchema = z.object({ verdict: z.string() })

const baseAuth = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
  features: ['*'],
  isSuperAdmin: true,
}

const container = {
  resolve: (name: string) => {
    throw new Error(`unknown dependency ${name}`)
  },
} as unknown as AwilixContainer

function seedMutationAgent(): void {
  const readTool: AiToolDefinition = {
    name: 'customers.read_deal',
    description: 'read',
    inputSchema: z.object({}).passthrough(),
    handler: async () => ({ ok: true }),
  }
  const updateTool: AiToolDefinition = {
    name: 'customers.update_deal',
    description: 'update',
    inputSchema: z.object({}).passthrough(),
    handler: async () => ({ shouldNeverRun: true }),
    isMutation: true,
  }
  registerMcpTool(readTool, { moduleId: 'customers' })
  registerMcpTool(updateTool, { moduleId: 'customers' })
  const agent: AiAgentDefinition = {
    id: 'customers.writer_agent',
    moduleId: 'customers',
    label: 'writer',
    description: 'writer',
    systemPrompt: 'System prompt base.',
    executionMode: 'object',
    readOnly: false,
    mutationPolicy: 'confirm-required',
    allowedTools: ['customers.read_deal', 'customers.update_deal'],
    output: { schemaName: 'Verdict', schema: outputSchema },
  }
  seedAgentRegistryForTests([agent])
}

type ExecutableTool = { execute: (args: unknown, options: unknown) => Promise<unknown> }

function mockGenerateTextCallingUpdate(): void {
  generateTextMock.mockImplementation(async (args: { tools: Record<string, ExecutableTool> }) => {
    const update = args.tools['customers__update_deal']
    if (update) {
      await update.execute({ dealId: 'deal-1', patch: { stage: 'won' } }, { toolCallId: 'call-1', messages: [] })
    }
    return {
      output: { verdict: 'ok' },
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    }
  })
}

describe('runAiAgentObject channel mutation policy (MCP parity §3.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    prepareMutationMock.mockResolvedValue({
      uiPart: { componentId: 'mutation-preview-card', props: {} },
      pendingAction: { id: 'pending-1', expiresAt: new Date('2026-10-22T12:00:00Z') },
    })
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it("forces read-only for channel 'mcp' in 'deny' mode", async () => {
    seedMutationAgent()
    mockGenerateTextCallingUpdate()

    const result = await runAiAgentObject({
      agentId: 'customers.writer_agent',
      input: 'judge',
      authContext: baseAuth,
      enableTools: true,
      container,
      channel: 'mcp',
      mutationMode: 'deny',
    })

    const callArg = generateTextMock.mock.calls[0][0] as { tools: Record<string, unknown>; system: string }
    expect(Object.keys(callArg.tools)).toEqual(['customers__read_deal'])
    expect(callArg.system).toContain('Effective policy: read-only.')
    expect(prepareMutationMock).not.toHaveBeenCalled()
    if (result.mode !== 'generate') throw new Error('unreachable')
    expect(result.pendingActionIds).toBeUndefined()
  })

  it("keeps the agent policy in 'approval' mode and returns the queued pending action ids", async () => {
    seedMutationAgent()
    mockGenerateTextCallingUpdate()

    const result = await runAiAgentObject({
      agentId: 'customers.writer_agent',
      input: 'judge',
      authContext: baseAuth,
      enableTools: true,
      container,
      channel: 'mcp',
      mutationMode: 'approval',
      apiKeyId: 'key-1',
      correlationId: 'corr-1',
    })

    const callArg = generateTextMock.mock.calls[0][0] as { tools: Record<string, unknown>; system: string }
    expect(Object.keys(callArg.tools)).toEqual(
      expect.arrayContaining(['customers__read_deal', 'customers__update_deal']),
    )
    expect(callArg.system).toContain('Effective policy: confirm-required.')
    expect(prepareMutationMock).toHaveBeenCalledTimes(1)
    const [prepareInput] = prepareMutationMock.mock.calls[0] as [Record<string, unknown>]
    expect(prepareInput).toMatchObject({
      channel: 'mcp',
      apiKeyId: 'key-1',
      correlationId: 'corr-1',
    })
    if (result.mode !== 'generate') throw new Error('unreachable')
    expect(result.pendingActionIds).toEqual(['pending-1'])
  })

  it('keeps default agent-channel behaviour when no channel is supplied', async () => {
    seedMutationAgent()
    mockGenerateTextCallingUpdate()

    const result = await runAiAgentObject({
      agentId: 'customers.writer_agent',
      input: 'judge',
      authContext: baseAuth,
      enableTools: true,
      container,
    })

    const [prepareInput] = prepareMutationMock.mock.calls[0] as [Record<string, unknown>]
    expect(prepareInput.channel).toBe('agent')
    if (result.mode !== 'generate') throw new Error('unreachable')
    expect(result.pendingActionIds).toEqual(['pending-1'])
  })
})
