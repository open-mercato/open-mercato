import {
  encodeOtlpTraceRequest,
  type OtlpAnyValue,
  type OtlpEncodedEvent,
  type OtlpEncodedLink,
  type OtlpEncodedResourceSpans,
  type OtlpEncodedScopeSpans,
  type OtlpEncodedSpan,
  type OtlpEncodedStatus,
  type OtlpKeyValue,
  type OtlpResourceSpansInput,
} from './otlpJson'

const WIRE_VARINT = 0
const WIRE_FIXED64 = 1
const WIRE_LENGTH_DELIMITED = 2

const UINT64_MAX = BigInt('18446744073709551615')
const INT64_MIN = BigInt('-9223372036854775808')
const INT64_MAX = BigInt('9223372036854775807')
const SEVEN_BITS = BigInt(0x7f)
const CONTINUATION_BIT = BigInt(0x80)
const SHIFT_SEVEN = BigInt(7)
const ZERO = BigInt(0)

const utf8 = new TextEncoder()

type ProtoParts = Uint8Array[]

function encodeVarint(value: bigint): Uint8Array {
  const bytes: number[] = []
  let remaining = BigInt.asUintN(64, value)
  while (remaining > SEVEN_BITS) {
    bytes.push(Number((remaining & SEVEN_BITS) | CONTINUATION_BIT))
    remaining >>= SHIFT_SEVEN
  }
  bytes.push(Number(remaining))
  return Uint8Array.from(bytes)
}

function concatParts(parts: ProtoParts): Uint8Array {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function writeTag(out: ProtoParts, field: number, wireType: number): void {
  out.push(encodeVarint(BigInt((field << 3) | wireType)))
}

function writeVarintField(out: ProtoParts, field: number, value: bigint): void {
  writeTag(out, field, WIRE_VARINT)
  out.push(encodeVarint(value))
}

function writeFixed64Field(out: ProtoParts, field: number, value: bigint): void {
  writeTag(out, field, WIRE_FIXED64)
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value, true)
  out.push(bytes)
}

function writeDoubleField(out: ProtoParts, field: number, value: number): void {
  writeTag(out, field, WIRE_FIXED64)
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value, true)
  out.push(bytes)
}

function writeBytesField(out: ProtoParts, field: number, value: Uint8Array): void {
  writeTag(out, field, WIRE_LENGTH_DELIMITED)
  out.push(encodeVarint(BigInt(value.length)))
  out.push(value)
}

function writeStringField(out: ProtoParts, field: number, value: string): void {
  writeBytesField(out, field, utf8.encode(value))
}

function writeOptionalStringField(out: ProtoParts, field: number, value: string | undefined): void {
  if (typeof value === 'string' && value.length > 0) writeStringField(out, field, value)
}

function writeMessageField(out: ProtoParts, field: number, message: ProtoParts): void {
  writeBytesField(out, field, concatParts(message))
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function parseUnixNano(value: string): bigint {
  const nanos = BigInt(value)
  if (nanos < ZERO || nanos > UINT64_MAX) {
    throw new Error('[internal] OTLP timestamp does not fit an unsigned 64-bit nanosecond value')
  }
  return nanos
}

function writeTimestampField(out: ProtoParts, field: number, value: string): void {
  const nanos = parseUnixNano(value)
  if (nanos !== ZERO) writeFixed64Field(out, field, nanos)
}

function encodeAnyValueMessage(value: OtlpAnyValue): ProtoParts {
  const out: ProtoParts = []
  if ('stringValue' in value) {
    writeStringField(out, 1, value.stringValue)
  } else if ('boolValue' in value) {
    writeVarintField(out, 2, value.boolValue ? BigInt(1) : ZERO)
  } else if ('intValue' in value) {
    const intValue = BigInt(value.intValue)
    if (intValue >= INT64_MIN && intValue <= INT64_MAX) {
      writeVarintField(out, 3, intValue)
    } else {
      writeStringField(out, 1, value.intValue)
    }
  } else if ('doubleValue' in value) {
    writeDoubleField(out, 4, value.doubleValue)
  } else if ('arrayValue' in value) {
    const array: ProtoParts = []
    for (const item of value.arrayValue.values) writeMessageField(array, 1, encodeAnyValueMessage(item))
    writeMessageField(out, 5, array)
  } else if ('kvlistValue' in value) {
    const list: ProtoParts = []
    writeKeyValues(list, 1, value.kvlistValue.values)
    writeMessageField(out, 6, list)
  }
  return out
}

function writeKeyValues(out: ProtoParts, field: number, attributes: readonly OtlpKeyValue[] | undefined): void {
  for (const attribute of attributes ?? []) {
    const keyValue: ProtoParts = []
    writeOptionalStringField(keyValue, 1, attribute.key)
    writeMessageField(keyValue, 2, encodeAnyValueMessage(attribute.value))
    writeMessageField(out, field, keyValue)
  }
}

function encodeStatusMessage(status: OtlpEncodedStatus): ProtoParts {
  const out: ProtoParts = []
  writeOptionalStringField(out, 2, status.message)
  if (status.code !== 0) writeVarintField(out, 3, BigInt(status.code))
  return out
}

function encodeEventMessage(event: OtlpEncodedEvent): ProtoParts {
  const out: ProtoParts = []
  writeTimestampField(out, 1, event.timeUnixNano)
  writeOptionalStringField(out, 2, event.name)
  writeKeyValues(out, 3, event.attributes)
  return out
}

function encodeLinkMessage(link: OtlpEncodedLink): ProtoParts {
  const out: ProtoParts = []
  writeBytesField(out, 1, hexToBytes(link.traceId))
  writeBytesField(out, 2, hexToBytes(link.spanId))
  writeOptionalStringField(out, 3, link.traceState)
  writeKeyValues(out, 4, link.attributes)
  return out
}

function encodeSpanMessage(span: OtlpEncodedSpan): ProtoParts {
  const out: ProtoParts = []
  writeBytesField(out, 1, hexToBytes(span.traceId))
  writeBytesField(out, 2, hexToBytes(span.spanId))
  writeOptionalStringField(out, 3, span.traceState)
  if (span.parentSpanId) writeBytesField(out, 4, hexToBytes(span.parentSpanId))
  writeOptionalStringField(out, 5, span.name)
  if (span.kind !== 0) writeVarintField(out, 6, BigInt(span.kind))
  writeTimestampField(out, 7, span.startTimeUnixNano)
  writeTimestampField(out, 8, span.endTimeUnixNano)
  writeKeyValues(out, 9, span.attributes)
  for (const event of span.events) writeMessageField(out, 11, encodeEventMessage(event))
  for (const link of span.links) writeMessageField(out, 13, encodeLinkMessage(link))
  writeMessageField(out, 15, encodeStatusMessage(span.status))
  return out
}

function encodeScopeSpansMessage(scopeSpans: OtlpEncodedScopeSpans): ProtoParts {
  const out: ProtoParts = []
  const scope: ProtoParts = []
  writeOptionalStringField(scope, 1, scopeSpans.scope.name)
  writeOptionalStringField(scope, 2, scopeSpans.scope.version)
  writeMessageField(out, 1, scope)
  for (const span of scopeSpans.spans) writeMessageField(out, 2, encodeSpanMessage(span))
  return out
}

function encodeResourceSpansMessage(resourceSpans: OtlpEncodedResourceSpans): ProtoParts {
  const out: ProtoParts = []
  const resource: ProtoParts = []
  writeKeyValues(resource, 1, resourceSpans.resource.attributes)
  writeMessageField(out, 1, resource)
  for (const scopeSpans of resourceSpans.scopeSpans) writeMessageField(out, 2, encodeScopeSpansMessage(scopeSpans))
  return out
}

export function encodeOtlpTraceRequestProto(
  resourceSpans: OtlpResourceSpansInput | readonly OtlpResourceSpansInput[],
): Uint8Array {
  const request = encodeOtlpTraceRequest(resourceSpans)
  const out: ProtoParts = []
  for (const entry of request.resourceSpans) writeMessageField(out, 1, encodeResourceSpansMessage(entry))
  return concatParts(out)
}
