import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from '@jest/globals'
import {
  encodeOtlpTraceRequest,
  type OtlpResourceSpansInput,
  type OtlpSpanInput,
} from '../lib/trace/otel/otlpJson'
import { encodeOtlpTraceRequestProto } from '../lib/trace/otel/otlpProto'

type WireField =
  | { field: number; wireType: 0; value: bigint }
  | { field: number; wireType: 1; value: Uint8Array }
  | { field: number; wireType: 2; value: Uint8Array }
  | { field: number; wireType: 5; value: Uint8Array }

type DecodeContext = { unknown: string[] }

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

const utf8 = new TextDecoder('utf-8', { fatal: true })

function readVarint(bytes: Uint8Array, start: number): { value: bigint; next: number } {
  let result = BigInt(0)
  let shift = BigInt(0)
  let offset = start
  for (;;) {
    if (offset >= bytes.length) throw new Error('truncated varint')
    const byte = bytes[offset]
    offset += 1
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: result, next: offset }
    shift += BigInt(7)
    if (shift > BigInt(63)) throw new Error('varint too long')
  }
}

function readFields(bytes: Uint8Array): WireField[] {
  const fields: WireField[] = []
  let offset = 0
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset)
    offset = tag.next
    const field = Number(tag.value >> BigInt(3))
    const wireType = Number(tag.value & BigInt(7))
    if (field === 0) throw new Error('field number 0')
    if (wireType === 0) {
      const varint = readVarint(bytes, offset)
      offset = varint.next
      fields.push({ field, wireType, value: varint.value })
    } else if (wireType === 1 || wireType === 5) {
      const size = wireType === 1 ? 8 : 4
      if (offset + size > bytes.length) throw new Error('truncated fixed field')
      fields.push({ field, wireType, value: bytes.subarray(offset, offset + size) })
      offset += size
    } else if (wireType === 2) {
      const length = readVarint(bytes, offset)
      offset = length.next
      const end = offset + Number(length.value)
      if (end > bytes.length) throw new Error('truncated length-delimited field')
      fields.push({ field, wireType, value: bytes.subarray(offset, end) })
      offset = end
    } else {
      throw new Error(`unsupported wire type ${wireType}`)
    }
  }
  return fields
}

function expectWire<T extends WireField['wireType']>(entry: WireField, wireType: T, where: string): Extract<WireField, { wireType: T }> {
  if (entry.wireType !== wireType) throw new Error(`${where}.${entry.field}: wire type ${entry.wireType}, expected ${wireType}`)
  return entry as Extract<WireField, { wireType: T }>
}

const asString = (entry: WireField, where: string) => utf8.decode(expectWire(entry, 2, where).value)
const asHex = (entry: WireField, where: string) => Buffer.from(expectWire(entry, 2, where).value).toString('hex')
const asVarint = (entry: WireField, where: string) => expectWire(entry, 0, where).value
const asFixed64 = (entry: WireField, where: string) =>
  new DataView(Uint8Array.from(expectWire(entry, 1, where).value).buffer).getBigUint64(0, true)
const asDouble = (entry: WireField, where: string) =>
  new DataView(Uint8Array.from(expectWire(entry, 1, where).value).buffer).getFloat64(0, true)

function decodeMessage(
  bytes: Uint8Array,
  where: string,
  ctx: DecodeContext,
  handlers: Record<number, (entry: WireField) => void>,
): void {
  for (const entry of readFields(bytes)) {
    const handler = handlers[entry.field]
    if (handler) handler(entry)
    else ctx.unknown.push(`${where}.${entry.field}`)
  }
}

function decodeAnyValue(bytes: Uint8Array, where: string, ctx: DecodeContext): JsonObject {
  const variants: JsonObject[] = []
  decodeMessage(bytes, where, ctx, {
    1: (entry) => variants.push({ stringValue: asString(entry, where) }),
    2: (entry) => variants.push({ boolValue: asVarint(entry, where) !== BigInt(0) }),
    3: (entry) => variants.push({ intValue: BigInt.asIntN(64, asVarint(entry, where)).toString() }),
    4: (entry) => variants.push({ doubleValue: asDouble(entry, where) }),
    5: (entry) => {
      const values: JsonValue[] = []
      decodeMessage(expectWire(entry, 2, where).value, `${where}.array`, ctx, {
        1: (item) => values.push(decodeAnyValue(expectWire(item, 2, where).value, `${where}.array.value`, ctx)),
      })
      variants.push({ arrayValue: { values } })
    },
    6: (entry) => {
      const values: JsonValue[] = []
      decodeMessage(expectWire(entry, 2, where).value, `${where}.kvlist`, ctx, {
        1: (item) => values.push(decodeKeyValue(expectWire(item, 2, where).value, `${where}.kvlist.value`, ctx)),
      })
      variants.push({ kvlistValue: { values } })
    },
    7: (entry) => variants.push({ bytesValue: asHex(entry, where) }),
  })
  if (variants.length !== 1) throw new Error(`${where}: AnyValue carries ${variants.length} variants`)
  return variants[0]
}

function decodeKeyValue(bytes: Uint8Array, where: string, ctx: DecodeContext): JsonObject {
  let key = ''
  let value: JsonObject | null = null
  decodeMessage(bytes, where, ctx, {
    1: (entry) => {
      key = asString(entry, where)
    },
    2: (entry) => {
      value = decodeAnyValue(expectWire(entry, 2, where).value, `${where}.value`, ctx)
    },
  })
  if (value === null) throw new Error(`${where}: KeyValue without value`)
  return { key, value }
}

function attributeCollector(where: string, ctx: DecodeContext, target: JsonValue[]) {
  return (entry: WireField) => target.push(decodeKeyValue(expectWire(entry, 2, where).value, `${where}.attribute`, ctx))
}

function decodeStatus(bytes: Uint8Array, ctx: DecodeContext): JsonObject {
  const status: JsonObject = { code: 0 }
  decodeMessage(bytes, 'status', ctx, {
    2: (entry) => {
      status.message = asString(entry, 'status')
    },
    3: (entry) => {
      status.code = Number(asVarint(entry, 'status'))
    },
  })
  return status
}

function decodeEvent(bytes: Uint8Array, ctx: DecodeContext): JsonObject {
  const attributes: JsonValue[] = []
  const event: JsonObject = { timeUnixNano: '0', name: '', attributes }
  decodeMessage(bytes, 'event', ctx, {
    1: (entry) => {
      event.timeUnixNano = asFixed64(entry, 'event').toString()
    },
    2: (entry) => {
      event.name = asString(entry, 'event')
    },
    3: attributeCollector('event', ctx, attributes),
  })
  return event
}

function decodeLink(bytes: Uint8Array, ctx: DecodeContext): JsonObject {
  const attributes: JsonValue[] = []
  const link: JsonObject = {}
  decodeMessage(bytes, 'link', ctx, {
    1: (entry) => {
      link.traceId = asHex(entry, 'link')
    },
    2: (entry) => {
      link.spanId = asHex(entry, 'link')
    },
    3: (entry) => {
      link.traceState = asString(entry, 'link')
    },
    4: attributeCollector('link', ctx, attributes),
  })
  if (attributes.length > 0) link.attributes = attributes
  return link
}

function decodeSpan(bytes: Uint8Array, ctx: DecodeContext): JsonObject {
  const attributes: JsonValue[] = []
  const events: JsonValue[] = []
  const links: JsonValue[] = []
  const span: JsonObject = {
    name: '',
    kind: 0,
    startTimeUnixNano: '0',
    endTimeUnixNano: '0',
    attributes,
    events,
    links,
  }
  let statusSeen = false
  decodeMessage(bytes, 'span', ctx, {
    1: (entry) => {
      span.traceId = asHex(entry, 'span')
    },
    2: (entry) => {
      span.spanId = asHex(entry, 'span')
    },
    3: (entry) => {
      span.traceState = asString(entry, 'span')
    },
    4: (entry) => {
      span.parentSpanId = asHex(entry, 'span')
    },
    5: (entry) => {
      span.name = asString(entry, 'span')
    },
    6: (entry) => {
      span.kind = Number(asVarint(entry, 'span'))
    },
    7: (entry) => {
      span.startTimeUnixNano = asFixed64(entry, 'span').toString()
    },
    8: (entry) => {
      span.endTimeUnixNano = asFixed64(entry, 'span').toString()
    },
    9: attributeCollector('span', ctx, attributes),
    11: (entry) => events.push(decodeEvent(expectWire(entry, 2, 'span').value, ctx)),
    13: (entry) => links.push(decodeLink(expectWire(entry, 2, 'span').value, ctx)),
    15: (entry) => {
      statusSeen = true
      span.status = decodeStatus(expectWire(entry, 2, 'span').value, ctx)
    },
  })
  if (!statusSeen) span.status = { code: 0 }
  return span
}

function decodeScopeSpans(bytes: Uint8Array, ctx: DecodeContext): JsonObject {
  const spans: JsonValue[] = []
  const scope: JsonObject = { name: '' }
  decodeMessage(bytes, 'scopeSpans', ctx, {
    1: (entry) =>
      decodeMessage(expectWire(entry, 2, 'scopeSpans').value, 'scope', ctx, {
        1: (field) => {
          scope.name = asString(field, 'scope')
        },
        2: (field) => {
          scope.version = asString(field, 'scope')
        },
      }),
    2: (entry) => spans.push(decodeSpan(expectWire(entry, 2, 'scopeSpans').value, ctx)),
  })
  return { scope, spans }
}

function decodeResourceSpans(bytes: Uint8Array, ctx: DecodeContext): JsonObject {
  const attributes: JsonValue[] = []
  const scopeSpans: JsonValue[] = []
  decodeMessage(bytes, 'resourceSpans', ctx, {
    1: (entry) =>
      decodeMessage(expectWire(entry, 2, 'resourceSpans').value, 'resource', ctx, {
        1: attributeCollector('resource', ctx, attributes),
      }),
    2: (entry) => scopeSpans.push(decodeScopeSpans(expectWire(entry, 2, 'resourceSpans').value, ctx)),
  })
  return { resource: { attributes }, scopeSpans }
}

function decodeTraceRequest(bytes: Uint8Array): { request: JsonObject; unknown: string[] } {
  const ctx: DecodeContext = { unknown: [] }
  const resourceSpans: JsonValue[] = []
  decodeMessage(bytes, 'request', ctx, {
    1: (entry) => resourceSpans.push(decodeResourceSpans(expectWire(entry, 2, 'request').value, ctx)),
  })
  return { request: { resourceSpans }, unknown: ctx.unknown }
}

function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const LINKED_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const ROOT_SPAN_ID = 'b7ad6b7169203331'
const CHILD_SPAN_ID = '00f067aa0ba902b7'
const LINKED_SPAN_ID = 'a2fb4a1d1a96d312'

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

function singleSpanRequest(span: OtlpSpanInput, resourceAttributes: OtlpResourceSpansInput['resource']['attributes'] = {}): OtlpResourceSpansInput {
  return {
    resource: { attributes: resourceAttributes },
    scopeSpans: [{ scope: { name: 'test-scope' }, spans: [span] }],
  }
}

const goldenInput: OtlpResourceSpansInput = {
  resource: { attributes: { 'service.name': 'open-mercato', 'service.version': '1.2.3' } },
  scopeSpans: [
    {
      scope: { name: '@open-mercato/enterprise/agent_orchestrator', version: '1.2.3' },
      spans: [
        {
          traceId: TRACE_ID,
          spanId: CHILD_SPAN_ID,
          parentSpanId: ROOT_SPAN_ID,
          name: 'chat gpt-4o-mini',
          kind: 'client',
          startTime: BigInt('1761580800250000000'),
          endTime: BigInt('1761580801250000123'),
          attributes: {
            'gen_ai.request.model': 'gpt-4o-mini',
            'om.run.retry': false,
            'gen_ai.usage.output_tokens': 42,
            'om.delta': -7,
            'gen_ai.request.temperature': 0.2,
            'gen_ai.response.finish_reasons': ['stop', 'length'],
            'om.capture': { level: 'metadata', redactPii: true, retentionDays: 30 },
          },
          events: [
            {
              time: BigInt('1761580801000000500'),
              name: 'gen_ai.evaluation.result',
              attributes: { 'gen_ai.evaluation.name': 'groundedness', 'gen_ai.evaluation.score.value': 0.9 },
            },
          ],
          links: [{ traceId: LINKED_TRACE_ID, spanId: LINKED_SPAN_ID, attributes: { 'om.link.kind': 'platform_trace' } }],
          status: { code: 'error', message: 'tool_failed' },
        },
      ],
    },
  ],
}

const UPSTREAM_ZERO_OR_FLAG_FIELDS = [
  'resource.2',
  'span.10',
  'event.4',
  'span.12',
  'link.5',
  'link.6',
  'span.14',
  'span.16',
]

function goldenBytes(): Uint8Array {
  const hex = readFileSync(path.join(__dirname, 'fixtures', 'otel', 'trace-request.golden.pb.hex'), 'utf8').trim()
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

describe('encodeOtlpTraceRequestProto', () => {
  test('matches the upstream OpenTelemetry serializer golden fixture field for field', () => {
    const golden = decodeTraceRequest(goldenBytes())
    expect(golden.unknown).toEqual(UPSTREAM_ZERO_OR_FLAG_FIELDS)
    const ours = decodeTraceRequest(encodeOtlpTraceRequestProto(goldenInput))
    expect(ours.unknown).toEqual([])
    expect(ours.request).toEqual(golden.request)
    expect(ours.request).toEqual(toJson(encodeOtlpTraceRequest(goldenInput)))
  })

  test('round-trips a span with every attribute type, events, links and status (JSON parity)', () => {
    const input: OtlpResourceSpansInput[] = [
      singleSpanRequest(
        baseSpan({
          traceId: TRACE_ID.toUpperCase(),
          traceState: 'vendor=1',
          parentSpanId: CHILD_SPAN_ID,
          kind: 'server',
          attributes: {
            text: 'zażółć 🐙',
            empty: '',
            flag: true,
            off: false,
            zero: 0,
            count: 1200,
            negative: -3,
            big: BigInt('9007199254740993'),
            ratio: 0.25,
            'gen_ai.request.temperature': 1,
            list: [1, 'two', [true], null],
            nothing: [],
            nested: { level: 'metadata', inner: { depth: 2 } },
            skipped: null,
          },
          events: [
            { time: new Date('2025-10-27T16:00:00.250Z'), name: 'first', attributes: { 'om.note': 'a' } },
            { time: 1_761_580_801_000.5, name: 'second' },
          ],
          links: [
            { traceId: LINKED_TRACE_ID, spanId: LINKED_SPAN_ID, traceState: 'k=v', attributes: { 'om.link.kind': 'platform_trace' } },
            { traceId: LINKED_TRACE_ID, spanId: ROOT_SPAN_ID },
          ],
          status: { code: 'ok' },
        }),
        { 'service.name': 'open-mercato' },
      ),
      {
        resource: { attributes: {} },
        scopeSpans: [{ scope: { name: 'second', version: '2.0.0' }, spans: [baseSpan({ name: 'tool', status: { code: 'error', message: 'boom' } })] }],
      },
    ]
    const decoded = decodeTraceRequest(encodeOtlpTraceRequestProto(input))
    expect(decoded.unknown).toEqual([])
    expect(decoded.request).toEqual(toJson(encodeOtlpTraceRequest(input)))
  })

  test('accepts a single resource the same way the JSON encoder does', () => {
    const single = singleSpanRequest(baseSpan())
    expect(Buffer.from(encodeOtlpTraceRequestProto(single))).toEqual(Buffer.from(encodeOtlpTraceRequestProto([single])))
  })

  test('writes ids as raw bytes, timestamps as fixed64 and omits proto3 defaults', () => {
    const bytes = encodeOtlpTraceRequestProto(singleSpanRequest(baseSpan({ kind: 'unspecified' })))
    const childField = (entries: WireField[], field: number) => {
      const entry = entries.find((candidate) => candidate.field === field)
      if (!entry) throw new Error(`missing field ${field}`)
      return entry
    }
    const resourceSpans = readFields(expectWire(childField(readFields(bytes), 1), 2, 'request').value)
    const scopeSpans = readFields(expectWire(childField(resourceSpans, 2), 2, 'resourceSpans').value)
    const spanEntry = childField(scopeSpans, 2)
    const spanFields = readFields(expectWire(spanEntry, 2, 'scopeSpans').value)
    expect(spanFields.map((entry) => [entry.field, entry.wireType])).toEqual([
      [1, 2],
      [2, 2],
      [5, 2],
      [7, 1],
      [8, 1],
      [15, 2],
    ])
    expect(expectWire(spanFields[0], 2, 'span').value).toHaveLength(16)
    expect(expectWire(spanFields[1], 2, 'span').value).toHaveLength(8)
    expect(asFixed64(spanFields[3], 'span')).toBe(BigInt('1761580800000000000'))
    expect(expectWire(spanFields[5], 2, 'span').value).toHaveLength(0)
  })

  test('keeps AnyValue oneof members that hold default values', () => {
    const bytes = encodeOtlpTraceRequestProto(
      singleSpanRequest(baseSpan(), { emptyText: '', off: false, zero: 0, emptyList: [], emptyMap: {} }),
    )
    const decoded = decodeTraceRequest(bytes)
    expect(decoded.request).toMatchObject({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'emptyText', value: { stringValue: '' } },
              { key: 'off', value: { boolValue: false } },
              { key: 'zero', value: { intValue: '0' } },
              { key: 'emptyList', value: { arrayValue: { values: [] } } },
              { key: 'emptyMap', value: { kvlistValue: { values: [] } } },
            ],
          },
        },
      ],
    })
  })

  test('encodes negative int64 as ten-byte two’s complement varints and int64 bounds exactly', () => {
    const decoded = decodeTraceRequest(
      encodeOtlpTraceRequestProto(
        singleSpanRequest(baseSpan(), {
          min: BigInt('-9223372036854775808'),
          max: BigInt('9223372036854775807'),
          negative: -1,
        }),
      ),
    )
    expect(decoded.request).toMatchObject({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'min', value: { intValue: '-9223372036854775808' } },
              { key: 'max', value: { intValue: '9223372036854775807' } },
              { key: 'negative', value: { intValue: '-1' } },
            ],
          },
        },
      ],
    })
    expect(Buffer.from(encodeOtlpTraceRequestProto(singleSpanRequest(baseSpan(), { n: -1 }))).toString('hex')).toContain(
      '18ffffffffffffffffff01',
    )
  })

  test('falls back to a decimal string for integers outside the int64 range', () => {
    const decoded = decodeTraceRequest(
      encodeOtlpTraceRequestProto(singleSpanRequest(baseSpan(), { huge: BigInt('9223372036854775808') })),
    )
    expect(decoded.request).toMatchObject({
      resourceSpans: [{ resource: { attributes: [{ key: 'huge', value: { stringValue: '9223372036854775808' } }] } }],
    })
  })

  test('rejects timestamps that do not fit fixed64 and invalid ids', () => {
    expect(() =>
      encodeOtlpTraceRequestProto(singleSpanRequest(baseSpan({ endTime: BigInt('18446744073709551616') }))),
    ).toThrow('[internal]')
    expect(() => encodeOtlpTraceRequestProto(singleSpanRequest(baseSpan({ spanId: 'not-hex' })))).toThrow('[internal]')
  })
})
