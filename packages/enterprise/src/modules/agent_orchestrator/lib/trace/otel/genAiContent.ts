import { GEN_AI_ATTRIBUTES } from '../genAiAttributes'
import { LLM_REQUEST_ARTIFACT_SCHEMA, LLM_RESPONSE_ARTIFACT_SCHEMA } from '../contentCapture'
import { REDACTED_PLACEHOLDER } from '../redactToolSummary'
import { redactPiiStrings, redactString } from '../redactStrings'
import { OM_OTEL_CONTENT_ATTRIBUTES } from './otelAttributes'

export const OTEL_CONTENT_ATTRIBUTE_MAX_BYTES = 65_536

const MAX_DEPTH = 32
const TRUNCATED_SUFFIX = '…[truncated]'
const SHA256_HEX_RE = /^[0-9a-f]{64}$/
const GEN_AI_ROLES = new Set(['system', 'user', 'assistant', 'tool'])
const BINARY_PART_TYPES = new Set(['file', 'image', 'media'])
const FINISH_REASONS: Readonly<Record<string, string>> = {
  'content-filter': 'content_filter',
  'tool-calls': 'tool_call',
  tool_calls: 'tool_call',
}

export type GenAiContentAttribute = { value: string; truncated: boolean }

export type GenAiTextPart = { type: 'text'; content: string }
export type GenAiReasoningPart = { type: 'reasoning'; content: string }
export type GenAiToolCallPart = { type: 'tool_call'; id: string | null; name: string; arguments: unknown }
export type GenAiToolCallResponsePart = { type: 'tool_call_response'; id: string | null; response: unknown }
export type GenAiFilePart = {
  type: 'file'
  modality?: 'image' | 'video' | 'audio'
  mime_type: string | null
  size: number | null
  sha256: string | null
}
export type GenAiMessagePart =
  | GenAiTextPart
  | GenAiReasoningPart
  | GenAiToolCallPart
  | GenAiToolCallResponsePart
  | GenAiFilePart

export type GenAiInputMessage = { role: string; parts: GenAiMessagePart[] }
export type GenAiOutputMessage = { role: 'assistant'; parts: GenAiMessagePart[]; finish_reason: string }
export type GenAiToolDefinition = { type: 'function'; name: string; description?: string; parameters?: unknown }

export type ToolCallContent = { arguments?: GenAiContentAttribute; result?: GenAiContentAttribute }

type MapState = { truncated: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isTruncationMarker(value: unknown): boolean {
  return isRecord(value) && value._truncated === true
}

function readArtifact(value: unknown, schema: string): Record<string, unknown> | null {
  return isRecord(value) && value.schema === schema ? value : null
}

function scrubString(text: string): string {
  return redactString(redactPiiStrings(text).text)
}

function scrubValue(value: unknown, state: MapState, depth: number): unknown {
  if (typeof value === 'string') return scrubString(value)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= MAX_DEPTH) return REDACTED_PLACEHOLDER
  if (isTruncationMarker(value)) {
    state.truncated = true
    return REDACTED_PLACEHOLDER
  }
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, state, depth + 1))
  if (!isRecord(value)) return null
  if (typeof value.type === 'string' && BINARY_PART_TYPES.has(value.type)) return toFilePart(value)
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue
    result[key] = scrubValue(entry, state, depth + 1)
  }
  return result
}

function readMediaType(part: Record<string, unknown>): string | null {
  for (const key of ['mediaType', 'mimeType', 'mime_type']) {
    const candidate = part[key]
    if (typeof candidate === 'string' && candidate !== '') return scrubString(candidate)
  }
  return null
}

function modalityOf(mimeType: string | null): GenAiFilePart['modality'] {
  if (mimeType === null) return undefined
  const family = mimeType.split('/')[0]
  return family === 'image' || family === 'video' || family === 'audio' ? family : undefined
}

function toFilePart(part: Record<string, unknown>): GenAiFilePart {
  const mimeType = readMediaType(part)
  const modality = modalityOf(mimeType)
  const size = typeof part.bytes === 'number' && Number.isSafeInteger(part.bytes) && part.bytes >= 0 ? part.bytes : null
  const sha256 = typeof part.sha256 === 'string' && SHA256_HEX_RE.test(part.sha256) ? part.sha256 : null
  return { type: 'file', ...(modality ? { modality } : {}), mime_type: mimeType, size, sha256 }
}

function readCallId(part: Record<string, unknown>): string | null {
  const candidate = part.toolCallId ?? part.id
  return typeof candidate === 'string' && candidate !== '' ? candidate : null
}

function readToolArguments(part: Record<string, unknown>): unknown {
  if (part.input !== undefined) return part.input
  return part.args
}

function unwrapToolOutput(output: unknown): unknown {
  if (isRecord(output) && typeof output.type === 'string' && 'value' in output) return output.value
  return output
}

function readToolResult(part: Record<string, unknown>): unknown {
  if (part.output !== undefined) return unwrapToolOutput(part.output)
  return part.result
}

function toPart(part: unknown, state: MapState): GenAiMessagePart | null {
  if (typeof part === 'string') return { type: 'text', content: scrubString(part) }
  if (isTruncationMarker(part)) {
    state.truncated = true
    return null
  }
  if (!isRecord(part) || typeof part.type !== 'string') return null
  switch (part.type) {
    case 'text':
      return typeof part.text === 'string' ? { type: 'text', content: scrubString(part.text) } : null
    case 'reasoning':
      return typeof part.text === 'string' ? { type: 'reasoning', content: scrubString(part.text) } : null
    case 'tool-call':
      return {
        type: 'tool_call',
        id: readCallId(part),
        name: typeof part.toolName === 'string' ? scrubString(part.toolName) : '',
        arguments: scrubValue(readToolArguments(part) ?? null, state, 1),
      }
    case 'tool-result':
      return {
        type: 'tool_call_response',
        id: readCallId(part),
        response: scrubValue(readToolResult(part) ?? null, state, 1),
      }
    default:
      return BINARY_PART_TYPES.has(part.type) ? toFilePart(part) : null
  }
}

function toParts(content: unknown, state: MapState): GenAiMessagePart[] {
  if (typeof content === 'string') return [{ type: 'text', content: scrubString(content) }]
  if (isTruncationMarker(content)) {
    state.truncated = true
    return []
  }
  if (!Array.isArray(content)) return []
  const parts: GenAiMessagePart[] = []
  for (const entry of content) {
    const mapped = toPart(entry, state)
    if (mapped) parts.push(mapped)
  }
  return parts
}

function toInputMessage(message: unknown, state: MapState): GenAiInputMessage | null {
  if (isTruncationMarker(message)) {
    state.truncated = true
    return null
  }
  if (!isRecord(message) || typeof message.role !== 'string' || !GEN_AI_ROLES.has(message.role)) return null
  return { role: message.role, parts: toParts(message.content, state) }
}

function normalizeFinishReason(reason: unknown): string {
  if (typeof reason !== 'string' || reason === '') return 'unknown'
  return FINISH_REASONS[reason] ?? scrubString(reason)
}

function truncateString(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  let end = Math.max(0, maxChars)
  const code = text.charCodeAt(end - 1)
  if (end > 0 && code >= 0xd800 && code <= 0xdbff) end -= 1
  return `${text.slice(0, end)}${TRUNCATED_SUFFIX}`
}

function shrinkStrings(value: unknown, maxChars: number): unknown {
  if (typeof value === 'string') return truncateString(value, maxChars)
  if (Array.isArray(value)) return value.map((entry) => shrinkStrings(entry, maxChars))
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) result[key] = shrinkStrings(entry, maxChars)
  return result
}

function longestString(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return value.reduce<number>((max, entry) => Math.max(max, longestString(entry)), 0)
  if (!isRecord(value)) return 0
  return Object.values(value).reduce<number>((max, entry) => Math.max(max, longestString(entry)), 0)
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Serializes `value` as a JSON-string attribute of at most `maxBytes` UTF-8
 * bytes: first shortens string leaves (largest budget that fits), then drops
 * trailing array entries, and finally falls back to an empty container.
 */
export function capContentAttribute(
  value: unknown,
  maxBytes: number = OTEL_CONTENT_ATTRIBUTE_MAX_BYTES,
  alreadyTruncated = false,
): GenAiContentAttribute {
  const serialized = JSON.stringify(value) ?? 'null'
  if (byteLength(serialized) <= maxBytes) return { value: serialized, truncated: alreadyTruncated }
  let low = 0
  let high = longestString(value)
  let best: string | null = null
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = JSON.stringify(shrinkStrings(value, middle)) ?? 'null'
    if (byteLength(candidate) <= maxBytes) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (best !== null) return { value: best, truncated: true }
  if (Array.isArray(value)) {
    const shrunk = shrinkStrings(value, 0) as unknown[]
    for (let length = shrunk.length - 1; length > 0; length -= 1) {
      const candidate = JSON.stringify(shrunk.slice(0, length))
      if (byteLength(candidate) <= maxBytes) return { value: candidate, truncated: true }
    }
    return { value: '[]', truncated: true }
  }
  return { value: typeof value === 'string' ? '""' : isRecord(value) ? '{}' : 'null', truncated: true }
}

export function toSystemInstructions(request: unknown): GenAiContentAttribute | null {
  const artifact = readArtifact(request, LLM_REQUEST_ARTIFACT_SCHEMA)
  if (!artifact) return null
  if (isTruncationMarker(artifact.system)) return capContentAttribute([], OTEL_CONTENT_ATTRIBUTE_MAX_BYTES, true)
  if (typeof artifact.system !== 'string' || artifact.system === '') return null
  const parts: GenAiTextPart[] = [{ type: 'text', content: scrubString(artifact.system) }]
  return capContentAttribute(parts)
}

export function toInputMessages(request: unknown): GenAiContentAttribute | null {
  const artifact = readArtifact(request, LLM_REQUEST_ARTIFACT_SCHEMA)
  if (!artifact || !Array.isArray(artifact.messages)) return null
  const state: MapState = { truncated: false }
  const messages: GenAiInputMessage[] = []
  for (const entry of artifact.messages) {
    const mapped = toInputMessage(entry, state)
    if (mapped) messages.push(mapped)
  }
  return capContentAttribute(messages, OTEL_CONTENT_ATTRIBUTE_MAX_BYTES, state.truncated)
}

export function toOutputMessages(response: unknown): GenAiContentAttribute | null {
  const artifact = readArtifact(response, LLM_RESPONSE_ARTIFACT_SCHEMA)
  if (!artifact || !Array.isArray(artifact.content)) return null
  const state: MapState = { truncated: false }
  const parts = toParts(artifact.content, state)
  if (artifact.object !== undefined) {
    const scrubbed = scrubValue(artifact.object, state, 0)
    parts.push({ type: 'text', content: JSON.stringify(scrubbed) ?? 'null' })
  }
  const messages: GenAiOutputMessage[] = [
    { role: 'assistant', parts, finish_reason: normalizeFinishReason(artifact.finishReason) },
  ]
  return capContentAttribute(messages, OTEL_CONTENT_ATTRIBUTE_MAX_BYTES, state.truncated)
}

export function toToolDefinitions(request: unknown): GenAiContentAttribute | null {
  const artifact = readArtifact(request, LLM_REQUEST_ARTIFACT_SCHEMA)
  if (!artifact || !Array.isArray(artifact.tools) || artifact.tools.length === 0) return null
  const state: MapState = { truncated: false }
  const definitions: GenAiToolDefinition[] = []
  for (const tool of artifact.tools) {
    if (isTruncationMarker(tool)) {
      state.truncated = true
      continue
    }
    if (!isRecord(tool) || typeof tool.name !== 'string' || tool.name === '') continue
    const definition: GenAiToolDefinition = { type: 'function', name: scrubString(tool.name) }
    if (typeof tool.description === 'string') definition.description = scrubString(tool.description)
    if (tool.inputSchema !== undefined && tool.inputSchema !== null) {
      definition.parameters = scrubValue(tool.inputSchema, state, 1)
    }
    definitions.push(definition)
  }
  return capContentAttribute(definitions, OTEL_CONTENT_ATTRIBUTE_MAX_BYTES, state.truncated)
}

function collectToolParts(content: unknown, target: Record<string, unknown>[]): void {
  if (!Array.isArray(content)) return
  for (const part of content) {
    if (isRecord(part) && (part.type === 'tool-call' || part.type === 'tool-result')) target.push(part)
  }
}

/**
 * Indexes tool-call arguments and results from LLM content artifacts by call
 * id. Calls without an id are skipped; the first occurrence of a call id wins.
 */
export function indexToolCallContent(
  requests: ReadonlyArray<unknown>,
  responses: ReadonlyArray<unknown>,
): Map<string, ToolCallContent> {
  const parts: Record<string, unknown>[] = []
  for (const response of responses) {
    const artifact = readArtifact(response, LLM_RESPONSE_ARTIFACT_SCHEMA)
    if (artifact) collectToolParts(artifact.content, parts)
  }
  for (const request of requests) {
    const artifact = readArtifact(request, LLM_REQUEST_ARTIFACT_SCHEMA)
    if (!artifact || !Array.isArray(artifact.messages)) continue
    for (const message of artifact.messages) {
      if (isRecord(message)) collectToolParts(message.content, parts)
    }
  }
  const index = new Map<string, ToolCallContent>()
  for (const part of parts) {
    const callId = readCallId(part)
    if (callId === null) continue
    const entry = index.get(callId) ?? {}
    const state: MapState = { truncated: false }
    if (part.type === 'tool-call' && entry.arguments === undefined) {
      const value = scrubValue(readToolArguments(part) ?? null, state, 0)
      entry.arguments = capContentAttribute(value, OTEL_CONTENT_ATTRIBUTE_MAX_BYTES, state.truncated)
    }
    if (part.type === 'tool-result' && entry.result === undefined) {
      const value = scrubValue(readToolResult(part) ?? null, state, 0)
      entry.result = capContentAttribute(value, OTEL_CONTENT_ATTRIBUTE_MAX_BYTES, state.truncated)
    }
    index.set(callId, entry)
  }
  return index
}

/**
 * Attributes of the `gen_ai.client.inference.operation.details` event for one
 * chat span, or `null` when neither artifact has a known schema.
 */
export function toInferenceDetailsAttributes(
  request: unknown,
  response: unknown,
): Record<string, string | boolean> | null {
  const knownRequest = readArtifact(request, LLM_REQUEST_ARTIFACT_SCHEMA) !== null
  const knownResponse = readArtifact(response, LLM_RESPONSE_ARTIFACT_SCHEMA) !== null
  if (!knownRequest && !knownResponse) return null
  const entries: Array<[string, GenAiContentAttribute | null]> = [
    [GEN_AI_ATTRIBUTES.systemInstructions, toSystemInstructions(request)],
    [GEN_AI_ATTRIBUTES.inputMessages, toInputMessages(request)],
    [GEN_AI_ATTRIBUTES.outputMessages, toOutputMessages(response)],
    [GEN_AI_ATTRIBUTES.toolDefinitions, toToolDefinitions(request)],
  ]
  const attributes: Record<string, string | boolean> = {}
  let truncated =
    (knownRequest && isRecord(request) && request._truncated === true) ||
    (knownResponse && isRecord(response) && response._truncated === true)
  for (const [key, attribute] of entries) {
    if (!attribute) continue
    attributes[key] = attribute.value
    truncated = truncated || attribute.truncated
  }
  if (truncated) attributes[OM_OTEL_CONTENT_ATTRIBUTES.truncated] = true
  return attributes
}
