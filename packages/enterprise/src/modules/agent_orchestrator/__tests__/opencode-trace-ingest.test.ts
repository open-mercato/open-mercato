/**
 * #3628 — OpenCode-runtime runs must record the MCP tool calls they make as
 * trace spans/tool-calls. The runner captures tool parts off the SSE stream —
 * OpenCode's native `type: 'tool'` state machine (`state.status` running →
 * completed/error) as well as the legacy `tool_use` / `tool_result` shape — and,
 * on a successful run, ingests them via `ingestTrace` (correlated on
 * runtime+externalRunId so they land on the run it created).
 */
const createSessionApiKeyMock = jest.fn()
const deleteSessionApiKeyMock = jest.fn()
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  generateSessionToken: () => 'sess_trace_test_token',
  createSessionApiKey: (...args: unknown[]) => {
    createSessionApiKeyMock(...args)
    return Promise.resolve({ keyId: 'key-1', secret: 'omk_x', sessionToken: 'sess_trace_test_token' })
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

const ingestTraceMock = jest.fn(async () => ({ runId: 'run-123', created: false, spansAppended: 0, toolCallsAppended: 0 }))
jest.mock('../lib/trace/traceIngestionService', () => ({
  ingestTrace: (...args: unknown[]) => ingestTraceMock(...args),
}))

import { OpenCodeAgentRunner, type OpenCodeRunnerClient } from '../lib/runtime/openCodeAgentRunner'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { aiTools, SUBMIT_OUTCOME_TOOL_ID } from '../ai-tools'
import { compileOutcome } from '../lib/sdk/outcomeSchema'
import { InMemoryAgentRunSessionStore } from '../lib/runtime/agentRunSessionStore'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

const submitOutcomeTool = aiTools.find((t) => t.name === SUBMIT_OUTCOME_TOOL_ID) as AiToolDefinition

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

const FILE_AGENT_ID = 'support.resolution_advisor_trace_test'

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
    label: 'Resolution advisor (file)',
    description: 'Advise on a support ticket.',
    instructions: 'Advise.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5-mini',
    loop: { maxSteps: 12 },
    runtime: 'opencode',
  }
  registerFileAgent(entry)
  return entry
}

function makeHarness() {
  const commandBus = {
    async execute<I, O>(_id: string, _opts: { input: I }): Promise<{ result: O }> {
      return { result: { runId: 'run-123' } as unknown as O }
    },
  }
  const rbacService = { loadAcl: async () => ({ isSuperAdmin: false, features: ['agent_orchestrator.agents.run'] }) }
  // `em` needs a `fork()` because the runner forks it for the (mocked) trace ingest.
  const em = { fork: () => ({}) }
  const agentRunSessionStore = new InMemoryAgentRunSessionStore()
  const registrations: Record<string, unknown> = { rbacService, em, agentRunSessionStore }
  const container = {
    resolve(name: string) {
      if (name in registrations) return registrations[name]
      throw new Error(`unexpected resolve("${name}")`)
    },
  } as unknown as { resolve: (name: string) => unknown }
  return { commandBus, container }
}

const validOutcome = {
  kind: 'actionable',
  proposal: {
    actions: [{ type: 'set_stage', payload: { stage: 'resolved' } }],
    confidence: 0.9,
    rationale: 'Known issue with a documented fix.',
  },
}

/**
 * Fake client that emits OpenCode's native `type: 'tool'` SSE parts SYNCHRONOUSLY
 * at the top of sendMessage (before its first await), so they are captured before
 * the runner reads the outcome — mirroring how OpenCode streams tool parts mid-run
 * ahead of submit_outcome + idle. The same part id is re-emitted as the tool's
 * `state.status` advances (running → completed), exactly as the real server does;
 * the session id rides on `part.sessionID`, not at the top level.
 */
function makeFakeClient(opts: { container: { resolve: (name: string) => unknown } }): OpenCodeRunnerClient {
  let emit: ((event: { type: string; properties: Record<string, unknown> }) => void) | null = null
  const sessionId = 'ses_trace_1'
  const sessionTokenRef = { value: '' }
  return {
    async createSession() {
      return { id: sessionId }
    },
    async sendMessage(_sessionId, message, _options) {
      const tokenMatch = /Session Authorization: (sess_[a-z0-9_]+)/i.exec(message)
      if (tokenMatch) sessionTokenRef.value = tokenMatch[1]
      // Synchronous tool-part emission (before the first await) so the runner
      // captures them prior to reading the outcome. Native OpenCode shape: the
      // call opens at `state.status: running` and closes at `completed`.
      emit?.({
        type: 'message.part.updated',
        properties: { part: { type: 'tool', id: 'prt-1', sessionID: sessionId, callID: 'tc-1', tool: 'load_skill', state: { status: 'running', input: { skillId: 'resolution_playbook' } } } },
      })
      emit?.({
        type: 'message.part.updated',
        properties: { part: { type: 'tool', id: 'prt-1', sessionID: sessionId, callID: 'tc-1', tool: 'load_skill', state: { status: 'completed', input: { skillId: 'resolution_playbook' }, output: { ok: true } } } },
      })
      emit?.({
        type: 'message.part.updated',
        properties: { part: { type: 'tool', id: 'prt-2', sessionID: sessionId, callID: 'tc-2', tool: 'run_skill_script', state: { status: 'running', input: { scriptName: 'lookup_ticket_history' } } } },
      })
      await submitOutcomeTool.handler!(
        { outcome: validOutcome },
        { sessionId: sessionTokenRef.value, container: opts.container } as unknown as Parameters<NonNullable<typeof submitOutcomeTool.handler>>[1],
      )
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

describe('OpenCodeAgentRunner — trace ingestion (#3628)', () => {
  const runCtx = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('ingests captured tool calls as trace spans, correlated on runtime+externalRunId', async () => {
    const entry = registerExampleFileAgent()
    const { commandBus, container } = makeHarness()
    const runner = new OpenCodeAgentRunner({
      container: container as never,
      commandBus: commandBus as never,
      openCodeClient: makeFakeClient({ container }),
    })

    const result = await runner.run(entry, { subject: 'payouts stuck' }, runCtx)
    expect(result.kind).toBe('actionable')

    expect(ingestTraceMock).toHaveBeenCalledTimes(1)
    const [, scope, payload] = ingestTraceMock.mock.calls[0] as [
      unknown,
      { tenantId: string; organizationId: string },
      { runtime: string; externalRunId: string; agentId: string; spans: Array<{ name: string; kind: string; toolCalls?: Array<{ toolName: string; responseSummary?: unknown }> }> },
    ]
    expect(scope).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(payload.runtime).toBe('opencode')
    expect(payload.externalRunId).toBe('ses_trace_1')
    expect(payload.agentId).toBe(FILE_AGENT_ID)

    const toolNames = payload.spans.flatMap((s) => (s.toolCalls ?? []).map((c) => c.toolName))
    expect(toolNames).toEqual(['load_skill', 'run_skill_script'])
    // The `completed` state for tc-1 folded its output back onto the same span.
    const loadSkillSpan = payload.spans.find((s) => s.name === 'load_skill')
    expect(loadSkillSpan?.toolCalls?.[0]?.responseSummary).toEqual({ ok: true })
  })

  it('still captures the legacy tool_use/tool_result shape from older OpenCode builds', async () => {
    const entry = registerExampleFileAgent()
    const { commandBus, container } = makeHarness()
    let emit: ((event: { type: string; properties: Record<string, unknown> }) => void) | null = null
    const sessionId = 'ses_trace_legacy'
    const client: OpenCodeRunnerClient = {
      async createSession() {
        return { id: sessionId }
      },
      async sendMessage(_s, message) {
        const tokenMatch = /Session Authorization: (sess_[a-z0-9_]+)/i.exec(message)
        emit?.({
          type: 'message.part.updated',
          properties: { sessionID: sessionId, part: { type: 'tool_use', id: 'tc-1', name: 'load_skill', input: { skillId: 'resolution_playbook' } } },
        })
        emit?.({
          type: 'message.part.updated',
          properties: { sessionID: sessionId, part: { type: 'tool_result', tool_use_id: 'tc-1', content: { ok: true } } },
        })
        await submitOutcomeTool.handler!(
          { outcome: validOutcome },
          { sessionId: tokenMatch?.[1] ?? '', container } as unknown as Parameters<NonNullable<typeof submitOutcomeTool.handler>>[1],
        )
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
    const runner = new OpenCodeAgentRunner({
      container: container as never,
      commandBus: commandBus as never,
      openCodeClient: client,
    })

    await runner.run(entry, { subject: 'legacy parts' }, runCtx)

    expect(ingestTraceMock).toHaveBeenCalledTimes(1)
    const [, , payload] = ingestTraceMock.mock.calls[0] as [
      unknown,
      unknown,
      { spans: Array<{ name: string; toolCalls?: Array<{ toolName: string; responseSummary?: unknown }> }> },
    ]
    const loadSkillSpan = payload.spans.find((s) => s.name === 'load_skill')
    expect(loadSkillSpan?.toolCalls?.[0]?.responseSummary).toEqual({ ok: true })
  })

  it('writes no trace when the run observed no tool calls', async () => {
    const entry = registerExampleFileAgent()
    const { commandBus, container } = makeHarness()
    // A client that submits the outcome but emits no tool parts.
    let emit: ((event: { type: string; properties: Record<string, unknown> }) => void) | null = null
    const sessionId = 'ses_trace_2'
    const client: OpenCodeRunnerClient = {
      async createSession() {
        return { id: sessionId }
      },
      async sendMessage(_s, message) {
        const tokenMatch = /Session Authorization: (sess_[a-z0-9_]+)/i.exec(message)
        await submitOutcomeTool.handler!(
          { outcome: validOutcome },
          { sessionId: tokenMatch?.[1] ?? '', container } as unknown as Parameters<NonNullable<typeof submitOutcomeTool.handler>>[1],
        )
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
    const runner = new OpenCodeAgentRunner({
      container: container as never,
      commandBus: commandBus as never,
      openCodeClient: client,
    })

    await runner.run(entry, { subject: 'no tools' }, runCtx)
    expect(ingestTraceMock).not.toHaveBeenCalled()
  })
})
