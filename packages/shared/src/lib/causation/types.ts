export const CAUSE_KINDS = [
  'user',
  'api_key',
  'agent',
  'workflow',
  'business_rule',
  'ai_action',
  'ai_tool',
  'sync_run',
  'schedule',
  'subscriber',
  'undo',
  'redo',
  'system',
  'unknown',
] as const

export type CauseKind = (typeof CAUSE_KINDS)[number]

export type CausationMetaValue = string | number | boolean | null

export type CausationFrame = {
  kind: CauseKind
  id?: string | null
  ref?: string | null
  meta?: Record<string, CausationMetaValue>
}

export type CausationEnvelope = {
  correlationId: string
  frames: CausationFrame[]
  causedByLogId?: string | null
  truncated?: boolean
}

export type PrimaryCause = {
  kind: CauseKind
  id: string | null
}

export type ActionLogCausationProjection = {
  causeKind: CauseKind
  causeId: string | null
  correlationId: string | null
  causedByLogId: string | null
  envelope: CausationEnvelope
}

export const CAUSATION_MAX_FRAMES = 8
export const CAUSATION_MAX_BYTES = 2048
export const CAUSATION_MAX_TEXT_LENGTH = 200
export const CAUSATION_MAX_META_KEYS = 8
export const CAUSATION_MAX_META_KEY_LENGTH = 40
export const CAUSATION_CONTEXT_KEY = 'causation'

const CAUSE_KIND_SET: ReadonlySet<string> = new Set<string>(CAUSE_KINDS)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isCauseKind(value: unknown): value is CauseKind {
  return typeof value === 'string' && CAUSE_KIND_SET.has(value)
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/g
const RAW_FRAME_SCAN_LIMIT = 16

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(CONTROL_CHARACTER_PATTERN, '').trim()
  if (!trimmed) return null
  return trimmed.length > CAUSATION_MAX_TEXT_LENGTH ? trimmed.slice(0, CAUSATION_MAX_TEXT_LENGTH) : trimmed
}

function sanitizeMeta(value: unknown): Record<string, CausationMetaValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result: Record<string, CausationMetaValue> = {}
  let count = 0
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (count >= CAUSATION_MAX_META_KEYS) break
    const key = rawKey.trim()
    if (!key || key.length > CAUSATION_MAX_META_KEY_LENGTH) continue
    if (rawValue === null || typeof rawValue === 'boolean') {
      result[key] = rawValue
    } else if (typeof rawValue === 'number') {
      if (!Number.isFinite(rawValue)) continue
      result[key] = rawValue
    } else if (typeof rawValue === 'string') {
      const text = sanitizeText(rawValue)
      if (text === null) continue
      result[key] = text
    } else {
      continue
    }
    count += 1
  }
  return count > 0 ? result : undefined
}

export function sanitizeCausationFrame(value: unknown): CausationFrame | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!isCauseKind(record.kind)) return null
  const frame: CausationFrame = { kind: record.kind }
  const id = sanitizeText(record.id)
  if (id !== null) frame.id = id
  const ref = sanitizeText(record.ref)
  if (ref !== null) frame.ref = ref
  const meta = sanitizeMeta(record.meta)
  if (meta) frame.meta = meta
  return frame
}

const textEncoder = new TextEncoder()

function envelopeByteLength(envelope: CausationEnvelope): number {
  return textEncoder.encode(JSON.stringify(envelope)).length
}

function boundRawFrames(rawFrames: unknown[]): unknown[] {
  if (rawFrames.length <= RAW_FRAME_SCAN_LIMIT) return rawFrames
  return [rawFrames[0], ...rawFrames.slice(rawFrames.length - (RAW_FRAME_SCAN_LIMIT - 1))]
}

function capFrames(frames: CausationFrame[]): { frames: CausationFrame[]; truncated: boolean } {
  if (frames.length <= CAUSATION_MAX_FRAMES) return { frames, truncated: false }
  const entry = frames[0]
  const innermost = frames.slice(frames.length - (CAUSATION_MAX_FRAMES - 1))
  return { frames: [entry, ...innermost], truncated: true }
}

export function sanitizeCausation(value: unknown): CausationEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const correlationId = sanitizeText(record.correlationId)
  if (!correlationId) return null
  const rawFrames = boundRawFrames(Array.isArray(record.frames) ? record.frames : [])
  if (rawFrames.length === 0) return null
  const sanitizedFrames = rawFrames.map((frame) => sanitizeCausationFrame(frame))
  if (sanitizedFrames[sanitizedFrames.length - 1] === null) return null
  const validFrames = sanitizedFrames.filter((frame): frame is CausationFrame => frame !== null)
  const capped = capFrames(validFrames)
  const envelope: CausationEnvelope = { correlationId, frames: capped.frames }
  if (isUuid(record.causedByLogId)) envelope.causedByLogId = record.causedByLogId
  let truncated =
    capped.truncated ||
    record.truncated === true ||
    validFrames.length !== sanitizedFrames.length ||
    rawFrames.length !== (Array.isArray(record.frames) ? record.frames.length : 0)
  while (envelope.frames.length > 2 && envelopeByteLength(envelope) > CAUSATION_MAX_BYTES) {
    const [entry, , ...rest] = envelope.frames
    envelope.frames = [entry, ...rest]
    truncated = true
  }
  if (envelopeByteLength(envelope) > CAUSATION_MAX_BYTES) {
    const innermost = envelope.frames[envelope.frames.length - 1]
    envelope.frames = [{ kind: innermost.kind, ...(innermost.id ? { id: innermost.id } : {}) }]
    truncated = true
  }
  if (truncated) envelope.truncated = true
  return envelope
}

export function primaryCause(envelope: CausationEnvelope | null | undefined): PrimaryCause {
  const frames = envelope?.frames ?? []
  const innermost = frames.length > 0 ? frames[frames.length - 1] : null
  if (!innermost) return { kind: 'unknown', id: null }
  return { kind: innermost.kind, id: innermost.id ?? null }
}

export function toIdentifierOnlyCausation(value: unknown): CausationEnvelope | null {
  const sanitized = sanitizeCausation(value)
  if (!sanitized) return null
  const frames = sanitized.frames.map((frame) => {
    const reduced: CausationFrame = { kind: frame.kind }
    if (frame.id) reduced.id = frame.id
    if (isUuid(frame.ref)) reduced.ref = frame.ref
    return reduced
  })
  const reduced: CausationEnvelope = { correlationId: sanitized.correlationId, frames }
  if (sanitized.causedByLogId) reduced.causedByLogId = sanitized.causedByLogId
  if (sanitized.truncated) reduced.truncated = true
  return reduced
}

export function projectCausation(envelope: CausationEnvelope | null | undefined): ActionLogCausationProjection | null {
  const sanitized = sanitizeCausation(envelope)
  if (!sanitized) return null
  const primary = primaryCause(sanitized)
  return {
    causeKind: primary.kind,
    causeId: primary.id,
    correlationId: isUuid(sanitized.correlationId) ? sanitized.correlationId : null,
    causedByLogId: sanitized.causedByLogId ?? null,
    envelope: sanitized,
  }
}
