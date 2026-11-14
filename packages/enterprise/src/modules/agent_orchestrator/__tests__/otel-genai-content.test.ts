import { describe, expect, test } from '@jest/globals'
import { buildLlmRequestArtifact, buildLlmResponseArtifact } from '../lib/trace/contentCapture'
import { GEN_AI_ATTRIBUTES } from '../lib/trace/genAiAttributes'
import {
  OTEL_CONTENT_ATTRIBUTE_MAX_BYTES,
  capContentAttribute,
  indexToolCallContent,
  toInferenceDetailsAttributes,
  toInputMessages,
  toOutputMessages,
  toSystemInstructions,
  toToolDefinitions,
} from '../lib/trace/otel/genAiContent'
import { OM_OTEL_CONTENT_ATTRIBUTES } from '../lib/trace/otel/otelAttributes'

const SHA = 'a'.repeat(64)

function requestArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'om.llm_request.v1',
    provider: 'openai',
    modelId: 'gpt-test',
    system: 'You are a helpful agent.',
    messages: [
      { role: 'user', content: 'Find order 42' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking it up.' },
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'orders.get', input: { orderId: '42' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'orders.get',
            output: { type: 'json', value: { status: 'shipped' } },
          },
        ],
      },
    ],
    tools: [{ name: 'orders.get', description: 'Read one order', inputSchema: { type: 'object' } }],
    responseFormat: null,
    params: {},
    ...overrides,
  }
}

function responseArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'om.llm_response.v1',
    finishReason: 'tool-calls',
    content: [
      { type: 'reasoning', text: 'Need details.' },
      { type: 'tool-call', toolCallId: 'call-2', toolName: 'orders.list', input: { limit: 5 } },
    ],
    usage: {},
    ...overrides,
  }
}

function parse(attribute: { value: string } | null): unknown {
  if (!attribute) throw new Error('[internal] expected attribute')
  return JSON.parse(attribute.value)
}

describe('genAiContent parts', () => {
  test('maps system instructions to text parts', () => {
    expect(parse(toSystemInstructions(requestArtifact()))).toEqual([
      { type: 'text', content: 'You are a helpful agent.' },
    ])
    expect(toSystemInstructions(requestArtifact({ system: null }))).toBeNull()
  })

  test('maps input messages with text, tool_call and tool_call_response parts', () => {
    const attribute = toInputMessages(requestArtifact())
    expect(attribute?.truncated).toBe(false)
    expect(parse(attribute)).toEqual([
      { role: 'user', parts: [{ type: 'text', content: 'Find order 42' }] },
      {
        role: 'assistant',
        parts: [
          { type: 'text', content: 'Looking it up.' },
          { type: 'tool_call', id: 'call-1', name: 'orders.get', arguments: { orderId: '42' } },
        ],
      },
      { role: 'tool', parts: [{ type: 'tool_call_response', id: 'call-1', response: { status: 'shipped' } }] },
    ])
  })

  test('maps output messages with finish_reason and object as a JSON text part', () => {
    expect(parse(toOutputMessages(responseArtifact()))).toEqual([
      {
        role: 'assistant',
        finish_reason: 'tool_call',
        parts: [
          { type: 'reasoning', content: 'Need details.' },
          { type: 'tool_call', id: 'call-2', name: 'orders.list', arguments: { limit: 5 } },
        ],
      },
    ])
    const objectMode = parse(
      toOutputMessages(responseArtifact({ finishReason: 'stop', content: [], object: { verdict: 'ok' } })),
    )
    expect(objectMode).toEqual([
      { role: 'assistant', finish_reason: 'stop', parts: [{ type: 'text', content: '{"verdict":"ok"}' }] },
    ])
  })

  test('maps tool definitions', () => {
    expect(parse(toToolDefinitions(requestArtifact()))).toEqual([
      { type: 'function', name: 'orders.get', description: 'Read one order', parameters: { type: 'object' } },
    ])
    expect(toToolDefinitions(requestArtifact({ tools: [] }))).toBeNull()
  })

  test('maps captured artifacts built by contentCapture', () => {
    const request = buildLlmRequestArtifact(
      {
        provider: 'openai',
        modelId: 'gpt-test',
        system: 'sys',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: undefined,
        responseFormat: undefined,
        callSettings: undefined,
      },
      { redactPii: false },
    )
    const response = buildLlmResponseArtifact(
      { finishReason: 'stop', content: [{ type: 'text', text: 'hello' }], usage: {} },
      { redactPii: false },
    )
    expect(parse(toInputMessages(request.payload))).toEqual([{ role: 'user', parts: [{ type: 'text', content: 'hi' }] }])
    expect(parse(toOutputMessages(response.payload))).toEqual([
      { role: 'assistant', finish_reason: 'stop', parts: [{ type: 'text', content: 'hello' }] },
    ])
  })
})

describe('genAiContent file parts', () => {
  test('emits file metadata and never bytes', () => {
    const request = requestArtifact({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'file', mediaType: 'image/png', bytes: 2048, sha256: SHA },
            { type: 'image', image: 'aGVsbG8gd29ybGQ=', mediaType: 'image/jpeg' },
          ],
        },
      ],
    })
    const attribute = toInputMessages(request)
    expect(parse(attribute)).toEqual([
      {
        role: 'user',
        parts: [
          { type: 'file', modality: 'image', mime_type: 'image/png', size: 2048, sha256: SHA },
          { type: 'file', modality: 'image', mime_type: 'image/jpeg', size: null, sha256: null },
        ],
      },
    ])
    expect(attribute?.value).not.toContain('aGVsbG8gd29ybGQ=')
  })

  test('strips media data from tool results', () => {
    const response = requestArtifact({
      messages: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-9',
              output: { type: 'content', value: [{ type: 'media', data: 'QUJDRA==', mediaType: 'application/pdf' }] },
            },
          ],
        },
      ],
    })
    const attribute = toInputMessages(response)
    expect(attribute?.value).not.toContain('QUJDRA==')
    expect(parse(attribute)).toEqual([
      {
        role: 'tool',
        parts: [
          {
            type: 'tool_call_response',
            id: 'call-9',
            response: [{ type: 'file', mime_type: 'application/pdf', size: null, sha256: null }],
          },
        ],
      },
    ])
  })
})

describe('genAiContent redaction', () => {
  test('scrubs PII and secrets in every string leaf', () => {
    const request = requestArtifact({
      system: 'Contact ops@example.com',
      messages: [
        { role: 'user', content: 'My card is 4111 1111 1111 1111 and phone +48 601 234 567' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'mail.send',
              input: { to: 'jane@example.com', note: 'Authorization: Bearer abc.def.ghi' },
            },
          ],
        },
      ],
    })
    const serialized = [toSystemInstructions(request), toInputMessages(request)].map((entry) => entry?.value).join('\n')
    expect(serialized).not.toContain('ops@example.com')
    expect(serialized).not.toContain('jane@example.com')
    expect(serialized).not.toContain('4111 1111 1111 1111')
    expect(serialized).not.toContain('601 234 567')
    expect(serialized).not.toContain('abc.def.ghi')
    expect(serialized).toContain('[redacted-email]')
    expect(serialized).toContain('[redacted-card]')
    expect(serialized).toContain('[redacted-phone]')
  })

  test('scrubs tool call arguments and results in the call index', () => {
    const index = indexToolCallContent(
      [
        requestArtifact({
          messages: [
            {
              role: 'tool',
              content: [
                { type: 'tool-result', toolCallId: 'call-2', output: { type: 'text', value: 'mail bob@example.com' } },
              ],
            },
          ],
        }),
      ],
      [responseArtifact({ content: [{ type: 'tool-call', toolCallId: 'call-2', input: { email: 'bob@example.com' } }] })],
    )
    const entry = index.get('call-2')
    expect(entry?.arguments?.value).toBe('{"email":"[redacted-email]"}')
    expect(entry?.result?.value).toBe('"mail [redacted-email]"')
  })
})

describe('genAiContent tool call index', () => {
  test('matches arguments and results by call id and skips calls without an id', () => {
    const index = indexToolCallContent(
      [requestArtifact()],
      [
        responseArtifact({
          content: [
            { type: 'tool-call', toolCallId: 'call-1', toolName: 'orders.get', input: { orderId: '42' } },
            { type: 'tool-call', toolName: 'anonymous', input: { secret: 'x' } },
          ],
        }),
      ],
    )
    expect([...index.keys()]).toEqual(['call-1'])
    expect(index.get('call-1')?.arguments?.value).toBe('{"orderId":"42"}')
    expect(index.get('call-1')?.result?.value).toBe('{"status":"shipped"}')
  })

  test('ignores artifacts with an unknown schema', () => {
    const index = indexToolCallContent([{ ...requestArtifact(), schema: 'om.llm_request.v9' }], [{ schema: 'other' }])
    expect(index.size).toBe(0)
  })
})

describe('genAiContent caps', () => {
  test('caps each attribute at 64 KiB and flags truncation', () => {
    const big = 'x'.repeat(OTEL_CONTENT_ATTRIBUTE_MAX_BYTES * 2)
    const request = requestArtifact({ system: big, messages: [{ role: 'user', content: big }] })
    for (const attribute of [toSystemInstructions(request), toInputMessages(request)]) {
      expect(attribute?.truncated).toBe(true)
      expect(Buffer.byteLength(attribute?.value ?? '', 'utf8')).toBeLessThanOrEqual(OTEL_CONTENT_ATTRIBUTE_MAX_BYTES)
      expect(() => JSON.parse(attribute?.value ?? '')).not.toThrow()
    }
  })

  test('keeps multi-byte strings within the byte cap', () => {
    const attribute = capContentAttribute([{ type: 'text', content: '😀'.repeat(1000) }], 512)
    expect(attribute.truncated).toBe(true)
    expect(Buffer.byteLength(attribute.value, 'utf8')).toBeLessThanOrEqual(512)
    expect(attribute.value).not.toMatch(/\\ud83d"/)
  })

  test('drops trailing entries when structure alone exceeds the cap', () => {
    const entries = Array.from({ length: 200 }, (_value, index) => ({ type: 'text', content: '', index }))
    const attribute = capContentAttribute(entries, 256)
    expect(attribute.truncated).toBe(true)
    expect(Buffer.byteLength(attribute.value, 'utf8')).toBeLessThanOrEqual(256)
    expect(Array.isArray(JSON.parse(attribute.value))).toBe(true)
  })

  test('propagates capture-time truncation markers', () => {
    const request = requestArtifact({
      messages: [{ role: 'user', content: { _truncated: true, originalBytes: 99999 } }],
    })
    const attribute = toInputMessages(request)
    expect(attribute?.truncated).toBe(true)
    expect(parse(attribute)).toEqual([{ role: 'user', parts: [] }])
  })
})

describe('genAiContent inference details', () => {
  test('returns all four attributes and om.truncated only when truncated', () => {
    const attributes = toInferenceDetailsAttributes(requestArtifact(), responseArtifact())
    expect(Object.keys(attributes ?? {}).sort()).toEqual(
      [
        GEN_AI_ATTRIBUTES.inputMessages,
        GEN_AI_ATTRIBUTES.outputMessages,
        GEN_AI_ATTRIBUTES.systemInstructions,
        GEN_AI_ATTRIBUTES.toolDefinitions,
      ].sort(),
    )
    const truncated = toInferenceDetailsAttributes(
      { schema: 'om.llm_request.v1', _truncated: true, originalBytes: 5_000_000 },
      responseArtifact(),
    )
    expect(truncated?.[OM_OTEL_CONTENT_ATTRIBUTES.truncated]).toBe(true)
    expect(truncated?.[GEN_AI_ATTRIBUTES.inputMessages]).toBeUndefined()
  })

  test('returns null for unknown artifact schemas', () => {
    expect(toInferenceDetailsAttributes({ schema: 'om.llm_request.v2' }, { schema: 'x' })).toBeNull()
    expect(toInferenceDetailsAttributes(null, undefined)).toBeNull()
    expect(toInputMessages({ ...requestArtifact(), schema: 'om.llm_request.v2' })).toBeNull()
    expect(toOutputMessages({ ...responseArtifact(), schema: 'om.llm_response.v0' })).toBeNull()
    expect(toSystemInstructions('not an artifact')).toBeNull()
    expect(toToolDefinitions(42)).toBeNull()
  })
})
