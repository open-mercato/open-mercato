import { z } from 'zod'
import {
  AiAgentDispatchDeniedError,
  type AiAgentRunDispatchInput,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-run-dispatcher'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { AgentInvokeDeniedError, AgentRunTimeoutError } from '../lib/runtime/errors'
import type { AgentRunCtx } from '../lib/runtime/persistence'

const registeredEntries = new Map<string, AgentRegistryEntry>()
const assistantAgentIds = new Set<string>()

jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: jest.fn(async () => undefined),
  getAgentEntry: (id: string) => registeredEntries.get(id),
}))

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  getAgent: (id: string) => (assistantAgentIds.has(id) ? { id } : undefined),
  listAgents: () => [...assistantAgentIds].map((id) => ({ id })),
}))

import { createAiAgentRunDispatcher } from '../lib/runtime/aiAgentRunDispatcher'
import { ensureAgentsLoaded } from '../lib/sdk/defineAgent'

function registryEntry(id: string, overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  return {
    id,
    moduleId: 'agent_orchestrator',
    resultKind: 'research',
    schema: z.unknown(),
    tools: [],
    skills: [],
    subAgents: [],
    label: id,
    description: id,
    instructions: 'BASE',
    runtime: 'native',
    ...overrides,
  }
}

type RunCall = { agentId: string; input: unknown; ctx: AgentRunCtx }

function buildRuntime(outcome: (call: RunCall) => Promise<unknown>) {
  const calls: RunCall[] = []
  const agentRuntime = {
    run: async (agentId: string, input: unknown, ctx: AgentRunCtx) => {
      const call = { agentId, input, ctx }
      calls.push(call)
      return outcome(call)
    },
  }
  const container = {
    resolve: <T,>(name: string): T => {
      if (name === 'agentRuntime') return agentRuntime as T
      throw new Error(`unexpected resolve ${name}`)
    },
  }
  return { calls, dispatcher: createAiAgentRunDispatcher(container) }
}

function dispatchInput(overrides: Partial<AiAgentRunDispatchInput> = {}): AiAgentRunDispatchInput {
  return {
    agentId: 'test.research',
    input: { question: 'q' },
    caller: {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      apiKeyId: null,
      features: ['ai_assistant.view'],
      isSuperAdmin: false,
    },
    channel: 'run-object',
    via: 'route',
    correlationId: 'corr-1',
    timeoutMs: 30_000,
    ...overrides,
  }
}

describe('AO ai-assistant agent run dispatcher', () => {
  beforeEach(() => {
    registeredEntries.clear()
    assistantAgentIds.clear()
    registeredEntries.set('test.research', registryEntry('test.research'))
    registeredEntries.set('test.file', registryEntry('test.file', { runtime: 'opencode' }))
    registeredEntries.set('test.disabled', registryEntry('test.disabled'))
    assistantAgentIds.add('test.research')
    assistantAgentIds.add('other.assistant_agent')
  })

  it('starts the registry load when built and owns only registered agents', () => {
    const { dispatcher } = buildRuntime(async () => ({ kind: 'research', data: null }))
    expect(ensureAgentsLoaded).toHaveBeenCalled()
    expect(dispatcher.owns('test.research')).toBe(true)
    expect(dispatcher.owns('test.disabled')).toBe(true)
    expect(dispatcher.owns('unknown.agent')).toBe(false)
  })

  it('reports registered agents available and unknown or override-disabled ones unavailable', async () => {
    const { dispatcher } = buildRuntime(async () => ({ kind: 'research', data: null }))
    await expect(dispatcher.isAvailable('test.research')).resolves.toBe(true)
    await expect(dispatcher.isAvailable('test.file')).resolves.toBe(true)
    await expect(dispatcher.isAvailable('unknown.agent')).resolves.toBe(false)
    await expect(dispatcher.isAvailable('test.disabled')).resolves.toBe(false)
  })

  it('maps a session caller, the route door and the call metadata into the run ctx', async () => {
    const { calls, dispatcher } = buildRuntime(async (call) => {
      call.ctx.onRunPersisted?.('run-top')
      call.ctx.onRunPersisted?.('run-nested')
      return { kind: 'research', data: { answer: 42 } }
    })
    const callSettings = { temperature: 0.2 }
    const outcome = await dispatcher.runObject(dispatchInput({ callSettings }))

    expect(outcome).toEqual({ result: { answer: 42 }, agentRunId: 'run-top', finishReason: null })
    expect(calls).toHaveLength(1)
    const [{ agentId, input, ctx }] = calls
    expect(agentId).toBe('test.research')
    expect(input).toEqual({ question: 'q' })
    expect(ctx).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      invoker: { kind: 'user', userId: 'user-1' },
      entryPoint: 'ai_assistant',
      channel: 'run-object',
      correlationId: 'corr-1',
      callSettings,
      runTimeoutMs: 30_000,
    })
  })

  it('maps an API-key caller to an api_key invoker with its owner and the tool door', async () => {
    const { calls, dispatcher } = buildRuntime(async () => ({ kind: 'research', data: null }))
    await dispatcher.runObject(
      dispatchInput({
        via: 'tool',
        channel: 'mcp',
        caller: { ...dispatchInput().caller, apiKeyId: 'key-1', userId: 'owner-1' },
      }),
    )
    expect(calls[0].ctx).toMatchObject({
      userId: 'api_key:key-1',
      invoker: { kind: 'api_key', apiKeyId: 'key-1', ownerUserId: 'owner-1' },
      entryPoint: 'tool',
      channel: 'mcp',
    })
    expect(calls[0].ctx.callSettings).toBeUndefined()
  })

  it('records a null owner for an API key without one', async () => {
    const { calls, dispatcher } = buildRuntime(async () => ({ kind: 'research', data: null }))
    await dispatcher.runObject(
      dispatchInput({ caller: { ...dispatchInput().caller, apiKeyId: 'key-2', userId: null } }),
    )
    expect(calls[0].ctx.invoker).toEqual({ kind: 'api_key', apiKeyId: 'key-2', ownerUserId: null })
  })

  it('refuses a caller with neither a user nor an API key before running', async () => {
    const { calls, dispatcher } = buildRuntime(async () => ({ kind: 'research', data: null }))
    const attempt = dispatcher.runObject(
      dispatchInput({ caller: { ...dispatchInput().caller, userId: null, apiKeyId: null } }),
    )
    await expect(attempt).rejects.toBeInstanceOf(AiAgentDispatchDeniedError)
    await expect(attempt).rejects.toMatchObject({ code: 'agent_principal_missing', agentId: 'test.research' })
    expect(calls).toHaveLength(0)
  })

  it('unwraps proposal and artifact results like delegate_agent', async () => {
    const proposal = { options: [], rationale: 'nothing to do' }
    const proposalRun = buildRuntime(async () => ({ kind: 'proposal', proposal }))
    await expect(proposalRun.dispatcher.runObject(dispatchInput())).resolves.toMatchObject({
      result: proposal,
      agentRunId: null,
    })

    const artifacts = [{ fileName: 'report.md' }]
    const artifactRun = buildRuntime(async () => ({ kind: 'artifact', artifacts, summary: 'one report' }))
    await expect(artifactRun.dispatcher.runObject(dispatchInput())).resolves.toMatchObject({
      result: { artifacts, summary: 'one report' },
    })
  })

  it('maps an invoke denial to the port denial and lets other errors through', async () => {
    const denied = buildRuntime(async () => {
      throw new AgentInvokeDeniedError('test.research')
    })
    await expect(denied.dispatcher.runObject(dispatchInput())).rejects.toMatchObject({
      name: 'AiAgentDispatchDeniedError',
      code: 'agent_invoke_denied',
      agentId: 'test.research',
    })

    const timedOut = buildRuntime(async () => {
      throw new AgentRunTimeoutError('test.research', 10)
    })
    await expect(timedOut.dispatcher.runObject(dispatchInput())).rejects.toBeInstanceOf(AgentRunTimeoutError)
  })

  it('rejects on abort without waiting for the run', async () => {
    const controller = new AbortController()
    const pending = buildRuntime(() => new Promise(() => undefined))
    const attempt = pending.dispatcher.runObject(dispatchInput({ signal: controller.signal }))
    controller.abort(new Error('caller gave up'))
    await expect(attempt).rejects.toThrow('caller gave up')

    const alreadyAborted = buildRuntime(async () => ({ kind: 'research', data: null }))
    await expect(
      alreadyAborted.dispatcher.runObject(dispatchInput({ signal: controller.signal })),
    ).rejects.toThrow('caller gave up')
    expect(alreadyAborted.calls).toHaveLength(0)
  })
})
