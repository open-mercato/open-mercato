import { createHash } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type {
  AiAgentCallSettings,
  AiAgentModelCallUsage,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'
import { REDACTED_PLACEHOLDER, isSecretKey } from './redactToolSummary'
import { redactPiiStrings, redactSecretStringsCounted, type StringRedactionCounts } from './redactStrings'

const logger = createLogger('agent_orchestrator').child({ component: 'trace-content-capture' })

export const LLM_REQUEST_ARTIFACT_SCHEMA = 'om.llm_request.v1'
export const LLM_RESPONSE_ARTIFACT_SCHEMA = 'om.llm_response.v1'
export const TRACE_CONTENT_MAX_BYTES_ENV = 'OM_AGENT_TRACE_CONTENT_MAX_BYTES'
export const DEFAULT_TRACE_CONTENT_MAX_BYTES = 1_048_576

const MAX_DEPTH = 32
const SECRET_KEY_RULE = 'secret_key'
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/
const DATA_URL_RE = /^data:([^;,]*)(;base64)?,(.*)$/s

export type ContentRedaction = { rule: string; count: number }

export type ContentArtifact<TPayload> = {
  payload: TPayload
  bytes: number
  truncated: boolean
  redactions: ContentRedaction[]
}

export type ContentCaptureOptions = {
  redactPii: boolean
  maxBytes?: number
}

export type LlmRequestCallInput = {
  provider: string
  modelId: string
  system: string | undefined
  messages: unknown[]
  tools: ReadonlyArray<Record<string, unknown>> | undefined
  responseFormat: unknown | undefined
  callSettings: AiAgentCallSettings | undefined
}

export type LlmResponseCallInput = {
  finishReason: string
  content: unknown[]
  object?: unknown
  usage: AiAgentModelCallUsage
  providerMetadata?: Record<string, unknown>
}

export type FilePartSummary = { type: 'file'; mediaType: string | null; bytes: number; sha256: string }

export type LlmRequestArtifactTool = { name: string; description: string | null; inputSchema: unknown }

export type TruncationMarker = { _truncated: true; originalBytes: number }

export type LlmRequestArtifact = {
  schema: typeof LLM_REQUEST_ARTIFACT_SCHEMA
  provider: string
  modelId: string
  system: unknown
  messages: unknown[]
  tools: unknown[]
  responseFormat: unknown
  params: unknown
}

export type LlmResponseArtifact = {
  schema: typeof LLM_RESPONSE_ARTIFACT_SCHEMA
  finishReason: string
  content: unknown[]
  object?: unknown
  usage: unknown
  providerMetadata?: unknown
}

type EnvLike = Record<string, string | undefined>

const warnedMaxBytesValues = new Set<string>()

export function resolveTraceContentMaxBytes(env: EnvLike = process.env): number {
  const raw = env[TRACE_CONTENT_MAX_BYTES_ENV]
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRACE_CONTENT_MAX_BYTES
  const trimmed = raw.trim()
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  if (!warnedMaxBytesValues.has(trimmed)) {
    warnedMaxBytesValues.add(trimmed)
    logger.warn('malformed trace content byte cap; using the default', {
      variable: TRACE_CONTENT_MAX_BYTES_ENV,
      value: trimmed,
      defaultBytes: DEFAULT_TRACE_CONTENT_MAX_BYTES,
    })
  }
  return DEFAULT_TRACE_CONTENT_MAX_BYTES
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function binarySummary(bytes: Uint8Array, mediaType: string | null): FilePartSummary {
  return { type: 'file', mediaType, bytes: bytes.byteLength, sha256: sha256Hex(bytes) }
}

function toBytes(value: unknown): { bytes: Uint8Array; mediaType: string | null } | null {
  if (value instanceof Uint8Array) return { bytes: value, mediaType: null }
  if (value instanceof ArrayBuffer) return { bytes: new Uint8Array(value), mediaType: null }
  if (value instanceof URL) return { bytes: Buffer.from(value.href, 'utf8'), mediaType: null }
  if (typeof value !== 'string') return null
  const dataUrl = DATA_URL_RE.exec(value)
  if (dataUrl) {
    const mediaType = dataUrl[1] ? dataUrl[1] : null
    const payload = dataUrl[2] ? Buffer.from(dataUrl[3], 'base64') : Buffer.from(decodeURIComponent(dataUrl[3]), 'utf8')
    return { bytes: payload, mediaType }
  }
  const compact = value.replace(/\s+/g, '')
  if (compact.length > 0 && compact.length % 4 === 0 && BASE64_RE.test(compact)) {
    return { bytes: Buffer.from(compact, 'base64'), mediaType: null }
  }
  return { bytes: Buffer.from(value, 'utf8'), mediaType: null }
}

function readFileSource(part: Record<string, unknown>): unknown {
  for (const key of ['data', 'image', 'uint8Array', 'uint8ArrayData', 'base64', 'base64Data']) {
    if (part[key] !== undefined && part[key] !== null) return part[key]
  }
  const nested = part.file
  if (nested !== null && typeof nested === 'object') return readFileSource(nested as Record<string, unknown>)
  return undefined
}

function readMediaType(part: Record<string, unknown>): string | null {
  for (const key of ['mediaType', 'mimeType']) {
    if (typeof part[key] === 'string' && part[key] !== '') return part[key] as string
  }
  const nested = part.file
  if (nested !== null && typeof nested === 'object') return readMediaType(nested as Record<string, unknown>)
  return null
}

function isFilePart(value: Record<string, unknown>): boolean {
  return (value.type === 'file' || value.type === 'image') && readFileSource(value) !== undefined
}

export function summarizeFilePart(part: Record<string, unknown>): FilePartSummary {
  const decoded = toBytes(readFileSource(part)) ?? { bytes: new Uint8Array(0), mediaType: null }
  return binarySummary(decoded.bytes, readMediaType(part) ?? decoded.mediaType)
}

type SanitizeState = {
  redactPii: boolean
  counts: StringRedactionCounts
  seen: WeakSet<object>
}

function addCounts(target: StringRedactionCounts, source: StringRedactionCounts): void {
  for (const [rule, count] of Object.entries(source)) target[rule] = (target[rule] ?? 0) + count
}

function sanitizeString(text: string, state: SanitizeState): string {
  const secret = redactSecretStringsCounted(text)
  addCounts(state.counts, secret.counts)
  if (!state.redactPii) return secret.text
  const pii = redactPiiStrings(secret.text)
  addCounts(state.counts, pii.counts)
  return pii.text
}

function sanitizeValue(value: unknown, state: SanitizeState, redactKeys: boolean, depth: number): unknown {
  if (typeof value === 'string') return sanitizeString(value, state)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return undefined
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return binarySummary(toBytes(value)?.bytes ?? new Uint8Array(0), null)
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value instanceof URL) return sanitizeString(value.href, state)
  if (depth >= MAX_DEPTH || state.seen.has(value)) return REDACTED_PLACEHOLDER
  if (Array.isArray(value)) {
    state.seen.add(value)
    const result = value.map((entry) => {
      const sanitized = sanitizeValue(entry, state, redactKeys, depth + 1)
      return sanitized === undefined ? null : sanitized
    })
    state.seen.delete(value)
    return result
  }
  if (!isPlainObject(value)) return REDACTED_PLACEHOLDER
  if (isFilePart(value)) return summarizeFilePart(value)
  state.seen.add(value)
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (redactKeys && isSecretKey(key)) {
      result[key] = REDACTED_PLACEHOLDER
      state.counts[SECRET_KEY_RULE] = (state.counts[SECRET_KEY_RULE] ?? 0) + 1
      continue
    }
    const sanitized = sanitizeValue(entry, state, redactKeys, depth + 1)
    if (sanitized !== undefined) result[key] = sanitized
  }
  state.seen.delete(value)
  return result
}

function jsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value)
  return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8')
}

type TruncationSlot = {
  read(): unknown
  write(marker: TruncationMarker): void
}

function slot(container: Record<string, unknown> | unknown[], key: string | number): TruncationSlot {
  return {
    read: () => Reflect.get(container, key),
    write: (marker) => {
      Reflect.set(container, key, marker)
    },
  }
}

function capPayload<TPayload extends { schema: string }>(
  payload: TPayload,
  slotGroups: TruncationSlot[][],
  maxBytes: number,
): { payload: TPayload | (Pick<TPayload, 'schema'> & TruncationMarker); bytes: number; truncated: boolean } {
  let total = jsonBytes(payload)
  if (total <= maxBytes) return { payload, bytes: total, truncated: false }
  for (const group of slotGroups) {
    const candidates = group
      .map((entry, index) => ({ entry, index, bytes: jsonBytes(entry.read()) }))
      .filter((candidate) => candidate.bytes > 0)
    candidates.sort((left, right) => right.bytes - left.bytes || left.index - right.index)
    for (const candidate of candidates) {
      if (total <= maxBytes) break
      const marker: TruncationMarker = { _truncated: true, originalBytes: candidate.bytes }
      const delta = candidate.bytes - jsonBytes(marker)
      if (delta <= 0) continue
      candidate.entry.write(marker)
      total -= delta
    }
    if (total <= maxBytes) return { payload, bytes: total, truncated: true }
  }
  const fallback = { schema: payload.schema, _truncated: true as const, originalBytes: jsonBytes(payload) }
  return { payload: fallback as Pick<TPayload, 'schema'> & TruncationMarker, bytes: jsonBytes(fallback), truncated: true }
}

function toRedactionList(counts: StringRedactionCounts): ContentRedaction[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([rule, count]) => ({ rule, count }))
}

function newState(options: ContentCaptureOptions): SanitizeState {
  return { redactPii: options.redactPii === true, counts: {}, seen: new WeakSet() }
}

function resolveMaxBytes(options: ContentCaptureOptions): number {
  const explicit = options.maxBytes
  if (typeof explicit === 'number' && Number.isSafeInteger(explicit) && explicit > 0) return explicit
  return resolveTraceContentMaxBytes()
}

function normalizeTool(definition: Record<string, unknown>, state: SanitizeState): LlmRequestArtifactTool {
  const schemaSource = definition.inputSchema ?? definition.parameters ?? null
  return {
    name: typeof definition.name === 'string' ? sanitizeString(definition.name, state) : '',
    description: typeof definition.description === 'string' ? sanitizeString(definition.description, state) : null,
    inputSchema: sanitizeValue(schemaSource, state, false, 1) ?? null,
  }
}

function contentSlots(entries: unknown[]): TruncationSlot[] {
  return entries.map((entry, index) => (isPlainObject(entry) && 'content' in entry ? slot(entry, 'content') : slot(entries, index)))
}

export function buildLlmRequestArtifact(
  call: LlmRequestCallInput,
  options: ContentCaptureOptions,
): ContentArtifact<LlmRequestArtifact | (Pick<LlmRequestArtifact, 'schema'> & TruncationMarker)> {
  const state = newState(options)
  const messages = Array.isArray(call.messages) ? call.messages : []
  const sanitizedMessages = sanitizeValue(messages, state, true, 0) as unknown[]
  const tools = (call.tools ?? []).map((definition) =>
    isPlainObject(definition) ? normalizeTool(definition, state) : { name: '', description: null, inputSchema: null },
  )
  const payload: LlmRequestArtifact = {
    schema: LLM_REQUEST_ARTIFACT_SCHEMA,
    provider: sanitizeString(call.provider, state),
    modelId: sanitizeString(call.modelId, state),
    system: typeof call.system === 'string' ? sanitizeString(call.system, state) : null,
    messages: sanitizedMessages,
    tools,
    responseFormat: sanitizeValue(call.responseFormat ?? null, state, false, 0) ?? null,
    params: sanitizeValue(call.callSettings ?? {}, state, true, 0) ?? {},
  }
  const holder = payload as unknown as Record<string, unknown>
  const capped = capPayload(
    payload,
    [
      [...contentSlots(sanitizedMessages), slot(holder, 'system')],
      [...tools.map((_tool, index) => slot(tools, index)), slot(holder, 'responseFormat'), slot(holder, 'params')],
    ],
    resolveMaxBytes(options),
  )
  return { ...capped, redactions: toRedactionList(state.counts) }
}

export function buildLlmResponseArtifact(
  call: LlmResponseCallInput,
  options: ContentCaptureOptions,
): ContentArtifact<LlmResponseArtifact | (Pick<LlmResponseArtifact, 'schema'> & TruncationMarker)> {
  const state = newState(options)
  const content = sanitizeValue(Array.isArray(call.content) ? call.content : [], state, true, 0) as unknown[]
  const payload: LlmResponseArtifact = {
    schema: LLM_RESPONSE_ARTIFACT_SCHEMA,
    finishReason: sanitizeString(call.finishReason, state),
    content,
    usage: sanitizeValue(call.usage ?? {}, state, false, 0) ?? {},
  }
  if (call.object !== undefined) payload.object = sanitizeValue(call.object, state, true, 0) ?? null
  if (call.providerMetadata !== undefined) {
    payload.providerMetadata = sanitizeValue(call.providerMetadata, state, true, 0) ?? null
  }
  const holder = payload as unknown as Record<string, unknown>
  const capped = capPayload(
    payload,
    [
      [...content.map((_part, index) => slot(content, index)), slot(holder, 'object')],
      [slot(holder, 'providerMetadata')],
    ],
    resolveMaxBytes(options),
  )
  return { ...capped, redactions: toRedactionList(state.counts) }
}

export const CONTEXT_PAYLOAD_ARTIFACT_SCHEMA = 'om.context_payload.v1'

export type ContextPayloadRecordInput = {
  kind: string
  ref: string
  locator?: string
  score?: number
  record: Record<string, unknown>
}

export type ContextPayloadSpanInput = {
  sourceKind: string
  sourceRef: string
  locator: string
  text: string
}

export type ContextPayloadRetrievalInput = {
  query: string
  queryHash: string
  k: number
}

export type ContextPayloadInput = {
  capability: string
  records: ContextPayloadRecordInput[]
  untrustedSpans: ContextPayloadSpanInput[]
  retrieval: ContextPayloadRetrievalInput[]
}

export type ContextPayloadArtifact = {
  schema: typeof CONTEXT_PAYLOAD_ARTIFACT_SCHEMA
  capability: string
  records: unknown[]
  untrustedSpans: unknown[]
  retrieval: unknown[]
}

export function buildContextPayloadArtifact(
  input: ContextPayloadInput,
  options: ContentCaptureOptions,
): ContentArtifact<ContextPayloadArtifact | (Pick<ContextPayloadArtifact, 'schema'> & TruncationMarker)> {
  const state = newState(options)
  const records = sanitizeValue(input.records, state, true, 0) as unknown[]
  const untrustedSpans = sanitizeValue(input.untrustedSpans, state, false, 0) as unknown[]
  const retrieval = sanitizeValue(input.retrieval, state, false, 0) as unknown[]
  const payload: ContextPayloadArtifact = {
    schema: CONTEXT_PAYLOAD_ARTIFACT_SCHEMA,
    capability: sanitizeString(input.capability, state),
    records,
    untrustedSpans,
    retrieval,
  }
  const recordSlots = records.map((entry, index) =>
    isPlainObject(entry) && 'record' in entry ? slot(entry, 'record') : slot(records, index),
  )
  const spanSlots = untrustedSpans.map((entry, index) =>
    isPlainObject(entry) && 'text' in entry ? slot(entry, 'text') : slot(untrustedSpans, index),
  )
  const capped = capPayload(
    payload,
    [[...recordSlots, ...spanSlots], retrieval.map((_entry, index) => slot(retrieval, index))],
    resolveMaxBytes(options),
  )
  return { ...capped, redactions: toRedactionList(state.counts) }
}
