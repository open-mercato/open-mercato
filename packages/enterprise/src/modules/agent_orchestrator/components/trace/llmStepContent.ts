import type { ContentStatus, LlmSpanMetadata } from '../../lib/trace/genAiAttributes'

export const LLM_CONTENT_KINDS = ['llm_request', 'llm_response'] as const
export type LlmContentKind = (typeof LLM_CONTENT_KINDS)[number]

export const MESSAGE_PAGE_SIZE = 200

export type LlmContentRef = {
  key: string | null
  sha256: string | null
  bytes: number | null
}

export type LlmStepContentRefs = {
  status: ContentStatus | null
  request: LlmContentRef
  response: LlmContentRef
}

export type LlmContentFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; payload: unknown }
  | { status: 'forbidden' }
  | { status: 'expired' }
  | { status: 'unavailable' }
  | { status: 'error' }

export type LlmMessagePart = { kind: 'text'; text: string } | { kind: 'data'; value: unknown }

export type LlmMessageView = { role: string; parts: LlmMessagePart[] }

export type LlmToolView = { name: string; description: string | null; inputSchema: unknown }

export type LlmRequestView = {
  reconstructed: boolean
  truncated: boolean
  system: string | null
  messages: LlmMessageView[]
  tools: LlmToolView[]
  responseFormat: unknown
  params: Record<string, unknown>
}

export type LlmResponseView = {
  truncated: boolean
  finishReason: string | null
  parts: LlmMessagePart[]
  object: unknown
  hasObject: boolean
  usage: Array<{ name: string; value: string }>
}

export type LlmParameterView = { name: string; value: string | null }

const REQUEST_PARAMETER_NAMES = [
  'temperature',
  'topP',
  'topK',
  'maxOutputTokens',
  'seed',
  'stopSequences',
  'presencePenalty',
  'frequencyPenalty',
] as const

const UNKNOWN_ROLE = '—'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

export function readLlmStepContentRefs(metadata: LlmSpanMetadata): LlmStepContentRefs {
  return {
    status: metadata.contentStatus ?? null,
    request: {
      key: metadata.contentRequestKey ?? null,
      sha256: metadata.contentRequestSha256 ?? null,
      bytes: metadata.contentRequestBytes ?? null,
    },
    response: {
      key: metadata.contentResponseKey ?? null,
      sha256: metadata.contentResponseSha256 ?? null,
      bytes: metadata.contentResponseBytes ?? null,
    },
  }
}

export function contentRefForKind(refs: LlmStepContentRefs, kind: LlmContentKind): LlmContentRef {
  return kind === 'llm_request' ? refs.request : refs.response
}

export function buildArtifactUrl(runId: string, kind: LlmContentKind, key: string): string {
  return `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/artifact?kind=${kind}&key=${encodeURIComponent(key)}`
}

export function classifyArtifactResponse(ok: boolean, status: number, payload: unknown): LlmContentFetchState {
  if (ok) return { status: 'ok', payload }
  if (status === 403) return { status: 'forbidden' }
  if (status === 410) return { status: 'expired' }
  if (status === 502) return { status: 'unavailable' }
  return { status: 'error' }
}

function toPart(value: unknown): LlmMessagePart {
  if (typeof value === 'string') return { kind: 'text', text: value }
  if (isRecord(value)) {
    const type = readString(value, 'type')
    const text = readString(value, 'text')
    if ((type === 'text' || type === 'reasoning') && text !== null) return { kind: 'text', text }
  }
  return { kind: 'data', value }
}

export function toParts(content: unknown): LlmMessagePart[] {
  if (content === undefined || content === null) return []
  if (Array.isArray(content)) return content.map(toPart)
  return [toPart(content)]
}

function toMessage(entry: unknown): LlmMessageView {
  if (!isRecord(entry)) return { role: UNKNOWN_ROLE, parts: toParts(entry) }
  return { role: readString(entry, 'role') ?? UNKNOWN_ROLE, parts: toParts(entry.content) }
}

function toTool(entry: unknown): LlmToolView {
  if (!isRecord(entry)) return { name: '', description: null, inputSchema: null }
  return {
    name: readString(entry, 'name') ?? '',
    description: readString(entry, 'description'),
    inputSchema: entry.inputSchema ?? null,
  }
}

function isTruncated(payload: Record<string, unknown>): boolean {
  return payload._truncated === true
}

export function parseLlmRequestPayload(payload: unknown): LlmRequestView {
  const record = isRecord(payload) ? payload : {}
  return {
    reconstructed: record.reconstructed === true,
    truncated: isTruncated(record),
    system: readString(record, 'system'),
    messages: Array.isArray(record.messages) ? record.messages.map(toMessage) : [],
    tools: Array.isArray(record.tools) ? record.tools.map(toTool) : [],
    responseFormat: record.responseFormat ?? null,
    params: isRecord(record.params) ? record.params : {},
  }
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function parseLlmResponsePayload(payload: unknown): LlmResponseView {
  const record = isRecord(payload) ? payload : {}
  const usage = isRecord(record.usage)
    ? Object.entries(record.usage)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([name, value]) => ({ name, value: formatScalar(value) }))
    : []
  return {
    truncated: isTruncated(record),
    finishReason: readString(record, 'finishReason'),
    parts: toParts(record.content),
    object: record.object ?? null,
    hasObject: Object.prototype.hasOwnProperty.call(record, 'object'),
    usage,
  }
}

export function listRequestParameters(params: Record<string, unknown>): LlmParameterView[] {
  const rows: LlmParameterView[] = REQUEST_PARAMETER_NAMES.map((name) => {
    const value = params[name]
    return { name, value: value === undefined || value === null ? null : formatScalar(value) }
  })
  if (params.providerOptions !== undefined && params.providerOptions !== null) {
    rows.push({ name: 'providerOptions', value: formatScalar(params.providerOptions) })
  }
  return rows
}

export function contentMetadataSnapshot(refs: LlmStepContentRefs, kind: LlmContentKind): Record<string, unknown> {
  const ref = contentRefForKind(refs, kind)
  return { kind, contentStatus: refs.status, key: ref.key, sha256: ref.sha256, bytes: ref.bytes }
}
