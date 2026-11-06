jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  generateSessionToken: () => 'sess_integrity_test_token',
  createSessionApiKey: () => Promise.resolve({ keyId: 'key-1', secret: 'omk_x', sessionToken: 'sess_integrity_test_token' }),
  deleteSessionApiKey: () => Promise.resolve(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: () => Promise.resolve([{ role: { id: 'role-caller' } }]),
}))
jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({ UserRole: class UserRole {} }))

const persistVerdictMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock('../lib/guardrails/guardrailService', () => {
  const actual = jest.requireActual('../lib/guardrails/guardrailService')
  return { ...actual, persistVerdict: (...args: unknown[]) => persistVerdictMock(...args) }
})

const syncIntegritySetsMock = jest.fn<Promise<number>, unknown[]>()
jest.mock('../lib/guardrails/integrity/integritySets', () => {
  const actual = jest.requireActual('../lib/guardrails/integrity/integritySets')
  return { ...actual, syncIntegritySets: (...args: unknown[]) => syncIntegritySetsMock(...args) }
})

const putArtifactMock = jest.fn<Promise<string | null>, unknown[]>()
jest.mock('../lib/trace/artifactStore', () => {
  const actual = jest.requireActual('../lib/trace/artifactStore')
  return { ...actual, putArtifact: (...args: unknown[]) => putArtifactMock(...args) }
})

const emitRunReviewRequestedMock = jest.fn<Promise<boolean>, unknown[]>()
jest.mock('../lib/guardrails/integrity/reviewRequestedEvent', () => ({
  emitRunReviewRequested: (...args: unknown[]) => emitRunReviewRequestedMock(...args),
}))

import { z } from 'zod'
import { OpenCodeAgentRunner, type OpenCodeRunnerClient } from '../lib/runtime/openCodeAgentRunner'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { aiTools, SUBMIT_OUTCOME_TOOL_ID } from '../ai-tools'
import { InMemoryAgentRunSessionStore } from '../lib/runtime/agentRunSessionStore'
import { integrityRuleSchema, type IntegrityRuleInput } from '../data/validators'
import { AgentGuardrailBlockedError } from '../lib/runtime/errors'
import { ARTIFACT_REFS } from '../lib/trace/artifactStore'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

const submitOutcomeTool = aiTools.find((tool) => tool.name === SUBMIT_OUTCOME_TOOL_ID) as AiToolDefinition

const CONTENT = 'The supplier shall deliver within 30 days. Late delivery incurs a penalty of 2% per week.'

const outcomeSchema = z.object({
  kind: z.literal('research'),
  data: z.object({
    evidence: z.array(z.object({ quote: z.string() })),
    dealIds: z.array(z.string()).default([]),
  }),
})

const RAW_OUTCOME = {
  kind: 'research',
  data: {
    evidence: [{ quote: 'deliver within 30 days' }, { quote: 'free shipping forever' }],
    dealIds: [],
  },
}

const runCtx = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }

function registerOpenCodeAgent(id: string, integrity?: IntegrityRuleInput[], tools: string[] = []): AgentRegistryEntry {
  const existing = getAgentEntry(id)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id,
    moduleId: 'agent_orchestrator',
    resultKind: 'research',
    schema: outcomeSchema,
    tools,
    skills: [],
    subAgents: [],
    label: 'OpenCode integrity test agent',
    description: 'Research agent for OpenCode output pipeline tests.',
    instructions: 'research',
    runtime: 'opencode',
    ...(integrity ? { integrity: integrity.map((rule) => integrityRuleSchema.parse(rule)) } : {}),
  }
  registerFileAgent(entry)
  return entry
}

function quoteRule(onViolation: 'drop' | 'block'): IntegrityRuleInput {
  return {
    id: 'quotes',
    kind: 'evidence_quote',
    items: 'data.evidence[*]',
    quote: 'quote',
    source: { input: 'content' },
    onViolation,
  }
}

type CommandCall = { id: string; input: Record<string, unknown> }

function makeHarness() {
  const calls: CommandCall[] = []
  const commandBus = {
    async execute<I, O>(id: string, opts: { input: I }): Promise<{ result: O }> {
      calls.push({ id, input: opts.input as Record<string, unknown> })
      return { result: { runId: 'run-123' } as unknown as O }
    },
  }
  const em = { fork: () => em }
  const registrations: Record<string, unknown> = {
    rbacService: { loadAcl: async () => ({ isSuperAdmin: false, features: [] }) },
    em,
    agentRunSessionStore: new InMemoryAgentRunSessionStore(),
  }
  const container = {
    resolve(name: string) {
      if (name in registrations) return registrations[name]
      throw new Error(`unexpected resolve("${name}")`)
    },
  }
  return { calls, commandBus, container }
}

type ToolPart = { callId: string; tool: string; input: unknown; output: unknown }

function makeClient(
  container: { resolve: (name: string) => unknown },
  outcome: unknown,
  toolParts: ToolPart[] = [],
): OpenCodeRunnerClient {
  const sessionId = 'ses_integrity_1'
  let emit: ((event: { type: string; properties: Record<string, unknown> }) => void) | null = null
  return {
    async createSession() {
      return { id: sessionId }
    },
    async sendMessage(_sessionId, message) {
      const tokenMatch = /Session Authorization: (sess_[a-z0-9_]+)/i.exec(message)
      const sessionToken = tokenMatch ? tokenMatch[1] : ''
      for (const part of toolParts) {
        emit?.({
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              id: `prt-${part.callId}`,
              sessionID: sessionId,
              callID: part.callId,
              tool: part.tool,
              state: { status: 'completed', input: part.input, output: part.output },
            },
          },
        })
      }
      await submitOutcomeTool.handler!(
        { outcome },
        { sessionId: sessionToken, container } as unknown as Parameters<NonNullable<typeof submitOutcomeTool.handler>>[1],
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

function makeRunner(harness: ReturnType<typeof makeHarness>, client: OpenCodeRunnerClient): OpenCodeAgentRunner {
  return new OpenCodeAgentRunner({
    container: harness.container as never,
    commandBus: harness.commandBus as never,
    openCodeClient: client,
  })
}

type PersistedVerdict = {
  verdict: { result: string; checks: Array<{ kind: string; result: string; evidence?: Record<string, unknown> }> }
  phase: string
}

const savedIntegrityEnv = process.env.OM_AGENT_INTEGRITY

beforeEach(() => {
  delete process.env.OM_AGENT_INTEGRITY
  persistVerdictMock.mockReset().mockImplementation(async (...args: unknown[]) => {
    const persisted = args[2] as PersistedVerdict
    return persisted.verdict.checks
  })
  syncIntegritySetsMock.mockReset().mockResolvedValue(1)
  putArtifactMock.mockReset().mockResolvedValue('raw-output-key')
  emitRunReviewRequestedMock.mockReset().mockResolvedValue(false)
})

afterAll(() => {
  if (savedIntegrityEnv === undefined) delete process.env.OM_AGENT_INTEGRITY
  else process.env.OM_AGENT_INTEGRITY = savedIntegrityEnv
})

describe('OpenCodeAgentRunner output pipeline', () => {
  it('repairs the submitted outcome, persists the verdict and offloads the raw outcome', async () => {
    const entry = registerOpenCodeAgent('opencode.integrity_drop_agent', [quoteRule('drop')])
    const harness = makeHarness()

    const result = await makeRunner(harness, makeClient(harness.container, RAW_OUTCOME)).run(
      entry,
      { content: CONTENT },
      runCtx,
    )

    const finalData = { evidence: [{ quote: 'deliver within 30 days' }], dealIds: [] }
    expect(result).toEqual({ kind: 'research', data: finalData })
    const complete = harness.calls.find((call) => call.id === 'agent_orchestrator.runs.complete')
    expect(complete?.input.output).toEqual({ kind: 'research', data: finalData })
    expect(harness.calls.map((call) => call.id)).not.toContain('agent_orchestrator.runs.fail')

    expect(persistVerdictMock).toHaveBeenCalledTimes(1)
    const persisted = persistVerdictMock.mock.calls[0][2] as PersistedVerdict
    expect(persisted.phase).toBe('output')
    expect(persisted.verdict.result).toBe('warn')
    const quoteCheck = persisted.verdict.checks.find((check) => check.kind === 'evidence_quote')
    expect(quoteCheck?.evidence?.rawOutput).toEqual({ key: 'raw-output-key', status: 'stored' })
    expect(putArtifactMock).toHaveBeenCalledTimes(1)
    expect(putArtifactMock.mock.calls[0][2]).toBe(ARTIFACT_REFS.runRawOutput)
    expect(putArtifactMock.mock.calls[0][3]).toEqual(RAW_OUTCOME)
    expect(syncIntegritySetsMock).toHaveBeenCalledTimes(1)
    expect(emitRunReviewRequestedMock).toHaveBeenCalledTimes(1)
  })

  it('never blocks on OpenCode built-in tool calls: tool_scope sees no attempted tools', async () => {
    const entry = registerOpenCodeAgent('opencode.integrity_builtin_tools_agent', [quoteRule('drop')])
    const harness = makeHarness()
    const client = makeClient(harness.container, RAW_OUTCOME, [
      { callId: 'tc-1', tool: 'bash', input: { command: 'ls' }, output: 'out' },
      { callId: 'tc-2', tool: 'open-mercato_customers_delete_deal', input: { id: 'd1' }, output: { ok: true } },
    ])

    await makeRunner(harness, client).run(entry, { content: CONTENT }, runCtx)

    const persisted = persistVerdictMock.mock.calls[0][2] as PersistedVerdict
    const toolScope = persisted.verdict.checks.find((check) => check.kind === 'tool_scope')
    expect(toolScope?.result).toBe('pass')
    expect(persisted.verdict.result).not.toBe('block')
  })

  it('maps OpenCode MCP tool names back to registry ids for tool_consulted', async () => {
    const entry = registerOpenCodeAgent(
      'opencode.integrity_tool_consulted_agent',
      [
        {
          id: 'deals-read',
          kind: 'tool_consulted',
          cites: 'data.dealIds[*]',
          tools: ['customers.get_deal'],
          returned: ['id'],
          onViolation: 'block',
        },
      ],
      ['customers.get_deal'],
    )
    const harness = makeHarness()
    const outcome = { kind: 'research', data: { evidence: [], dealIds: ['deal-7'] } }
    const client = makeClient(harness.container, outcome, [
      { callId: 'tc-1', tool: 'open-mercato_customers_get_deal', input: { id: 'deal-7' }, output: { id: 'deal-7' } },
    ])

    const result = await makeRunner(harness, client).run(entry, { content: CONTENT }, runCtx)

    expect(result).toEqual({ kind: 'research', data: { evidence: [], dealIds: ['deal-7'] } })
    const persisted = persistVerdictMock.mock.calls[0][2] as PersistedVerdict
    expect(persisted.verdict.checks.find((check) => check.kind === 'tool_consulted')?.result).toBe('pass')
  })

  it('fails the run with a typed guardrail block carrying the rule id', async () => {
    const entry = registerOpenCodeAgent('opencode.integrity_block_agent', [quoteRule('block')])
    const harness = makeHarness()

    const failure = makeRunner(harness, makeClient(harness.container, RAW_OUTCOME)).run(
      entry,
      { content: CONTENT },
      runCtx,
    )

    await expect(failure).rejects.toBeInstanceOf(AgentGuardrailBlockedError)
    await expect(failure).rejects.toMatchObject({ kind: 'evidence_quote', phase: 'output', ruleId: 'quotes' })
    const ids = harness.calls.map((call) => call.id)
    expect(ids).toContain('agent_orchestrator.runs.fail')
    expect(ids).not.toContain('agent_orchestrator.runs.complete')
    const persisted = persistVerdictMock.mock.calls[0][2] as PersistedVerdict
    expect(persisted.verdict.result).toBe('block')
    expect(emitRunReviewRequestedMock).not.toHaveBeenCalled()
  })

  it('records a would-be block as a warning in shadow mode and keeps the raw outcome', async () => {
    process.env.OM_AGENT_INTEGRITY = 'off'
    const entry = registerOpenCodeAgent('opencode.integrity_shadow_agent', [quoteRule('block')])
    const harness = makeHarness()

    const result = await makeRunner(harness, makeClient(harness.container, RAW_OUTCOME)).run(
      entry,
      { content: CONTENT },
      runCtx,
    )

    expect(result).toEqual(RAW_OUTCOME)
    const persisted = persistVerdictMock.mock.calls[0][2] as PersistedVerdict
    const quoteCheck = persisted.verdict.checks.find((check) => check.kind === 'evidence_quote')
    expect(quoteCheck?.result).toBe('warn')
    expect(quoteCheck?.evidence?.wouldBlock).toBe(true)
    expect(putArtifactMock).not.toHaveBeenCalled()
  })

  it('passes the persisted guard results to the proposal', async () => {
    const id = 'opencode.integrity_proposal_agent'
    const entry: AgentRegistryEntry = getAgentEntry(id) ?? {
      id,
      moduleId: 'agent_orchestrator',
      resultKind: 'proposal',
      schema: z.object({
        kind: z.literal('proposal'),
        proposal: z.object({
          actions: z.array(z.object({ type: z.string(), payload: z.record(z.string(), z.unknown()) })).min(1),
          confidence: z.number(),
          rationale: z.string(),
          evidence: z.array(z.object({ quote: z.string() })),
        }),
      }),
      tools: [],
      skills: [],
      subAgents: [],
      label: 'OpenCode integrity proposal agent',
      description: 'Proposal agent for OpenCode output pipeline tests.',
      instructions: 'propose',
      runtime: 'opencode',
      integrity: [integrityRuleSchema.parse({ ...quoteRule('drop'), items: 'proposal.evidence[*]' })],
    }
    if (!getAgentEntry(id)) registerFileAgent(entry)
    const harness = makeHarness()
    const outcome = {
      kind: 'proposal',
      proposal: {
        actions: [{ type: 'set_stage', payload: { stage: 'negotiation' } }],
        confidence: 0.7,
        rationale: 'Delivery terms are clear.',
        evidence: [{ quote: 'deliver within 30 days' }, { quote: 'free shipping forever' }],
      },
    }

    await makeRunner(harness, makeClient(harness.container, outcome)).run(entry, { content: CONTENT }, runCtx)

    const proposal = harness.calls.find((call) => call.id === 'agent_orchestrator.proposals.create')
    const guardResults = proposal?.input.guardResults as Array<{ kind: string; result: string }> | undefined
    expect(guardResults?.find((check) => check.kind === 'evidence_quote')?.result).toBe('warn')
  })

  it('keeps schema-only behavior for an agent without integrity rules', async () => {
    const entry = registerOpenCodeAgent('opencode.no_integrity_agent')
    const harness = makeHarness()

    const result = await makeRunner(harness, makeClient(harness.container, RAW_OUTCOME)).run(
      entry,
      { content: CONTENT },
      runCtx,
    )

    expect(result).toEqual(RAW_OUTCOME)
    expect(harness.calls.find((call) => call.id === 'agent_orchestrator.runs.complete')?.input.output).toEqual(
      RAW_OUTCOME,
    )
    expect(persistVerdictMock).not.toHaveBeenCalled()
    expect(putArtifactMock).not.toHaveBeenCalled()
    expect(syncIntegritySetsMock).not.toHaveBeenCalled()
    expect(emitRunReviewRequestedMock).not.toHaveBeenCalled()
  })
})
