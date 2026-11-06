const SESSION_TOKEN = 'sess_msg_test_token'

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  generateSessionToken: () => 'sess_msg_test_token',
  createSessionApiKey: () => Promise.resolve({ keyId: 'key-1', secret: 'omk_x', sessionToken: 'sess_msg_test_token' }),
  deleteSessionApiKey: () => Promise.resolve(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: () => Promise.resolve([{ role: { id: 'role-caller' } }]),
}))
jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({ UserRole: class UserRole {} }))

import { OpenCodeAgentRunner, type OpenCodeRunnerClient } from '../lib/runtime/openCodeAgentRunner'
import {
  buildOpenCodeMessageSpans,
  buildReconstructedRequest,
  createOpenCodeMessageCollector,
  mergeMessageAndToolSpans,
  resolveObservedModel,
} from '../lib/runtime/openCodeMessageTrace'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { aiTools, SUBMIT_OUTCOME_TOOL_ID } from '../ai-tools'
import { compileOutcome } from '../lib/sdk/outcomeSchema'
import { InMemoryAgentRunSessionStore } from '../lib/runtime/agentRunSessionStore'
import { RUN_MANIFEST_SPAN_NAME } from '../lib/trace/runManifest'
import {
  buildIngestLlmContent,
  buildIngestLlmMetadataAttributes,
  mergeIngestLlmAttributes,
} from '../lib/trace/ingestLlmAttributes'
import { normalizeGenAiAttributes } from '../lib/trace/genAiAttributes'
import { buildLlmRequestArtifact } from '../lib/trace/contentCapture'
import { traceIngestSchema, type TraceSpanIngest } from '../data/validators'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

type SseEvent = { type: string; properties: Record<string, unknown> }

const submitOutcomeTool = aiTools.find((tool) => tool.name === SUBMIT_OUTCOME_TOOL_ID) as AiToolDefinition

const { resultSchema } = compileOutcome({
  kind: 'proposal',
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

const FILE_AGENT_ID = 'support.message_spans_test'
const AGENT_INSTRUCTIONS = 'Advise on the ticket and submit the outcome.'
const SESSION_ID = 'ses_msg_1'

function registerAgent(): AgentRegistryEntry {
  const existing = getAgentEntry(FILE_AGENT_ID)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id: FILE_AGENT_ID,
    moduleId: 'agent_examples',
    resultKind: 'proposal',
    schema: resultSchema,
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Message spans advisor',
    description: 'Advise on a support ticket.',
    instructions: AGENT_INSTRUCTIONS,
    defaultProvider: 'openai',
    defaultModel: 'gpt-5-mini',
    loop: { maxSteps: 12 },
    runtime: 'opencode',
  }
  registerFileAgent(entry)
  return entry
}

type RecordedCommand = { id: string; input: unknown }

type IngestInput = {
  payload: { spans: TraceSpanIngest[] }
}

function makeHarness(capturePolicy?: unknown) {
  const executed: RecordedCommand[] = []
  const commandBus = {
    executed,
    async execute<I, O>(id: string, opts: { input: I }): Promise<{ result: O }> {
      executed.push({ id, input: opts.input })
      return { result: { runId: 'run-msg' } as unknown as O }
    },
  }
  const registrations: Record<string, unknown> = {
    rbacService: { loadAcl: async () => ({ isSuperAdmin: false, features: ['agent_orchestrator.agents.run'] }) },
    em: { fork: () => ({}) },
    agentRunSessionStore: new InMemoryAgentRunSessionStore(),
  }
  if (capturePolicy !== undefined) {
    registrations.moduleConfigService = { getRecord: async () => ({ value: capturePolicy }) }
  }
  const container = {
    resolve(name: string) {
      if (name in registrations) return registrations[name]
      throw new Error(`unexpected resolve("${name}")`)
    },
  }
  return { commandBus, container }
}

const validOutcome = {
  kind: 'proposal',
  proposal: {
    actions: [{ type: 'set_stage', payload: { stage: 'resolved' } }],
    confidence: 0.9,
    rationale: 'Known issue with a documented fix.',
  },
}

function messageEvents(): SseEvent[] {
  return [
    { type: 'message.updated', properties: { info: { id: 'msg-user', role: 'user', sessionID: SESSION_ID } } },
    {
      type: 'message.updated',
      properties: {
        info: {
          id: 'msg-a1',
          role: 'assistant',
          sessionID: SESSION_ID,
          modelID: 'claude-sonnet-4-5',
          providerID: 'anthropic',
          time: { created: 1_761_600_000_000 },
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: { type: 'text', id: 'prt-t1', sessionID: SESSION_ID, messageID: 'msg-a1', text: `Echo "_sessionToken": "${SESSION_TOKEN}"` },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          id: 'prt-1',
          sessionID: SESSION_ID,
          messageID: 'msg-a1',
          callID: 'tc-1',
          tool: 'load_skill',
          state: { status: 'running', input: { skillId: 'resolution_playbook' } },
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          id: 'prt-1',
          sessionID: SESSION_ID,
          messageID: 'msg-a1',
          callID: 'tc-1',
          tool: 'load_skill',
          state: { status: 'completed', input: { skillId: 'resolution_playbook' }, output: { ok: true } },
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'step-finish',
          id: 'prt-s1',
          sessionID: SESSION_ID,
          messageID: 'msg-a1',
          reason: 'tool-calls',
          cost: 0.0123456,
          tokens: { input: 1200, output: 80, reasoning: 16, cache: { read: 300, write: 0 } },
        },
      },
    },
    {
      type: 'message.updated',
      properties: {
        info: {
          id: 'msg-a1',
          role: 'assistant',
          sessionID: SESSION_ID,
          modelID: 'claude-sonnet-4-5',
          providerID: 'anthropic',
          time: { created: 1_761_600_000_000, completed: 1_761_600_002_500 },
          tokens: { input: 1200, output: 80 },
        },
      },
    },
    { type: 'message.updated', properties: {} },
    { type: 'message.updated', properties: { info: { role: 'assistant' } } },
    { type: 'message.part.updated', properties: { part: { type: 'step-finish', cost: 9 } } },
    { type: 'message.part.updated', properties: { part: 'garbage' } },
    {
      type: 'message.updated',
      properties: {
        info: {
          id: 'msg-a2',
          role: 'assistant',
          sessionID: SESSION_ID,
          modelID: 'claude-sonnet-4-5',
          providerID: 'anthropic',
          tokens: { input: 'many', output: 40 },
          cost: 0.002,
          time: { created: 1_761_600_003_000, completed: 1_761_600_004_000 },
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: { part: { type: 'text', id: 'prt-t2', sessionID: SESSION_ID, messageID: 'msg-a2', text: 'Submitting the outcome.' } },
    },
    {
      type: 'message.updated',
      properties: { info: { id: 'msg-foreign', role: 'assistant', sessionID: 'ses_other', modelID: 'other-model' } },
    },
  ]
}

function makeClient(container: { resolve: (name: string) => unknown }, events: SseEvent[]) {
  let emit: ((event: SseEvent) => void) | null = null
  const sentMessages: string[] = []
  const client: OpenCodeRunnerClient = {
    async createSession() {
      return { id: SESSION_ID }
    },
    async sendMessage(_sessionId, message) {
      sentMessages.push(message)
      const tokenMatch = /Session Authorization: (sess_[a-z0-9_]+)/i.exec(message)
      for (const event of events) emit?.(event)
      await submitOutcomeTool.handler!(
        { outcome: validOutcome },
        { sessionId: tokenMatch?.[1] ?? '', container } as unknown as Parameters<NonNullable<typeof submitOutcomeTool.handler>>[1],
      )
      setTimeout(() => {
        emit?.({ type: 'session.status', properties: { sessionID: SESSION_ID, status: { type: 'busy' } } })
        emit?.({ type: 'session.status', properties: { sessionID: SESSION_ID, status: { type: 'idle' } } })
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
  return { client, sentMessages }
}

async function runWith(capturePolicy: unknown, events: SseEvent[]) {
  const entry = registerAgent()
  const { commandBus, container } = makeHarness(capturePolicy)
  const { client, sentMessages } = makeClient(container, events)
  const runner = new OpenCodeAgentRunner({
    container: container as never,
    commandBus: commandBus as never,
    openCodeClient: client,
  })
  await runner.run(entry, { subject: 'payouts stuck' }, { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' })
  const ingest = commandBus.executed.find((call) => call.id === 'agent_orchestrator.trace.ingest')?.input as
    | IngestInput
    | undefined
  if (!ingest) throw new Error('no trace ingest recorded')
  return { spans: ingest.payload.spans, ingest, executed: commandBus.executed, sentMessages }
}

function llmSpans(spans: TraceSpanIngest[]): TraceSpanIngest[] {
  return spans.filter((span) => span.kind === 'llm')
}

function manifestAttributes(spans: TraceSpanIngest[]): Record<string, unknown> {
  const manifest = spans.find((span) => span.name === RUN_MANIFEST_SPAN_NAME)
  return (manifest?.attributes ?? {}) as Record<string, unknown>
}

function storedAttributes(span: TraceSpanIngest): Record<string, unknown> {
  return normalizeGenAiAttributes(
    mergeIngestLlmAttributes(span.attributes, buildIngestLlmMetadataAttributes(span.llm!), {}),
  )
}

function withoutTimes(spans: TraceSpanIngest[]): unknown[] {
  return spans.map((span) => {
    const copy: Record<string, unknown> = { ...span }
    delete copy.startedAt
    delete copy.endedAt
    delete copy.durationMs
    return copy
  })
}

describe('OpenCode per-message llm spans', () => {
  afterEach(() => {
    delete process.env.OM_AGENT_TRACE_CAPTURE
  })

  it('emits one llm span per assistant message with reported usage, model and cost at metadata', async () => {
    const { spans, ingest } = await runWith({ level: 'metadata' }, messageEvents())

    expect(traceIngestSchema.safeParse(ingest.payload).success).toBe(true)
    const messages = llmSpans(spans)
    expect(messages.map((span) => span.externalSpanId)).toEqual([`${SESSION_ID}:msg:msg-a1`, `${SESSION_ID}:msg:msg-a2`])
    expect(messages[0].llm).toEqual({
      provider: 'anthropic',
      requestModel: 'claude-sonnet-4-5',
      responseModel: 'claude-sonnet-4-5',
      usage: { inputTokens: 1200, outputTokens: 80, reasoningTokens: 16, cachedInputTokens: 300 },
    })
    expect(messages[0].startedAt).toBe(new Date(1_761_600_000_000).toISOString())
    expect(messages[0].durationMs).toBe(2500)

    const first = storedAttributes(messages[0])
    expect(first).toMatchObject({
      'gen_ai.provider.name': 'anthropic',
      'gen_ai.request.model': 'claude-sonnet-4-5',
      'gen_ai.response.model': 'claude-sonnet-4-5',
      'gen_ai.usage.input_tokens': 1200,
      'gen_ai.usage.output_tokens': 80,
      'gen_ai.usage.reasoning.output_tokens': 16,
      'gen_ai.usage.cache_read.input_tokens': 300,
      'gen_ai.response.finish_reasons': ['tool-calls'],
      'om.capture.fidelity': 'reported',
      'om.cost.micros': 12346,
      'om.cost.currency': 'USD',
      'om.cost.pricing_source': 'reported',
      'om.latency.ms': 2500,
    })

    expect(messages[1].llm?.usage).toEqual({ outputTokens: 40 })
    expect(storedAttributes(messages[1])['om.cost.micros']).toBe(2000)
    expect(messages.every((span) => span.llm?.request === undefined && span.llm?.response === undefined)).toBe(true)
  })

  it('parents tool spans to the message that issued them and orders spans by start time', async () => {
    const { spans } = await runWith({ level: 'metadata' }, messageEvents())

    const toolSpan = spans.find((span) => span.kind === 'tool')
    expect(toolSpan?.parentExternalSpanId).toBe(`${SESSION_ID}:msg:msg-a1`)
    expect(spans.map((span) => span.sequence)).toEqual(spans.map((_span, index) => index))
    expect(spans[spans.length - 1].name).toBe(RUN_MANIFEST_SPAN_NAME)
  })

  it('records the observed model and provider in the run manifest', async () => {
    const { spans } = await runWith({ level: 'metadata' }, messageEvents())

    const attributes = manifestAttributes(spans)
    expect(attributes['om.model.declared']).toBe('gpt-5-mini')
    expect(attributes['om.model.resolved']).toBe('claude-sonnet-4-5')
    expect(attributes['om.provider']).toBe('anthropic')
  })

  it('attaches a reconstructed, redacted request and the assistant text at full', async () => {
    const { spans, executed, sentMessages } = await runWith({ level: 'full' }, messageEvents())

    expect(sentMessages[0]).toContain(SESSION_TOKEN)
    const messages = llmSpans(spans)
    const request = messages[0].llm?.request
    expect(request?.reconstructed).toBe(true)
    expect(request?.system).toBe(AGENT_INSTRUCTIONS)
    expect(JSON.stringify(request?.messages)).toContain('payouts stuck')
    expect(messages[1].llm?.request).toBeUndefined()
    expect(messages[1].llm?.response).toEqual({ content: [{ type: 'text', text: 'Submitting the outcome.' }] })
    expect(messages[0].llm?.response?.finishReason).toBe('tool-calls')

    expect(JSON.stringify(executed)).not.toContain(SESSION_TOKEN)

    const content = buildIngestLlmContent(messages[0].llm!)
    const artifact = buildLlmRequestArtifact(content!.request, { redactPii: false })
    expect(artifact.payload).toMatchObject({ schema: 'om.llm_request.v1', reconstructed: true })
    expect(JSON.stringify(artifact.payload)).not.toContain(SESSION_TOKEN)
  })

  it('keeps the legacy payload when the capture level is off', async () => {
    const withMessages = await runWith({ level: 'off' }, messageEvents())
    const toolOnlyEvents = messageEvents().filter(
      (event) => event.type === 'message.part.updated' && (event.properties.part as { type?: string } | undefined)?.type === 'tool',
    )
    const legacy = await runWith({ level: 'off' }, toolOnlyEvents)

    expect(llmSpans(withMessages.spans)).toHaveLength(0)
    expect(withoutTimes(withMessages.spans)).toEqual(withoutTimes(legacy.spans))
    expect(manifestAttributes(withMessages.spans)).not.toHaveProperty('om.model.resolved')
    expect(manifestAttributes(withMessages.spans)).not.toHaveProperty('om.provider')
    expect(withMessages.spans.some((span) => span.parentExternalSpanId)).toBe(false)
  })

  it('emits no message spans when trace capture is disabled by the deployment', async () => {
    process.env.OM_AGENT_TRACE_CAPTURE = 'off'
    const { spans } = await runWith(undefined, messageEvents())

    expect(llmSpans(spans)).toHaveLength(0)
    expect(spans.map((span) => span.name)).toEqual(['load_skill'])
  })
})

describe('openCodeMessageTrace helpers', () => {
  it('ignores malformed events and non-assistant messages', () => {
    const collector = createOpenCodeMessageCollector(() => 1_000)
    collector.observe('message.updated', { info: null })
    collector.observe('message.updated', { info: { id: '', role: 'assistant' } })
    collector.observe('message.part.updated', { part: { type: 'text', id: 'x' } })
    collector.observe('message.part.updated', { part: { type: 'step-finish', messageID: 'm1', tokens: 'lots', cost: -1 } })
    collector.observe('message.updated', { info: { id: 'm-user', role: 'user', modelID: 'model-x' } })
    collector.observe('session.status', { info: { id: 'm-status', role: 'assistant' } })

    const messages = collector.assistantMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ id: 'm1', usage: null, costUsd: null, modelId: null })
    expect(resolveObservedModel(messages)).toBeNull()
  })

  it('falls back to the message info usage and cost when no step-finish part arrived', () => {
    const collector = createOpenCodeMessageCollector(() => 5_000)
    collector.observe('message.updated', {
      info: { id: 'm1', role: 'assistant', modelID: 'gpt-5', providerID: 'openai', tokens: { input: 10.4, output: 2 }, cost: 0.5 },
    })
    const [message] = collector.assistantMessages()
    expect(message.usage).toEqual({ inputTokens: 10, outputTokens: 2 })
    expect(message.costUsd).toBe(0.5)

    const [span] = buildOpenCodeMessageSpans({ externalRunId: 'ses', messages: [message], request: null, includeResponses: false })
    expect(span).toMatchObject({ kind: 'llm', status: 'ok', startedAt: new Date(5_000).toISOString(), durationMs: 0 })
    expect(span.attributes).toEqual({ 'om.cost.micros': 500000, 'om.cost.currency': 'USD', 'om.cost.pricing_source': 'reported' })
  })

  it('sums the usage and cost of several steps in one message', () => {
    const collector = createOpenCodeMessageCollector()
    collector.observe('message.part.updated', { part: { type: 'step-finish', id: 's1', messageID: 'm1', cost: 0.1, tokens: { input: 5, output: 1 } } })
    collector.observe('message.part.updated', { part: { type: 'step-finish', id: 's2', messageID: 'm1', cost: 0.2, tokens: { input: 7, output: 3 } } })
    collector.observe('message.part.updated', { part: { type: 'step-finish', id: 's2', messageID: 'm1', cost: 0.2, tokens: { input: 7, output: 3 } } })
    const [message] = collector.assistantMessages()
    expect(message.usage).toEqual({ inputTokens: 12, outputTokens: 4 })
    expect(message.costUsd).toBeCloseTo(0.3)
  })

  it('redacts the session authorization line from the reconstructed request', () => {
    const request = buildReconstructedRequest({
      system: null,
      message: `[Session Authorization: ${SESSION_TOKEN}. Include "_sessionToken": "${SESSION_TOKEN}" in EVERY tool call.]\n\nhello`,
    })
    expect(request.reconstructed).toBe(true)
    expect(request).not.toHaveProperty('system')
    expect(JSON.stringify(request)).not.toContain(SESSION_TOKEN)
    expect(JSON.stringify(request)).toContain('hello')
  })

  it('leaves tool spans unparented when their message produced no span', () => {
    const tool: TraceSpanIngest = {
      externalSpanId: 'tc-1-0',
      sequence: 0,
      name: 'load_skill',
      kind: 'tool',
      startedAt: new Date(2_000).toISOString(),
      status: 'ok',
    }
    const [message] = buildOpenCodeMessageSpans({
      externalRunId: 'ses',
      messages: [
        {
          id: 'm1',
          modelId: null,
          providerId: null,
          usage: null,
          costUsd: null,
          finishReason: null,
          createdMs: 1_000,
          completedMs: 3_000,
          firstSeenMs: 1_000,
          lastSeenMs: 3_000,
          failed: false,
          text: null,
        },
      ],
      request: null,
      includeResponses: false,
    })
    const merged = mergeMessageAndToolSpans([message], [{ span: tool, messageId: 'm-unknown' }], 'ses')
    expect(merged.map((span) => [span.name, span.sequence, span.parentExternalSpanId])).toEqual([
      ['llm', 0, undefined],
      ['load_skill', 1, undefined],
    ])
  })
})
