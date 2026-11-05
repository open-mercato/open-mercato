import { asValue, createContainer } from 'awilix'
import { z } from 'zod'
import type { ToolExecutionOptions } from 'ai'
import { resolveAiAgentTools } from '../agent-tools'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { registerMcpTool, toolRegistry } from '../tool-registry'
import type { AiToolDefinition } from '../types'
import type { AiAgentDefinition } from '../ai-agent-definition'

const prepareMutationMock = jest.fn()
const container = createContainer()
container.register({ rbacService: asValue({}) })

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => container,
}))

jest.mock('../tool-loader', () => ({
  ensureModuleToolsLoaded: async () => undefined,
}))

jest.mock('../prepare-mutation', () => ({
  prepareMutation: (...args: unknown[]) => prepareMutationMock(...args),
}))

const authContext = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
  features: ['test.records.manage'],
  isSuperAdmin: false,
}

const executionOptions: ToolExecutionOptions<unknown> = { toolCallId: 'call-1', messages: [], context: undefined }

function seedAgent(overrides: Partial<AiAgentDefinition> = {}) {
  const agent: AiAgentDefinition = {
    id: 'test.assistant',
    moduleId: 'test',
    label: 'Test assistant',
    description: 'Approval path fixture',
    systemPrompt: 'Test',
    allowedTools: ['test.mutation'],
    readOnly: false,
    mutationPolicy: 'confirm-required',
    ...overrides,
  }
  seedAgentRegistryForTests([agent])
}

describe('agent approval paths alongside the direct HTTP refusal', () => {
  let handler: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    handler = jest.fn(async () => ({ written: true }))
    const tool: AiToolDefinition = {
      name: 'test.mutation',
      description: 'Mutation fixture',
      inputSchema: z.object({ title: z.string() }),
      isMutation: true,
      isDestructive: false,
      requiredFeatures: ['test.records.manage'],
      handler,
    }
    registerMcpTool(tool, { moduleId: 'test' })
    prepareMutationMock.mockResolvedValue({
      uiPart: { type: 'mutation-preview-card', data: { pendingActionId: 'action-1' } },
      pendingAction: { id: 'action-1', expiresAt: new Date('2099-01-01'), status: 'pending' },
      reused: false,
    })
  })

  afterEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it.each(['chat', 'object'] as const)('still stages confirm-required mutations for %s agents', async (requestedExecutionMode) => {
    seedAgent({ executionMode: requestedExecutionMode })
    const resolved = await resolveAiAgentTools({
      agentId: 'test.assistant', authContext, container, requestedExecutionMode,
    })

    const result = await resolved.tools.test__mutation.execute?.({ title: 'Changed' }, executionOptions)

    expect(handler).not.toHaveBeenCalled()
    expect(prepareMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallArgs: { title: 'Changed' }, agent: expect.objectContaining({ id: 'test.assistant' }) }),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1', container }),
    )
    expect(result).toEqual(expect.stringContaining('pending-confirmation'))
    expect(resolved.uiPartQueue.drain()).toEqual([
      { type: 'mutation-preview-card', data: { pendingActionId: 'action-1' } },
    ])
  })

  it('preserves policy-permitted non-destructive writes through the shared executor', async () => {
    seedAgent({ mutationPolicy: 'destructive-confirm-required' })
    const resolved = await resolveAiAgentTools({ agentId: 'test.assistant', authContext, container })

    const result = await resolved.tools.test__mutation.execute?.({ title: 'Changed' }, executionOptions)

    expect(prepareMutationMock).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledWith({ title: 'Changed' }, expect.objectContaining({
      tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1',
    }))
    expect(result).toEqual(expect.stringContaining('"written": true'))
  })

  it.each([
    { mutationPolicyOverride: 'read-only' as const },
    { authContext: { ...authContext, features: [] } },
  ])('keeps tenant policy downgrades and tool ACL filtering', async (overrides) => {
    seedAgent()
    const resolved = await resolveAiAgentTools({ agentId: 'test.assistant', authContext, container, ...overrides })

    expect(resolved.tools).toEqual({})
    expect(handler).not.toHaveBeenCalled()
    expect(prepareMutationMock).not.toHaveBeenCalled()
  })
})
