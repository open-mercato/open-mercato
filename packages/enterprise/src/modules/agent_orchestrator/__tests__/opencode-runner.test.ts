// Stub the audited session-token + role helpers so the runner never touches a
// real DB. We capture the createSessionApiKey input to assert scope (caller, not
// superadmin). findWithDecryption is stubbed to return the caller's roles.
const createSessionApiKeyMock = jest.fn()
const deleteSessionApiKeyMock = jest.fn()
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  generateSessionToken: () => 'sess_runner_test_token',
  createSessionApiKey: (...args: unknown[]) => {
    createSessionApiKeyMock(...args)
    return Promise.resolve({ keyId: 'key-1', secret: 'omk_x', sessionToken: 'sess_runner_test_token' })
  },
  deleteSessionApiKey: (...args: unknown[]) => {
    deleteSessionApiKeyMock(...args)
    return Promise.resolve()
  },
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: () => Promise.resolve([{ role: { id: 'role-caller' } }]),
}))
jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({ UserRole: class UserRole {} }))

import { OpenCodeAgentRunner, type OpenCodeRunnerClient } from '../lib/runtime/openCodeAgentRunner'
import { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { aiTools, SUBMIT_OUTCOME_TOOL_ID } from '../ai-tools'
import { compileOutcome } from '../lib/sdk/outcomeSchema'
import { InMemoryAgentRunSessionStore } from '../lib/runtime/agentRunSessionStore'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

const submitOutcomeTool = aiTools.find((t) => t.name === SUBMIT_OUTCOME_TOOL_ID) as AiToolDefinition

// The example file agent's actionable OUTCOME schema (mirrors the committed
// manifest for deals.health_check).
const { resultSchema } = compileOutcome({
  kind: 'actionable',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['actions', 'confidence', 'rationale'],
    properties: {
      actions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'payload'],
          properties: {
            type: { const: 'set_stage' },
            payload: {
              type: 'object',
              additionalProperties: false,
              required: ['stage'],
              properties: { stage: { type: 'string', minLength: 1 } },
            },
          },
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: { type: 'string', minLength: 1 },
    },
  },
})

const FILE_AGENT_ID = 'deals.health_check_runner_test'
const OPENCODE_AGENT_NAME = 'deals_health_check_runner_test'

function registerExampleFileAgent(): AgentRegistryEntry {
  const existing = getAgentEntry(FILE_AGENT_ID)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id: FILE_AGENT_ID,
    moduleId: 'agent_examples',
    resultKind: 'actionable',
    schema: resultSchema,
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Deal health check (file)',
    description: 'Assess a deal and propose the next stage.',
    instructions: 'Assess the deal.',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    loop: { maxSteps: 12 },
    runtime: 'opencode',
  }
  registerFileAgent(entry)
  return entry
}

type CommandCall = { id: string; input: Record<string, unknown> }

/**
 * Minimal command bus + container harness. The command bus records every call
 * and returns a synthetic runId for runs.create, matching the persistence
 * helpers' expected shapes.
 */
function makeHarness() {
  const calls: CommandCall[] = []
  const commandBus = {
    async execute<I, O>(id: string, opts: { input: I }): Promise<{ result: O }> {
      calls.push({ id, input: opts.input as Record<string, unknown> })
      if (id === 'agent_orchestrator.runs.create') {
        return { result: { runId: 'run-123' } as unknown as O }
      }
      return { result: { runId: 'run-123' } as unknown as O }
    },
  }

  const rbacService = {
    loadAcl: async () => ({ isSuperAdmin: false, features: ['agent_orchestrator.agents.run'] }),
  }
  const em = {}
  // Shared cross-process correlation store — the runner opens a row, the fake
  // client's submit_outcome (resolving the SAME store from the container)
  // completes it, and the runner polls it back.
  const agentRunSessionStore = new InMemoryAgentRunSessionStore()

  const registrations: Record<string, unknown> = { rbacService, em, agentRunSessionStore }
  const container = {
    resolve(name: string) {
      if (name in registrations) return registrations[name]
      throw new Error(`unexpected resolve("${name}")`)
    },
    register(extra: Record<string, unknown>) {
      Object.assign(registrations, extra)
    },
  } as unknown as { resolve: (name: string) => unknown; register: (extra: Record<string, unknown>) => void }

  return { calls, commandBus, container, registrations }
}

/**
 * Fake OpenCode client. On `sendMessage` it simulates OpenCode invoking the
 * in-process submit_outcome tool with a valid outcome (passing the session token
 * as ctx.sessionId, exactly as the MCP HTTP server would), then emits a
 * busy→idle SSE sequence. Records the `agent` field for assertion.
 */
function makeFakeClient(opts: {
  outcome: unknown
  sessionTokenRef: { value: string }
  agentSentRef: { value: string | undefined }
  container: { resolve: (name: string) => unknown }
  callSubmitOutcome?: boolean
}): OpenCodeRunnerClient {
  let emit: ((event: { type: string; properties: Record<string, unknown> }) => void) | null = null
  const sessionId = 'ses_fake_1'
  return {
    async createSession() {
      return { id: sessionId }
    },
    async sendMessage(_sessionId, message, options) {
      opts.agentSentRef.value = options?.agent
      // The runner embeds the session token in the message; capture it like the
      // MCP server would (ctx.sessionId === the run session token).
      const tokenMatch = /Session Authorization: (sess_[a-z0-9_]+)/i.exec(message)
      if (tokenMatch) opts.sessionTokenRef.value = tokenMatch[1]
      // Simulate the agent calling submit_outcome through the in-process handler,
      // passing the run session token as ctx.sessionId + the SAME container so the
      // handler resolves the shared store the runner opened.
      if (opts.callSubmitOutcome !== false) {
        await submitOutcomeTool.handler!(
          { outcome: opts.outcome },
          { sessionId: opts.sessionTokenRef.value, container: opts.container } as unknown as Parameters<
            NonNullable<typeof submitOutcomeTool.handler>
          >[1],
        )
      }
      // Emit busy then idle so the runner's SSE idle-detection fires.
      setTimeout(() => {
        emit?.({ type: 'session.status', properties: { sessionID: sessionId, status: { type: 'busy' } } })
        emit?.({ type: 'session.status', properties: { sessionID: sessionId, status: { type: 'idle' } } })
      }, 0)
      return {}
    },
    subscribeToEvents(onEvent) {
      emit = onEvent
      return () => {
        emit = null
      }
    },
  }
}

const validOutcome = {
  kind: 'actionable',
  proposal: {
    actions: [{ type: 'set_stage', payload: { stage: 'negotiation' } }],
    confidence: 0.82,
    rationale: 'Strong momentum, decision-maker engaged.',
  },
}

describe('OpenCodeAgentRunner (integration, fake client)', () => {
  const runCtx = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }

  it('runs the example file agent end-to-end: mints a caller-scoped token, sends the agent field, captures the outcome, persists run + proposal', async () => {
    const entry = registerExampleFileAgent()
    const { calls, commandBus, container } = makeHarness()
    const sessionTokenRef = { value: '' }
    const agentSentRef = { value: undefined as string | undefined }
    const client = makeFakeClient({ outcome: validOutcome, sessionTokenRef, agentSentRef, container })

    const runner = new OpenCodeAgentRunner({
      container: container as never,
      commandBus: commandBus as never,
      openCodeClient: client,
    })

    const result = await runner.run(entry, { dealId: 'deal-1' }, runCtx)

    // The captured outcome was shaped into the typed actionable AgentResult.
    expect(result.kind).toBe('actionable')
    if (result.kind === 'actionable') {
      expect(result.proposal.actions[0]).toEqual({ type: 'set_stage', payload: { stage: 'negotiation' } })
      expect(result.proposal.confidence).toBe(0.82)
    }

    // The `agent` field equals the sanitized OpenCode agent name.
    expect(agentSentRef.value).toBe(OPENCODE_AGENT_NAME)

    // A per-run session token was minted scoped to the caller (roles, tenant,
    // org, user) — NOT superadmin, NOT static.
    expect(createSessionApiKeyMock).toHaveBeenCalledTimes(1)
    const sessionInput = createSessionApiKeyMock.mock.calls[0][1] as {
      userId: string
      userRoles: string[]
      tenantId: string
      organizationId: string
      ttlMinutes: number
      sessionToken: string
    }
    expect(sessionInput.userId).toBe('user-1')
    expect(sessionInput.tenantId).toBe('tenant-1')
    expect(sessionInput.organizationId).toBe('org-1')
    expect(sessionInput.userRoles).toEqual(['role-caller'])
    expect(sessionInput.ttlMinutes).toBe(120)
    expect(sessionInput.sessionToken).toMatch(/^sess_/)

    // The run was created and completed (status ok), and a proposal was created.
    const ids = calls.map((c) => c.id)
    expect(ids).toContain('agent_orchestrator.runs.create')
    expect(ids).toContain('agent_orchestrator.runs.complete')
    expect(ids).toContain('agent_orchestrator.proposals.create')
    expect(ids).not.toContain('agent_orchestrator.runs.fail')

    const proposalCall = calls.find((c) => c.id === 'agent_orchestrator.proposals.create')!
    expect(proposalCall.input.runId).toBe('run-123')
    expect(proposalCall.input.confidence).toBe(0.82)

    // The per-run token was revoked after the run.
    expect(deleteSessionApiKeyMock).toHaveBeenCalledTimes(1)
  })

  it('stamps the declared model (alongside runtime) on runs.create so the cockpit can show/filter runs by model', async () => {
    const entry = registerExampleFileAgent()
    const { calls, commandBus, container } = makeHarness()
    const sessionTokenRef = { value: '' }
    const agentSentRef = { value: undefined as string | undefined }
    const client = makeFakeClient({ outcome: validOutcome, sessionTokenRef, agentSentRef, container })

    const runner = new OpenCodeAgentRunner({
      container: container as never,
      commandBus: commandBus as never,
      openCodeClient: client,
    })

    await runner.run(entry, { dealId: 'deal-1' }, runCtx)

    const createCall = calls.find((c) => c.id === 'agent_orchestrator.runs.create')!
    // model comes from the registry entry's declared defaultModel (was always null before).
    expect(createCall.input.model).toBe('claude-sonnet-4-6')
    // runtime + externalRunId remain stamped (F8) — model is additive alongside them.
    expect(createCall.input.runtime).toBe('opencode')
    expect(createCall.input.externalRunId).toBe('ses_fake_1')
  })

  it('invokes ctx.onRunPersisted with the created run id, and a throwing hook never fails the run', async () => {
    const entry = registerExampleFileAgent()
    const { commandBus, container } = makeHarness()
    const sessionTokenRef = { value: '' }
    const agentSentRef = { value: undefined as string | undefined }
    const client = makeFakeClient({ outcome: validOutcome, sessionTokenRef, agentSentRef, container })

    const runner = new OpenCodeAgentRunner({
      container: container as never,
      commandBus: commandBus as never,
      openCodeClient: client,
    })

    const observed: string[] = []
    const result = await runner.run(entry, { dealId: 'deal-1' }, {
      ...runCtx,
      onRunPersisted: (persistedRunId: string) => {
        observed.push(persistedRunId)
      },
    })
    expect(result.kind).toBe('actionable')
    expect(observed).toEqual(['run-123'])

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const client2 = makeFakeClient({ outcome: validOutcome, sessionTokenRef, agentSentRef, container })
      const runner2 = new OpenCodeAgentRunner({
        container: container as never,
        commandBus: commandBus as never,
        openCodeClient: client2,
      })
      const result2 = await runner2.run(entry, { dealId: 'deal-1' }, {
        ...runCtx,
        onRunPersisted: () => {
          throw new Error('[internal] hook boom')
        },
      })
      expect(result2.kind).toBe('actionable')
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('fails the run when the agent never submits an outcome (idle without outcome, after the corrective nudge)', async () => {
    const entry = registerExampleFileAgent()
    const { calls, commandBus, container } = makeHarness()
    const sessionTokenRef = { value: '' }
    const agentSentRef = { value: undefined as string | undefined }
    const client = makeFakeClient({
      outcome: validOutcome,
      sessionTokenRef,
      agentSentRef,
      container,
      callSubmitOutcome: false, // never call submit_outcome
    })

    const runner = new OpenCodeAgentRunner({
      container: container as never,
      commandBus: commandBus as never,
      openCodeClient: client,
    })

    await expect(runner.run(entry, { dealId: 'deal-1' }, runCtx)).rejects.toThrow(/no outcome submitted/)
    const ids = calls.map((c) => c.id)
    expect(ids).toContain('agent_orchestrator.runs.fail')
    expect(ids).not.toContain('agent_orchestrator.runs.complete')
    expect(deleteSessionApiKeyMock).toHaveBeenCalled()
  })

  it('dispatches opencode-runtime agents through the runner from AgentRuntimeService.run', async () => {
    const entry = registerExampleFileAgent()
    const { commandBus, container, registrations } = makeHarness()
    const sessionTokenRef = { value: '' }
    const agentSentRef = { value: undefined as string | undefined }
    registrations.openCodeClient = makeFakeClient({ outcome: validOutcome, sessionTokenRef, agentSentRef, container })

    const service = new AgentRuntimeService({ container: container as never, commandBus: commandBus as never })
    const result = await service.run(entry.id, { dealId: 'deal-1' }, runCtx)
    expect(result.kind).toBe('actionable')
    expect(agentSentRef.value).toBe(OPENCODE_AGENT_NAME)
  })

  it('propose-only: the example file agent declares NO mutation tool in its allowlist', () => {
    const entry = registerExampleFileAgent()
    // The example agent declares no tools at all; submit_outcome (the only tool
    // it always uses) is isMutation:false. There is no isMutation:true tool in
    // the effective allowlist — the propose-only contract holds.
    expect(entry.tools).toEqual([])
    expect(submitOutcomeTool.isMutation).toBe(false)
  })
})

