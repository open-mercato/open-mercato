import { describe, expect, test } from '@jest/globals'
import { GEN_AI_SEMCONV_VERSION } from '../lib/trace/genAiAttributes'
import { agentSpanId, dispositionSpanId, runSpanId, traceIdFor, workflowSpanId } from '../lib/trace/otel/ids'
import type {
  RunExportBundle,
  RunExportRun,
  RunExportSpan,
} from '../lib/trace/otel/loadRunExportBundle'
import {
  OTEL_EXPORT_CHUNK_SIZE,
  OTEL_EXPORT_SCOPE_NAME,
  mapAgentRunToOtlp,
  parseTraceparent,
  type MapAgentRunBundle,
  type MapAgentRunToOtlpOptions,
} from '../lib/trace/otel/mapAgentRunToOtlp'
import {
  encodeOtlpTraceRequest,
  type OtlpAttributeValue,
  type OtlpResourceSpansInput,
  type OtlpSpanInput,
} from '../lib/trace/otel/otlpJson'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const SIBLING_RUN_ID = '33333333-3333-4333-8333-333333333334'
const PARENT_RUN_ID = '44444444-4444-4444-8444-444444444444'
const RERUN_OF_RUN_ID = '44444444-4444-4444-8444-444444444445'
const WORKFLOW_INSTANCE_ID = '55555555-5555-4555-8555-555555555555'
const PROCESS_ID = '66666666-6666-4666-8666-666666666666'
const LLM_SPAN_ID = '77777777-7777-4777-8777-777777777701'
const TOOL_SPAN_ID = '77777777-7777-4777-8777-777777777702'
const SYSTEM_SPAN_ID = '77777777-7777-4777-8777-777777777703'
const EFFECTOR_SPAN_ID = '77777777-7777-4777-8777-777777777704'
const PROPOSAL_ID = '88888888-8888-4888-8888-888888888801'
const PENDING_PROPOSAL_ID = '88888888-8888-4888-8888-888888888802'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const PLATFORM_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const PLATFORM_SPAN_ID = '00f067aa0ba902b7'
const RERUN_TRACE_ID = '0af7651916cd43dd8448eb211c80319c'

const FREE_TEXT_SENTINEL = 'SENTINEL-free-text-must-not-leak'
const FORBIDDEN_KEYS = ['input', 'output', 'payload', 'evidence', 'disposition_reason', 'dispositionReason', 'errorMessage', 'subject_title']

const OPTIONS: MapAgentRunToOtlpOptions = {
  exportUserIds: false,
  serviceName: 'open-mercato-agents',
  serviceVersion: '1.2.3',
  scopeVersion: '0.10.0',
}

const T0 = new Date('2026-10-27T10:00:00.000Z')

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs)
}

function buildRun(overrides: Partial<RunExportRun> = {}): RunExportRun {
  return {
    id: RUN_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    agentId: 'sales.quote_drafter',
    source: 'runtime',
    status: 'ok',
    parentRunId: null,
    rerunOfRunId: null,
    workflowInstanceId: null,
    stepId: null,
    invocationId: null,
    proposalId: null,
    agentVersion: '3',
    model: 'gpt-test',
    runtime: 'native',
    confidence: 0.8,
    inputTokens: 120,
    outputTokens: 40,
    costMinor: 2,
    currency: 'USD',
    latencyMs: 5000,
    resultKind: 'proposal',
    agentType: 'decision_maker',
    createdAt: T0,
    completedAt: at(5000),
    ...overrides,
  }
}

function buildSpan(overrides: Partial<RunExportSpan> & Pick<RunExportSpan, 'id' | 'kind' | 'name'>): RunExportSpan {
  return {
    externalSpanId: overrides.id,
    parentSpanId: null,
    sequence: 0,
    status: 'ok',
    startedAt: at(100),
    endedAt: at(900),
    durationMs: 800,
    attributes: null,
    ...overrides,
  }
}

function buildBundle(overrides: Partial<MapAgentRunBundle> = {}): MapAgentRunBundle {
  const run = overrides.run ?? buildRun()
  return {
    run,
    rootRunId: run.id,
    agentLabel: 'Quote drafter',
    manifest: null,
    spans: [],
    effectorSpans: [],
    toolCalls: [],
    proposals: [],
    evalResults: [],
    guardrailChecks: [],
    processInstance: null,
    ...overrides,
  }
}

function standaloneBundle(): MapAgentRunBundle {
  return buildBundle({
    manifest: {
      'om.agent.definition_hash': 'def-hash-1',
      'om.prompt.override': { id: 'override-1', version: 4 },
      'om.tools.sha256': 'tools-hash-1',
      'om.knowledge': { pricing: 'v7' },
      'om.entry_point': 'playground',
      'om.channel': 'backend',
      'om.correlation_id': 'corr-1',
      'om.invoker': { kind: 'user', userId: USER_ID },
      'om.platform_trace': { traceparent: `00-${PLATFORM_TRACE_ID}-${PLATFORM_SPAN_ID}-01` },
    },
    spans: [
      buildSpan({
        id: LLM_SPAN_ID,
        kind: 'llm',
        name: 'llm.step',
        attributes: {
          'gen_ai.provider.name': 'openai',
          'gen_ai.request.model': 'gpt-test',
          'gen_ai.response.model': 'gpt-test-2026',
          'gen_ai.request.temperature': 0.2,
          'gen_ai.usage.input_tokens': 100,
          'gen_ai.usage.output_tokens': 30,
          'gen_ai.response.finish_reasons': ['tool-calls'],
          'om.cost.micros': 1500,
          'om.capture.fidelity': 'exact',
          prompt: FREE_TEXT_SENTINEL,
        },
      }),
      buildSpan({
        id: TOOL_SPAN_ID,
        kind: 'tool',
        name: 'search_catalog',
        parentSpanId: LLM_SPAN_ID,
        sequence: 1,
        startedAt: at(300),
        attributes: { input: FREE_TEXT_SENTINEL, output: FREE_TEXT_SENTINEL },
      }),
      buildSpan({
        id: SYSTEM_SPAN_ID,
        kind: 'system',
        name: 'context.bundle',
        sequence: 2,
        attributes: { evidence: FREE_TEXT_SENTINEL },
      }),
    ],
    toolCalls: [
      { id: 'tc-1', spanId: TOOL_SPAN_ID, toolName: 'catalog.search', status: 'ok', isError: false, latencyMs: 120, createdAt: at(300) },
    ],
  })
}

function allSpans(resourceSpans: OtlpResourceSpansInput[]): OtlpSpanInput[] {
  return resourceSpans.flatMap((entry) => entry.scopeSpans.flatMap((scopeSpans) => [...scopeSpans.spans]))
}

function spanByName(resourceSpans: OtlpResourceSpansInput[], name: string): OtlpSpanInput {
  const span = allSpans(resourceSpans).find((candidate) => candidate.name === name)
  if (!span) throw new Error(`[internal] span ${name} not found`)
  return span
}

function attr(span: OtlpSpanInput, key: string): OtlpAttributeValue {
  return span.attributes?.[key]
}

function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key)
      if (key === 'key' && typeof nested === 'string') keys.add(nested)
      collectKeys(nested, keys)
    }
  }
}

function expectExportSafe(resourceSpans: OtlpResourceSpansInput[]): void {
  const encoded = encodeOtlpTraceRequest(resourceSpans)
  const serialized = JSON.stringify(encoded)
  expect(serialized).not.toContain(FREE_TEXT_SENTINEL)
  const keys = new Set<string>()
  collectKeys(encoded, keys)
  for (const forbidden of FORBIDDEN_KEYS) expect(keys.has(forbidden)).toBe(false)
}

describe('mapAgentRunToOtlp', () => {
  test('standalone run maps run, chat, tool and system spans with the resource and scope', () => {
    const output = mapAgentRunToOtlp(standaloneBundle(), { ...OPTIONS, environment: 'staging' })
    expectExportSafe(output)
    expect(output).toHaveLength(1)
    expect(output[0].resource.attributes).toEqual({
      'service.name': 'open-mercato-agents',
      'service.version': '1.2.3',
      'deployment.environment.name': 'staging',
      'om.tenant.id': TENANT_ID,
      'om.organization.id': ORG_ID,
      'om.genai.semconv': GEN_AI_SEMCONV_VERSION,
    })
    expect(output[0].scopeSpans[0].scope).toEqual({ name: OTEL_EXPORT_SCOPE_NAME, version: '0.10.0' })

    const traceId = traceIdFor({ tenantId: TENANT_ID, rootRunId: RUN_ID })
    const runSpan = spanByName(output, 'invoke_agent sales.quote_drafter')
    expect(runSpan).toMatchObject({ traceId, spanId: runSpanId(RUN_ID), parentSpanId: null, kind: 'internal', startTime: T0, endTime: at(5000) })
    expect(runSpan.status).toEqual({ code: 'unset' })
    expect(runSpan.attributes).toMatchObject({
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.id': 'sales.quote_drafter',
      'gen_ai.agent.name': 'Quote drafter',
      'gen_ai.agent.version': '3',
      'gen_ai.request.model': 'gpt-test',
      'gen_ai.usage.input_tokens': 120,
      'gen_ai.usage.output_tokens': 40,
      'om.run.id': RUN_ID,
      'om.run.source': 'runtime',
      'om.run.runtime': 'native',
      'om.cost.minor': 2,
      'om.cost.currency': 'USD',
      'om.agent.definition_hash': 'def-hash-1',
      'om.prompt.override.version': 4,
      'om.tools.sha256': 'tools-hash-1',
      'om.knowledge.pricing': 'v7',
      'om.entry_point': 'playground',
      'om.channel': 'backend',
      'om.correlation_id': 'corr-1',
      'om.invoker.kind': 'user',
    })
    expect(attr(runSpan, 'enduser.id')).toBeUndefined()
    expect(runSpan.links).toEqual([
      { traceId: PLATFORM_TRACE_ID, spanId: PLATFORM_SPAN_ID, attributes: { 'om.link.relation': 'platform_trace' } },
    ])

    const chatSpan = spanByName(output, 'chat gpt-test-2026')
    expect(chatSpan).toMatchObject({ kind: 'client', spanId: agentSpanId(LLM_SPAN_ID), parentSpanId: runSpanId(RUN_ID) })
    expect(chatSpan.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'gpt-test',
      'gen_ai.response.model': 'gpt-test-2026',
      'gen_ai.request.temperature': 0.2,
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.response.finish_reasons': ['tool-calls'],
      'om.cost.micros': 1500,
      'om.capture.fidelity': 'exact',
    })

    const toolSpan = spanByName(output, 'execute_tool catalog.search')
    expect(toolSpan).toMatchObject({ kind: 'internal', spanId: agentSpanId(TOOL_SPAN_ID), parentSpanId: agentSpanId(LLM_SPAN_ID) })
    expect(toolSpan.attributes).toEqual({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'catalog.search',
      'gen_ai.tool.type': 'function',
      'om.tool.status': 'ok',
      'om.tool.latency_ms': 120,
    })

    const systemSpan = spanByName(output, 'om.context.bundle')
    expect(systemSpan).toMatchObject({ parentSpanId: runSpanId(RUN_ID) })
    expect(systemSpan.attributes).toEqual({ 'om.span.name': 'context.bundle' })
    expect(allSpans(output)).toHaveLength(4)
  })

  test('enduser.id is exported only when the tenant opts into user ids', () => {
    const output = mapAgentRunToOtlp(standaloneBundle(), { ...OPTIONS, exportUserIds: true })
    expectExportSafe(output)
    expect(attr(spanByName(output, 'invoke_agent sales.quote_drafter'), 'enduser.id')).toBe(USER_ID)
  })

  test('a malformed or zero platform traceparent produces no link', () => {
    for (const traceparent of ['garbage', `00-${'0'.repeat(32)}-${PLATFORM_SPAN_ID}-01`, `01-${PLATFORM_TRACE_ID}-${PLATFORM_SPAN_ID}`]) {
      const bundle = buildBundle({ manifest: { 'om.platform_trace': { traceparent } } })
      const output = mapAgentRunToOtlp(bundle, OPTIONS)
      expectExportSafe(output)
      expect(spanByName(output, 'invoke_agent sales.quote_drafter').links).toEqual([])
    }
    expect(parseTraceparent(`00-${PLATFORM_TRACE_ID.toUpperCase()}-${PLATFORM_SPAN_ID}-01`)).toEqual({
      traceId: PLATFORM_TRACE_ID,
      spanId: PLATFORM_SPAN_ID,
    })
  })

  test('workflow root is emitted by every top-level run of the execution with identical ids, so sibling re-exports agree', () => {
    const processInstance = {
      id: PROCESS_ID,
      workflowInstanceId: WORKFLOW_INSTANCE_ID,
      processDefinitionId: 'definition-1',
      workflowId: 'order_review',
      status: 'completed' as const,
      subjectType: 'sales.order',
      createdAt: at(-1000),
      completedAt: at(20000),
    }
    const first = mapAgentRunToOtlp(
      buildBundle({ run: buildRun({ workflowInstanceId: WORKFLOW_INSTANCE_ID, stepId: 'review' }), processInstance }),
      OPTIONS,
    )
    const second = mapAgentRunToOtlp(
      buildBundle({
        run: buildRun({ id: SIBLING_RUN_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, createdAt: at(6000), completedAt: at(9000) }),
        rootRunId: SIBLING_RUN_ID,
        processInstance,
      }),
      OPTIONS,
    )
    expectExportSafe(first)
    expectExportSafe(second)
    const traceId = traceIdFor({ tenantId: TENANT_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, rootRunId: RUN_ID })
    const firstRoot = spanByName(first, 'invoke_workflow order_review')
    const secondRoot = spanByName(second, 'invoke_workflow order_review')
    expect(firstRoot).toEqual(secondRoot)
    expect(firstRoot).toMatchObject({ traceId, spanId: workflowSpanId(WORKFLOW_INSTANCE_ID), startTime: at(-1000), endTime: at(20000) })
    expect(firstRoot.parentSpanId).toBeUndefined()
    expect(firstRoot.attributes).toEqual({
      'gen_ai.operation.name': 'invoke_workflow',
      'gen_ai.workflow.name': 'order_review',
      'om.process.execution_id': PROCESS_ID,
      'om.process.definition_id': 'definition-1',
      'om.process.status': 'completed',
      'om.subject.type': 'sales.order',
    })
    const firstRun = spanByName(first, 'invoke_agent sales.quote_drafter')
    const secondRun = spanByName(second, 'invoke_agent sales.quote_drafter')
    expect(firstRun).toMatchObject({ traceId, parentSpanId: workflowSpanId(WORKFLOW_INSTANCE_ID) })
    expect(attr(firstRun, 'om.workflow.step_id')).toBe('review')
    expect(secondRun).toMatchObject({ traceId, spanId: runSpanId(SIBLING_RUN_ID), parentSpanId: workflowSpanId(WORKFLOW_INSTANCE_ID) })
  })

  test('a failed process marks the workflow root as an error', () => {
    const output = mapAgentRunToOtlp(
      buildBundle({
        run: buildRun({ workflowInstanceId: WORKFLOW_INSTANCE_ID }),
        processInstance: {
          id: PROCESS_ID,
          workflowInstanceId: WORKFLOW_INSTANCE_ID,
          processDefinitionId: null,
          workflowId: null,
          status: 'failed',
          subjectType: null,
          createdAt: at(-1000),
          completedAt: null,
        },
      }),
      OPTIONS,
    )
    expectExportSafe(output)
    const root = spanByName(output, `invoke_workflow ${WORKFLOW_INSTANCE_ID}`)
    expect(root.status).toEqual({ code: 'error' })
    expect(attr(root, 'error.type')).toBe('_OTHER')
    expect(root.endTime).toEqual(at(5000))
  })

  test('nested delegation parents the run to its parent run span and never emits a duplicate workflow root', () => {
    const standalone = mapAgentRunToOtlp(
      buildBundle({ run: buildRun({ parentRunId: PARENT_RUN_ID }), rootRunId: PARENT_RUN_ID }),
      OPTIONS,
    )
    expectExportSafe(standalone)
    const runSpan = spanByName(standalone, 'invoke_agent sales.quote_drafter')
    expect(runSpan).toMatchObject({
      traceId: traceIdFor({ tenantId: TENANT_ID, rootRunId: PARENT_RUN_ID }),
      parentSpanId: runSpanId(PARENT_RUN_ID),
    })

    const inWorkflow = mapAgentRunToOtlp(
      buildBundle({
        run: buildRun({ parentRunId: PARENT_RUN_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID }),
        rootRunId: PARENT_RUN_ID,
        processInstance: {
          id: PROCESS_ID,
          workflowInstanceId: WORKFLOW_INSTANCE_ID,
          processDefinitionId: null,
          workflowId: 'order_review',
          status: 'running',
          subjectType: null,
          createdAt: at(-1000),
          completedAt: null,
        },
      }),
      OPTIONS,
    )
    expectExportSafe(inWorkflow)
    expect(allSpans(inWorkflow).some((span) => span.name.startsWith('invoke_workflow'))).toBe(false)
    expect(spanByName(inWorkflow, 'invoke_agent sales.quote_drafter')).toMatchObject({
      traceId: traceIdFor({ tenantId: TENANT_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, rootRunId: PARENT_RUN_ID }),
      parentSpanId: runSpanId(PARENT_RUN_ID),
    })
  })

  test('error and cancelled runs set ERROR status with error.type, and error spans follow', () => {
    const errored = mapAgentRunToOtlp(
      buildBundle({
        run: buildRun({ status: 'error' }),
        spans: [buildSpan({ id: TOOL_SPAN_ID, kind: 'tool', name: 'catalog.search', status: 'ok' })],
        toolCalls: [
          { id: 'tc-1', spanId: TOOL_SPAN_ID, toolName: 'catalog.search', status: 'error', isError: true, latencyMs: 10, createdAt: at(100) },
        ],
      }),
      OPTIONS,
    )
    expectExportSafe(errored)
    const runSpan = spanByName(errored, 'invoke_agent sales.quote_drafter')
    expect(runSpan.status).toEqual({ code: 'error' })
    expect(attr(runSpan, 'error.type')).toBe('_OTHER')
    const toolSpan = spanByName(errored, 'execute_tool catalog.search')
    expect(toolSpan.status).toEqual({ code: 'error' })
    expect(attr(toolSpan, 'error.type')).toBe('_OTHER')
    expect(attr(toolSpan, 'om.tool.status')).toBe('error')

    const cancelled = mapAgentRunToOtlp(buildBundle({ run: buildRun({ status: 'cancelled' }) }), OPTIONS)
    expectExportSafe(cancelled)
    const cancelledSpan = spanByName(cancelled, 'invoke_agent sales.quote_drafter')
    expect(cancelledSpan.status).toEqual({ code: 'error' })
    expect(attr(cancelledSpan, 'error.type')).toBe('cancelled')
  })

  test('toolless run maps legacy llm attributes and falls back to the run model for the span name', () => {
    const output = mapAgentRunToOtlp(
      buildBundle({
        run: buildRun({ completedAt: null, latencyMs: 2500 }),
        spans: [
          buildSpan({
            id: LLM_SPAN_ID,
            kind: 'llm',
            name: 'llm',
            endedAt: null,
            durationMs: 700,
            attributes: { inputTokens: 11, outputTokens: 7, finishReason: 'stop' },
          }),
        ],
      }),
      OPTIONS,
    )
    expectExportSafe(output)
    const runSpan = spanByName(output, 'invoke_agent sales.quote_drafter')
    expect(runSpan.endTime).toEqual(at(2500))
    const chatSpan = spanByName(output, 'chat gpt-test')
    expect(chatSpan.endTime).toEqual(at(800))
    expect(chatSpan.attributes).toEqual({
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'gpt-test',
      'gen_ai.usage.input_tokens': 11,
      'gen_ai.usage.output_tokens': 7,
      'gen_ai.response.finish_reasons': ['stop'],
    })
  })

  test('a span with neither end nor duration ends at its start', () => {
    const output = mapAgentRunToOtlp(
      buildBundle({
        run: buildRun({ model: null }),
        spans: [buildSpan({ id: LLM_SPAN_ID, kind: 'llm', name: 'llm', endedAt: null, durationMs: null })],
      }),
      OPTIONS,
    )
    expectExportSafe(output)
    const chatSpan = spanByName(output, 'chat')
    expect(chatSpan.endTime).toEqual(chatSpan.startTime)
  })

  test('OpenCode run with tool spans only parents every tool to the run span', () => {
    const output = mapAgentRunToOtlp(
      buildBundle({
        run: buildRun({ runtime: 'opencode', model: null, inputTokens: null, outputTokens: null }),
        spans: [
          buildSpan({ id: TOOL_SPAN_ID, kind: 'tool', name: 'read_file', attributes: { input: FREE_TEXT_SENTINEL } }),
          buildSpan({
            id: SYSTEM_SPAN_ID,
            kind: 'tool',
            name: 'write_file',
            parentSpanId: TOOL_SPAN_ID,
            durationMs: null,
            attributes: { output: FREE_TEXT_SENTINEL },
          }),
        ],
      }),
      OPTIONS,
    )
    expectExportSafe(output)
    for (const name of ['execute_tool read_file', 'execute_tool write_file']) {
      expect(spanByName(output, name).parentSpanId).toBe(runSpanId(RUN_ID))
    }
    expect(attr(spanByName(output, 'execute_tool write_file'), 'om.tool.latency_ms')).toBeUndefined()
    expect(attr(spanByName(output, 'invoke_agent sales.quote_drafter'), 'om.run.runtime')).toBe('opencode')
  })

  test('dispositions become om.proposal.disposition spans with om.proposal.execute children; pending proposals are skipped', () => {
    const output = mapAgentRunToOtlp(
      buildBundle({
        proposals: [
          {
            id: PROPOSAL_ID,
            disposition: 'approved',
            dispositionByKind: 'user',
            selectedOptionId: 'option-2',
            autoDispositionBlock: 'near_tie',
            createdAt: at(5000),
            updatedAt: at(8000),
          },
          {
            id: PENDING_PROPOSAL_ID,
            disposition: 'pending',
            dispositionByKind: null,
            selectedOptionId: null,
            autoDispositionBlock: null,
            createdAt: at(5000),
            updatedAt: at(5000),
          },
        ],
        effectorSpans: [
          {
            ...buildSpan({
              id: EFFECTOR_SPAN_ID,
              kind: 'system',
              name: `proposal-execution:${PROPOSAL_ID}`,
              status: 'error',
              startedAt: at(8000),
              endedAt: at(8500),
              attributes: {
                'om.effector.ok': false,
                'om.effector.command_ids': ['sales.quote.create'],
                'om.effector.state': 'failed',
                payload: FREE_TEXT_SENTINEL,
              },
            }),
            proposalId: PROPOSAL_ID,
          },
          {
            ...buildSpan({ id: SYSTEM_SPAN_ID, kind: 'system', name: `proposal-execution:${PENDING_PROPOSAL_ID}` }),
            proposalId: PENDING_PROPOSAL_ID,
          },
        ],
      }),
      OPTIONS,
    )
    expectExportSafe(output)
    const dispositions = allSpans(output).filter((span) => span.name === 'om.proposal.disposition')
    expect(dispositions).toHaveLength(1)
    expect(dispositions[0]).toMatchObject({
      spanId: dispositionSpanId(PROPOSAL_ID),
      parentSpanId: runSpanId(RUN_ID),
      startTime: at(5000),
      endTime: at(8000),
    })
    expect(dispositions[0].attributes).toEqual({
      'om.proposal.id': PROPOSAL_ID,
      'om.proposal.disposition': 'approved',
      'om.proposal.disposition_by_kind': 'user',
      'om.proposal.auto_disposition_block': 'near_tie',
      'om.proposal.selected_option_id': 'option-2',
    })
    const executes = allSpans(output).filter((span) => span.name === 'om.proposal.execute')
    expect(executes).toHaveLength(1)
    expect(executes[0]).toMatchObject({ spanId: agentSpanId(EFFECTOR_SPAN_ID), parentSpanId: dispositionSpanId(PROPOSAL_ID), status: { code: 'error' } })
    expect(executes[0].attributes).toEqual({
      'om.proposal.id': PROPOSAL_ID,
      'om.effector.ok': false,
      'om.effector.command_ids': ['sales.quote.create'],
      'om.effector.state': 'failed',
      'error.type': '_OTHER',
    })
  })

  test('eval results and guardrail checks become events on the run span', () => {
    const output = mapAgentRunToOtlp(
      buildBundle({
        evalResults: [
          { id: 'e1', assertionKey: 'grounded', score: 0.9, passed: true, severity: 'gate', evaluatedAt: at(6000) },
          { id: 'e2', assertionKey: 'tone', score: 0.4, passed: false, severity: 'warn', evaluatedAt: at(6000) },
          { id: 'e3', assertionKey: 'schema', score: null, passed: false, severity: 'gate', evaluatedAt: at(6000) },
          { id: 'e4', assertionKey: 'pending', score: null, passed: null, severity: 'gate', evaluatedAt: at(6000) },
        ],
        guardrailChecks: [
          {
            id: 'g1',
            proposalId: PROPOSAL_ID,
            guardrailSetVersion: 'v1',
            capability: 'sales.quote',
            phase: 'output',
            kind: 'pii',
            result: 'warn',
            createdAt: at(4000),
          },
        ],
      }),
      OPTIONS,
    )
    expectExportSafe(output)
    const events = spanByName(output, 'invoke_agent sales.quote_drafter').events ?? []
    expect(events.map((event) => [event.name, event.attributes])).toEqual([
      ['gen_ai.evaluation.result', { 'gen_ai.evaluation.name': 'grounded', 'gen_ai.evaluation.score.value': 0.9, 'gen_ai.evaluation.score.label': 'pass' }],
      ['gen_ai.evaluation.result', { 'gen_ai.evaluation.name': 'tone', 'gen_ai.evaluation.score.value': 0.4, 'gen_ai.evaluation.score.label': 'warn' }],
      ['gen_ai.evaluation.result', { 'gen_ai.evaluation.name': 'schema', 'gen_ai.evaluation.score.label': 'fail' }],
      ['gen_ai.evaluation.result', { 'gen_ai.evaluation.name': 'pending' }],
      [
        'om.guardrail.check',
        {
          'om.guardrail.capability': 'sales.quote',
          'om.guardrail.verdict': 'warn',
          'om.guardrail.kind': 'pii',
          'om.guardrail.phase': 'output',
          'om.proposal.id': PROPOSAL_ID,
        },
      ],
    ])
    expect(events[4].time).toEqual(at(4000))
  })

  test('a re-run without the original trace id records om.run.rerun_of instead of a link', () => {
    const output = mapAgentRunToOtlp(buildBundle({ run: buildRun({ rerunOfRunId: RERUN_OF_RUN_ID }) }), OPTIONS)
    expectExportSafe(output)
    const runSpan = spanByName(output, 'invoke_agent sales.quote_drafter')
    expect(runSpan.links).toEqual([])
    expect(attr(runSpan, 'om.run.rerun_of')).toBe(RERUN_OF_RUN_ID)
  })

  test('a re-run with the original trace id links to the original run span', () => {
    const output = mapAgentRunToOtlp(
      buildBundle({ run: buildRun({ rerunOfRunId: RERUN_OF_RUN_ID }), rerunOfTraceId: RERUN_TRACE_ID }),
      OPTIONS,
    )
    expectExportSafe(output)
    const runSpan = spanByName(output, 'invoke_agent sales.quote_drafter')
    expect(runSpan.links).toEqual([
      { traceId: RERUN_TRACE_ID, spanId: runSpanId(RERUN_OF_RUN_ID), attributes: { 'om.link.relation': 'rerun_of' } },
    ])
    expect(attr(runSpan, 'om.run.rerun_of')).toBeUndefined()
  })

  test('string attributes are redacted before export', () => {
    const output = mapAgentRunToOtlp(
      buildBundle({
        manifest: {
          'om.channel': 'ops@example.com',
          'om.knowledge': { token_source: 'Bearer abc.def.ghi' },
        },
      }),
      OPTIONS,
    )
    expectExportSafe(output)
    const serialized = JSON.stringify(encodeOtlpTraceRequest(output))
    expect(serialized).not.toContain('ops@example.com')
    expect(serialized).not.toContain('abc.def.ghi')
    const runSpan = spanByName(output, 'invoke_agent sales.quote_drafter')
    expect(attr(runSpan, 'om.channel')).toBe('[redacted-email]')
    expect(attr(runSpan, 'om.knowledge.token_source')).toBe('Bearer [redacted]')
  })

  test('runs above 1000 spans are chunked into resource spans of 512 sharing one resource', () => {
    const spans: RunExportSpan[] = Array.from({ length: 1100 }, (_entry, index) =>
      buildSpan({
        id: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
        kind: 'system',
        name: `step.${index}`,
        sequence: index,
      }),
    )
    const output = mapAgentRunToOtlp(buildBundle({ spans }), OPTIONS)
    expectExportSafe(output)
    expect(output.map((entry) => entry.scopeSpans[0].spans.length)).toEqual([OTEL_EXPORT_CHUNK_SIZE, OTEL_EXPORT_CHUNK_SIZE, 77])
    for (const entry of output) expect(entry.resource).toEqual(output[0].resource)
    expect(output[0].scopeSpans[0].spans[0].spanId).toBe(runSpanId(RUN_ID))

    const small = mapAgentRunToOtlp(buildBundle({ spans: spans.slice(0, 999) }), OPTIONS)
    expect(small).toHaveLength(1)
    expect(small[0].scopeSpans[0].spans).toHaveLength(1000)
  })

  test('the mapping is deterministic across calls', () => {
    const bundle: RunExportBundle = standaloneBundle()
    expect(mapAgentRunToOtlp(bundle, OPTIONS)).toEqual(mapAgentRunToOtlp(bundle, OPTIONS))
  })
})
