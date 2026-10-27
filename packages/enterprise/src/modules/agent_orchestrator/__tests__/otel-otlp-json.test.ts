import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from '@jest/globals'
import {
  encodeAnyValue,
  encodeAttributes,
  encodeOtlpSpan,
  encodeOtlpTraceRequest,
  msToUnixNanoString,
  toUnixNanoString,
  type OtlpResourceSpansInput,
  type OtlpSpanInput,
} from '../lib/trace/otel/otlpJson'

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const LINKED_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const ROOT_SPAN_ID = 'b7ad6b7169203331'
const CHILD_SPAN_ID = '00f067aa0ba902b7'
const LINKED_SPAN_ID = 'a2fb4a1d1a96d312'

function goldenFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'otel', name), 'utf8'))
}

function baseSpan(overrides: Partial<OtlpSpanInput> = {}): OtlpSpanInput {
  return {
    traceId: TRACE_ID,
    spanId: ROOT_SPAN_ID,
    name: 'invoke_agent',
    kind: 'internal',
    startTime: 1_761_580_800_000,
    endTime: 1_761_580_801_500,
    ...overrides,
  }
}

const goldenInput: OtlpResourceSpansInput = {
  resource: {
    attributes: {
      'service.name': 'open-mercato',
      'service.version': '1.2.3',
      'om.genai.semconv': '1.43',
      'deployment.environment.name': undefined,
    },
  },
  scopeSpans: [
    {
      scope: { name: '@open-mercato/enterprise/agent_orchestrator', version: '1.2.3' },
      spans: [
        baseSpan({
          name: 'invoke_agent triage',
          attributes: {
            'gen_ai.operation.name': 'invoke_agent',
            'gen_ai.agent.name': 'triage',
            'om.run.retry': false,
            'gen_ai.usage.input_tokens': 1200,
            'om.cost.ratio': 0.25,
            'om.tags': ['alpha', 'beta', null],
            'om.capture': { level: 'metadata', redactPii: true, retentionDays: 30 },
            'om.ignored': null,
          },
          links: [
            { traceId: LINKED_TRACE_ID.toUpperCase(), spanId: LINKED_SPAN_ID, attributes: { 'om.link.kind': 'platform_trace' } },
          ],
          status: { code: 'ok' },
        }),
        baseSpan({
          spanId: CHILD_SPAN_ID,
          parentSpanId: ROOT_SPAN_ID,
          name: 'chat gpt-4o-mini',
          kind: 'client',
          startTime: new Date('2025-10-27T16:00:00.250Z'),
          endTime: BigInt('1761580801250000123'),
          attributes: {
            'gen_ai.request.model': 'gpt-4o-mini',
            'gen_ai.request.temperature': 0.2,
            'gen_ai.response.finish_reasons': ['stop'],
            'gen_ai.usage.output_tokens': BigInt(42),
          },
          events: [
            {
              time: 1_761_580_801_000.5,
              name: 'gen_ai.evaluation.result',
              attributes: { 'gen_ai.evaluation.name': 'groundedness', 'gen_ai.evaluation.score.value': 0.9 },
            },
          ],
          status: { code: 'error', message: 'tool_failed' },
        }),
      ],
    },
  ],
}

describe('msToUnixNanoString', () => {
  test('converts epoch milliseconds without float precision loss', () => {
    expect(msToUnixNanoString(0)).toBe('0')
    expect(msToUnixNanoString(1_761_580_800_000)).toBe('1761580800000000000')
    expect(msToUnixNanoString(8_640_000_000_000_000)).toBe('8640000000000000000000')
    expect(msToUnixNanoString(1_761_580_800_000.5)).toBe('1761580800000500000')
  })

  test('rejects negative and non-finite values', () => {
    expect(() => msToUnixNanoString(-1)).toThrow('[internal]')
    expect(() => msToUnixNanoString(Number.NaN)).toThrow('[internal]')
    expect(() => msToUnixNanoString(Number.POSITIVE_INFINITY)).toThrow('[internal]')
    expect(() => toUnixNanoString(BigInt(-1))).toThrow('[internal]')
  })

  test('accepts nanosecond bigints and dates', () => {
    expect(toUnixNanoString(BigInt('1761580800000000001'))).toBe('1761580800000000001')
    expect(toUnixNanoString(new Date('2025-10-27T16:00:00.000Z'))).toBe('1761580800000000000')
  })
})

describe('encodeAnyValue', () => {
  test('maps scalar types to OTLP AnyValue variants', () => {
    expect(encodeAnyValue('text')).toEqual({ stringValue: 'text' })
    expect(encodeAnyValue(true)).toEqual({ boolValue: true })
    expect(encodeAnyValue(7)).toEqual({ intValue: '7' })
    expect(encodeAnyValue(-3)).toEqual({ intValue: '-3' })
    expect(encodeAnyValue(BigInt('9007199254740993'))).toEqual({ intValue: '9007199254740993' })
    expect(encodeAnyValue(1.5)).toEqual({ doubleValue: 1.5 })
    expect(encodeAnyValue(2 ** 60)).toEqual({ doubleValue: 2 ** 60 })
  })

  test('omits null, undefined, non-finite numbers and unsupported objects', () => {
    expect(encodeAnyValue(null)).toBeNull()
    expect(encodeAnyValue(undefined)).toBeNull()
    expect(encodeAnyValue(Number.NaN)).toBeNull()
    expect(encodeAttributes({ when: new Date(0) as unknown as string, kept: 'yes' })).toEqual([
      { key: 'kept', value: { stringValue: 'yes' } },
    ])
  })

  test('encodes nested arrays and plain objects', () => {
    expect(encodeAnyValue([1, 'two', [true]])).toEqual({
      arrayValue: {
        values: [{ intValue: '1' }, { stringValue: 'two' }, { arrayValue: { values: [{ boolValue: true }] } }],
      },
    })
    expect(encodeAnyValue({ outer: { inner: 0.5 }, skip: undefined })).toEqual({
      kvlistValue: {
        values: [{ key: 'outer', value: { kvlistValue: { values: [{ key: 'inner', value: { doubleValue: 0.5 } }] } } }],
      },
    })
  })
})

describe('encodeOtlpSpan', () => {
  test('defaults to unset status, empty collections and no parent', () => {
    const encoded = encodeOtlpSpan(baseSpan())
    expect(encoded.status).toEqual({ code: 0 })
    expect(encoded.events).toEqual([])
    expect(encoded.links).toEqual([])
    expect(encoded.attributes).toEqual([])
    expect('parentSpanId' in encoded).toBe(false)
    expect(encoded.kind).toBe(1)
  })

  test('maps every span kind to its enum number', () => {
    const kinds = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer'] as const
    expect(kinds.map((kind) => encodeOtlpSpan(baseSpan({ kind })).kind)).toEqual([0, 1, 2, 3, 4, 5])
  })

  test('rejects malformed or zero ids', () => {
    expect(() => encodeOtlpSpan(baseSpan({ traceId: 'abc' }))).toThrow('[internal]')
    expect(() => encodeOtlpSpan(baseSpan({ spanId: '0000000000000000' }))).toThrow('[internal]')
    expect(() => encodeOtlpSpan(baseSpan({ parentSpanId: 'zzzzzzzzzzzzzzzz' }))).toThrow('[internal]')
    expect(() =>
      encodeOtlpSpan(baseSpan({ links: [{ traceId: '00000000000000000000000000000000', spanId: CHILD_SPAN_ID }] })),
    ).toThrow('[internal]')
  })
})

describe('encodeOtlpTraceRequest', () => {
  test('matches the golden OTLP/JSON request', () => {
    expect(encodeOtlpTraceRequest(goldenInput)).toEqual(goldenFixture('trace-request.golden.json'))
  })

  test('accepts a list of resource spans and survives a JSON round-trip', () => {
    const request = encodeOtlpTraceRequest([goldenInput, goldenInput])
    expect(request.resourceSpans).toHaveLength(2)
    expect(JSON.parse(JSON.stringify(request))).toEqual(request)
  })

  test('omits an empty scope version', () => {
    const request = encodeOtlpTraceRequest({
      resource: { attributes: {} },
      scopeSpans: [{ scope: { name: 'scope', version: null }, spans: [] }],
    })
    expect(request).toEqual({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: 'scope' }, spans: [] }] }] })
  })
})
