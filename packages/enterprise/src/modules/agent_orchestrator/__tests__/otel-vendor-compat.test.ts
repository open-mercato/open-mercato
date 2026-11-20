import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from '@jest/globals'
import { parseOtlpHeaders, parseOtlpHeadersStrict } from '../lib/trace/otel/exportSettings'
import { classifyOtlpStatus } from '../lib/trace/otel/otlpHttpClient'
import type {
  OtlpAnyValue,
  OtlpEncodedSpan,
  OtlpExportTraceServiceRequest,
  OtlpKeyValue,
} from '../lib/trace/otel/otlpJson'

/**
 * Pins the parts of the exported payload that Langfuse and Datadog LLM
 * Observability read, so a mapper change that would break either backend
 * fails here. The input is the content golden, which
 * `otel-map-agent-run.test.ts` proves equal to the real mapper output.
 *
 * Vendor behavior encoded below (checked 2026-11-17):
 * - Langfuse `ObservationTypeMapper` / `OtelIngestionProcessor`: span type from
 *   `gen_ai.operation.name`; model from `gen_ai.response.model` then
 *   `gen_ai.request.model`; usage from `gen_ai.usage.*`; input/output from the
 *   `gen_ai.client.inference.operation.details` event (JSON-string
 *   `gen_ai.input.messages` / `gen_ai.output.messages`, system instructions
 *   prepended); tool input/output from `gen_ai.tool.call.arguments` / `.result`.
 * - Datadog LLM Observability (OTel GenAI 1.37+ mapping): same span-kind table,
 *   `service.name` becomes `ml_app`, messages from direct attributes or the same
 *   event; messages must be JSON arrays of `{ role, parts }`; spans without any
 *   `gen_ai.*` attribute are kept in APM only. The intake answers `200` or `202`, and `403` for a wrong site or key.
 */

const LANGFUSE_TYPES: Readonly<Record<string, string>> = {
  chat: 'GENERATION',
  invoke_agent: 'AGENT',
  execute_tool: 'TOOL',
}

const DATADOG_KINDS: Readonly<Record<string, string>> = {
  chat: 'llm',
  invoke_agent: 'agent',
  execute_tool: 'tool',
}

const DETAILS_EVENT = 'gen_ai.client.inference.operation.details'
const MESSAGE_ROLES = new Set(['system', 'user', 'assistant', 'tool'])
const PART_TYPES = new Set(['text', 'reasoning', 'tool_call', 'tool_call_response', 'file'])
const TRACE_ID_RE = /^[0-9a-f]{32}$/
const SPAN_ID_RE = /^[0-9a-f]{16}$/

function loadGolden(): OtlpExportTraceServiceRequest {
  const raw = readFileSync(path.join(__dirname, 'fixtures', 'otel', 'map-run-content.golden.json'), 'utf8')
  return JSON.parse(raw) as OtlpExportTraceServiceRequest
}

function spansOf(request: OtlpExportTraceServiceRequest): OtlpEncodedSpan[] {
  return request.resourceSpans.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans))
}

function valueOf(attributes: readonly OtlpKeyValue[] | undefined, key: string): OtlpAnyValue | undefined {
  return attributes?.find((attribute) => attribute.key === key)?.value
}

function stringOf(attributes: readonly OtlpKeyValue[] | undefined, key: string): string | undefined {
  const value = valueOf(attributes, key)
  return value && 'stringValue' in value ? value.stringValue : undefined
}

function spanByOperation(request: OtlpExportTraceServiceRequest, operation: string): OtlpEncodedSpan {
  const span = spansOf(request).find((candidate) => stringOf(candidate.attributes, 'gen_ai.operation.name') === operation)
  if (!span) throw new Error(`[internal] no span with gen_ai.operation.name=${operation}`)
  return span
}

function parseJsonArray(text: string | undefined): unknown[] {
  expect(typeof text).toBe('string')
  const parsed: unknown = JSON.parse(String(text))
  expect(Array.isArray(parsed)).toBe(true)
  return parsed as unknown[]
}

function expectGenAiMessages(messages: unknown[]): void {
  expect(messages.length).toBeGreaterThan(0)
  for (const message of messages) {
    const record = message as { role?: unknown; parts?: unknown }
    expect(MESSAGE_ROLES.has(String(record.role))).toBe(true)
    expect(Array.isArray(record.parts)).toBe(true)
    for (const part of record.parts as Array<{ type?: unknown }>) {
      expect(PART_TYPES.has(String(part.type))).toBe(true)
    }
  }
}

describe('OTLP export compatibility with Langfuse and Datadog', () => {
  const request = loadGolden()

  test('every agent span uses a gen_ai.operation.name both vendors map to a typed observation', () => {
    for (const operation of Object.keys(LANGFUSE_TYPES)) {
      const span = spanByOperation(request, operation)
      expect(LANGFUSE_TYPES[operation]).toBeDefined()
      expect(DATADOG_KINDS[operation]).toBeDefined()
      expect(span.name.startsWith(`${operation} `)).toBe(true)
    }
  })

  test('ids are lowercase hex of OTLP length and every parent exists in the export', () => {
    const spans = spansOf(request)
    const ids = new Set(spans.map((span) => span.spanId))
    for (const span of spans) {
      expect(span.traceId).toMatch(TRACE_ID_RE)
      expect(span.spanId).toMatch(SPAN_ID_RE)
      if (span.parentSpanId) {
        expect(span.parentSpanId).toMatch(SPAN_ID_RE)
        expect(ids.has(span.parentSpanId)).toBe(true)
      }
    }
    expect(new Set(spans.map((span) => span.traceId)).size).toBe(1)
  })

  test('the resource carries service.name, which Datadog uses as ml_app', () => {
    const resource = request.resourceSpans[0]?.resource
    expect(stringOf(resource?.attributes, 'service.name')).toBe('open-mercato-agents')
  })

  test('the chat span carries provider, model and integer token usage', () => {
    const chat = spanByOperation(request, 'chat')
    expect(stringOf(chat.attributes, 'gen_ai.provider.name')).toBe('openai')
    expect(stringOf(chat.attributes, 'gen_ai.request.model')).toBe('gpt-test')
    expect(stringOf(chat.attributes, 'gen_ai.response.model')).toBe('gpt-test-2026')
    expect(valueOf(chat.attributes, 'gen_ai.usage.input_tokens')).toEqual({ intValue: '100' })
    expect(valueOf(chat.attributes, 'gen_ai.usage.output_tokens')).toEqual({ intValue: '30' })
  })

  test('content travels as one inference details event with JSON-string GenAI messages', () => {
    const chat = spanByOperation(request, 'chat')
    const events = chat.events ?? []
    expect(events.map((event) => event.name)).toEqual([DETAILS_EVENT])
    const attributes = events[0]?.attributes

    const input = parseJsonArray(stringOf(attributes, 'gen_ai.input.messages'))
    expectGenAiMessages(input)

    const output = parseJsonArray(stringOf(attributes, 'gen_ai.output.messages'))
    expectGenAiMessages(output)
    for (const message of output as Array<{ role: string; finish_reason?: unknown }>) {
      expect(message.role).toBe('assistant')
      expect(typeof message.finish_reason).toBe('string')
    }

    const instructions = parseJsonArray(stringOf(attributes, 'gen_ai.system_instructions'))
    expect(instructions).toEqual([{ type: 'text', content: 'You draft quotes.' }])

    const tools = parseJsonArray(stringOf(attributes, 'gen_ai.tool.definitions')) as Array<{ name?: unknown; parameters?: unknown }>
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string')
      if (tool.parameters !== undefined) expect(typeof tool.parameters).toBe('object')
    }
  })

  test('the tool span carries the tool name and JSON-string call arguments and result', () => {
    const tool = spanByOperation(request, 'execute_tool')
    expect(stringOf(tool.attributes, 'gen_ai.tool.name')).toBe('catalog.search')
    expect(JSON.parse(String(stringOf(tool.attributes, 'gen_ai.tool.call.arguments')))).toEqual({ query: 'chairs' })
    expect(JSON.parse(String(stringOf(tool.attributes, 'gen_ai.tool.call.result')))).toEqual({ hits: 3 })
  })

  test('platform-only spans carry no gen_ai attributes, so Datadog LLM Observability keeps them in APM only', () => {
    const platformOnly = spansOf(request).filter((span) => span.name.startsWith('om.'))
    expect(platformOnly.length).toBeGreaterThan(0)
    for (const span of platformOnly) {
      expect((span.attributes ?? []).some((attribute) => attribute.key.startsWith('gen_ai.'))).toBe(false)
    }
  })

  test('the Datadog intake answers count as delivered, and a rejected key is dropped', () => {
    expect(classifyOtlpStatus(200)).toBe('ok')
    expect(classifyOtlpStatus(202)).toBe('ok')
    expect(classifyOtlpStatus(403)).toBe('drop')
    expect(classifyOtlpStatus(413)).toBe('drop')
  })
})

describe('OTLP header lists for Langfuse and Datadog', () => {
  const LANGFUSE_BASIC = Buffer.from('pk-lf-test:sk-lf-test1').toString('base64')

  test('Langfuse Basic auth keeps base64 padding and the URL-encoded space', () => {
    expect(LANGFUSE_BASIC.endsWith('=')).toBe(true)
    const raw = `Authorization=Basic%20${LANGFUSE_BASIC}`
    const expected = { Authorization: `Basic ${LANGFUSE_BASIC}` }
    expect(parseOtlpHeaders(raw)).toEqual(expected)
    expect(parseOtlpHeadersStrict(raw)).toEqual(expected)
  })

  test('Datadog API key, source and LLM Observability switch parse as three headers', () => {
    const raw = 'dd-api-key=0123456789abcdef,dd-otlp-source=llmobs,DD-LLMObs-Enabled=true'
    const expected = { 'dd-api-key': '0123456789abcdef', 'dd-otlp-source': 'llmobs', 'DD-LLMObs-Enabled': 'true' }
    expect(parseOtlpHeaders(raw)).toEqual(expected)
    expect(parseOtlpHeadersStrict(raw)).toEqual(expected)
  })

  test('a tenant header list that smuggles a second header through CRLF is rejected', () => {
    const raw = `Authorization=Basic%20${LANGFUSE_BASIC}%0D%0AX-Om-Tenant:other`
    expect(parseOtlpHeadersStrict(raw)).toBeNull()
    expect(parseOtlpHeaders(raw)).toEqual({})
  })

  test('a tenant header list with a malformed pair is rejected as a whole, not partially applied', () => {
    expect(parseOtlpHeadersStrict(`Authorization=Basic%20${LANGFUSE_BASIC},dd api key=x`)).toBeNull()
    expect(parseOtlpHeadersStrict(`Authorization=Basic%20${LANGFUSE_BASIC},missing-separator`)).toBeNull()
  })
})
