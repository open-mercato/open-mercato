export type OtlpAttributeValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | readonly OtlpAttributeValue[]
  | { readonly [key: string]: OtlpAttributeValue }

export type OtlpAttributes = Readonly<Record<string, OtlpAttributeValue>>

export type OtlpTimestamp = number | bigint | Date

export const OTLP_SPAN_KIND = {
  unspecified: 0,
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
} as const

export type OtlpSpanKindName = keyof typeof OTLP_SPAN_KIND

export const OTLP_STATUS_CODE = {
  unset: 0,
  ok: 1,
  error: 2,
} as const

export type OtlpStatusCodeName = keyof typeof OTLP_STATUS_CODE

export type OtlpStatusInput = {
  code: OtlpStatusCodeName
  message?: string | null
}

export type OtlpEventInput = {
  time: OtlpTimestamp
  name: string
  attributes?: OtlpAttributes
}

export type OtlpLinkInput = {
  traceId: string
  spanId: string
  traceState?: string | null
  attributes?: OtlpAttributes
}

export type OtlpSpanInput = {
  traceId: string
  spanId: string
  parentSpanId?: string | null
  traceState?: string | null
  name: string
  kind: OtlpSpanKindName
  startTime: OtlpTimestamp
  endTime: OtlpTimestamp
  attributes?: OtlpAttributes
  events?: readonly OtlpEventInput[]
  links?: readonly OtlpLinkInput[]
  status?: OtlpStatusInput
}

export type OtlpScopeInput = {
  name: string
  version?: string | null
}

export type OtlpScopeSpansInput = {
  scope: OtlpScopeInput
  spans: readonly OtlpSpanInput[]
}

export type OtlpResourceSpansInput = {
  resource: { attributes: OtlpAttributes }
  scopeSpans: readonly OtlpScopeSpansInput[]
}

export type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpAnyValue[] } }
  | { kvlistValue: { values: OtlpKeyValue[] } }

export type OtlpKeyValue = {
  key: string
  value: OtlpAnyValue
}

export type OtlpEncodedStatus = {
  code: number
  message?: string
}

export type OtlpEncodedEvent = {
  timeUnixNano: string
  name: string
  attributes: OtlpKeyValue[]
}

export type OtlpEncodedLink = {
  traceId: string
  spanId: string
  traceState?: string
  attributes?: OtlpKeyValue[]
}

export type OtlpEncodedSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  traceState?: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpKeyValue[]
  events: OtlpEncodedEvent[]
  links: OtlpEncodedLink[]
  status: OtlpEncodedStatus
}

export type OtlpEncodedScopeSpans = {
  scope: { name: string; version?: string }
  spans: OtlpEncodedSpan[]
}

export type OtlpEncodedResourceSpans = {
  resource: { attributes: OtlpKeyValue[] }
  scopeSpans: OtlpEncodedScopeSpans[]
}

export type OtlpExportTraceServiceRequest = {
  resourceSpans: OtlpEncodedResourceSpans[]
}

const NANOS_PER_MILLI = BigInt(1_000_000)
const TRACE_ID_HEX_RE = /^[0-9a-f]{32}$/
const SPAN_ID_HEX_RE = /^[0-9a-f]{16}$/
const ZERO_ID_RE = /^0+$/

export function msToUnixNanoString(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs < 0) {
    throw new Error('[internal] OTLP timestamp must be a finite, non-negative epoch milliseconds value')
  }
  const wholeMs = Math.floor(epochMs)
  const fractionNanos = Math.round((epochMs - wholeMs) * 1_000_000)
  return (BigInt(wholeMs) * NANOS_PER_MILLI + BigInt(fractionNanos)).toString()
}

export function toUnixNanoString(timestamp: OtlpTimestamp): string {
  if (typeof timestamp === 'bigint') {
    if (timestamp < BigInt(0)) {
      throw new Error('[internal] OTLP timestamp must be a non-negative nanosecond value')
    }
    return timestamp.toString()
  }
  if (timestamp instanceof Date) return msToUnixNanoString(timestamp.getTime())
  return msToUnixNanoString(timestamp)
}

function normalizeId(value: string, pattern: RegExp, field: string): string {
  const normalized = typeof value === 'string' ? value.toLowerCase() : ''
  if (!pattern.test(normalized) || ZERO_ID_RE.test(normalized)) {
    throw new Error(`[internal] OTLP ${field} must be a non-zero lowercase hex id`)
  }
  return normalized
}

function isPlainObject(value: unknown): value is { readonly [key: string]: OtlpAttributeValue } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function encodeAnyValue(value: OtlpAttributeValue): OtlpAnyValue | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'bigint') return { intValue: value.toString() }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (Number.isSafeInteger(value)) return { intValue: String(value) }
    return { doubleValue: value }
  }
  if (Array.isArray(value)) {
    const values: OtlpAnyValue[] = []
    for (const item of value) {
      const encoded = encodeAnyValue(item)
      if (encoded) values.push(encoded)
    }
    return { arrayValue: { values } }
  }
  if (isPlainObject(value)) {
    return { kvlistValue: { values: encodeAttributes(value) } }
  }
  return null
}

export function encodeAttributes(attributes: OtlpAttributes | undefined): OtlpKeyValue[] {
  if (!attributes) return []
  const encoded: OtlpKeyValue[] = []
  for (const [key, value] of Object.entries(attributes)) {
    if (key.length === 0) continue
    const anyValue = encodeAnyValue(value)
    if (anyValue) encoded.push({ key, value: anyValue })
  }
  return encoded
}

function encodeStatus(status: OtlpStatusInput | undefined): OtlpEncodedStatus {
  if (!status) return { code: OTLP_STATUS_CODE.unset }
  const encoded: OtlpEncodedStatus = { code: OTLP_STATUS_CODE[status.code] }
  if (typeof status.message === 'string' && status.message.length > 0) {
    encoded.message = status.message
  }
  return encoded
}

function encodeEvent(event: OtlpEventInput): OtlpEncodedEvent {
  return {
    timeUnixNano: toUnixNanoString(event.time),
    name: event.name,
    attributes: encodeAttributes(event.attributes),
  }
}

function encodeLink(link: OtlpLinkInput): OtlpEncodedLink {
  const encoded: OtlpEncodedLink = {
    traceId: normalizeId(link.traceId, TRACE_ID_HEX_RE, 'link traceId'),
    spanId: normalizeId(link.spanId, SPAN_ID_HEX_RE, 'link spanId'),
  }
  if (typeof link.traceState === 'string' && link.traceState.length > 0) {
    encoded.traceState = link.traceState
  }
  const attributes = encodeAttributes(link.attributes)
  if (attributes.length > 0) encoded.attributes = attributes
  return encoded
}

export function encodeOtlpSpan(span: OtlpSpanInput): OtlpEncodedSpan {
  const encoded: OtlpEncodedSpan = {
    traceId: normalizeId(span.traceId, TRACE_ID_HEX_RE, 'traceId'),
    spanId: normalizeId(span.spanId, SPAN_ID_HEX_RE, 'spanId'),
    name: span.name,
    kind: OTLP_SPAN_KIND[span.kind],
    startTimeUnixNano: toUnixNanoString(span.startTime),
    endTimeUnixNano: toUnixNanoString(span.endTime),
    attributes: encodeAttributes(span.attributes),
    events: (span.events ?? []).map(encodeEvent),
    links: (span.links ?? []).map(encodeLink),
    status: encodeStatus(span.status),
  }
  if (typeof span.parentSpanId === 'string' && span.parentSpanId.length > 0) {
    encoded.parentSpanId = normalizeId(span.parentSpanId, SPAN_ID_HEX_RE, 'parentSpanId')
  }
  if (typeof span.traceState === 'string' && span.traceState.length > 0) {
    encoded.traceState = span.traceState
  }
  return encoded
}

function encodeScopeSpans(scopeSpans: OtlpScopeSpansInput): OtlpEncodedScopeSpans {
  const scope: OtlpEncodedScopeSpans['scope'] = { name: scopeSpans.scope.name }
  if (typeof scopeSpans.scope.version === 'string' && scopeSpans.scope.version.length > 0) {
    scope.version = scopeSpans.scope.version
  }
  return { scope, spans: scopeSpans.spans.map(encodeOtlpSpan) }
}

export function encodeOtlpTraceRequest(
  resourceSpans: OtlpResourceSpansInput | readonly OtlpResourceSpansInput[],
): OtlpExportTraceServiceRequest {
  const list: readonly OtlpResourceSpansInput[] = Array.isArray(resourceSpans)
    ? resourceSpans
    : [resourceSpans as OtlpResourceSpansInput]
  return {
    resourceSpans: list.map((entry) => ({
      resource: { attributes: encodeAttributes(entry.resource.attributes) },
      scopeSpans: entry.scopeSpans.map(encodeScopeSpans),
    })),
  }
}
