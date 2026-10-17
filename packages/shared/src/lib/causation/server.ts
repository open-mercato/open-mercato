import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { parseBooleanWithDefault } from '../boolean'
import { createLogger } from '../logger'
import {
  CAUSATION_CONTEXT_KEY,
  primaryCause,
  sanitizeCausation,
  sanitizeCausationFrame,
  type CausationEnvelope,
  type CausationFrame,
} from './types'

export * from './types'

type CausationStore = { envelope: CausationEnvelope | null }

const CAUSATION_STORAGE_KEY = Symbol.for('@open-mercato/shared/causation-context')

type GlobalWithCausationStorage = typeof globalThis & {
  [CAUSATION_STORAGE_KEY]?: AsyncLocalStorage<CausationStore>
}

function resolveCausationStorage(): AsyncLocalStorage<CausationStore> {
  const scope = globalThis as GlobalWithCausationStorage
  if (!scope[CAUSATION_STORAGE_KEY]) {
    scope[CAUSATION_STORAGE_KEY] = new AsyncLocalStorage<CausationStore>()
  }
  return scope[CAUSATION_STORAGE_KEY]
}

export type CausationAuthLike =
  | {
      sub?: string | null
      isApiKey?: boolean
      keyId?: string | null
      originCausation?: unknown
    }
  | null
  | undefined

export type CausationRunAsLike = { actorUserId: string } | null | undefined

export type ResolveCausationForCommandInput = {
  explicit?: CausationEnvelope | null
  auth?: CausationAuthLike
  runAs?: CausationRunAsLike
  systemActor?: boolean
}

export const CAUSATION_ENV_VAR = 'OM_CAUSATION'

export function isCausationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return parseBooleanWithDefault(env[CAUSATION_ENV_VAR], true)
}

export type CausationDegradationReason =
  | 'queue_missing_envelope'
  | 'queue_invalid_envelope'
  | 'api_key_origin_invalid'
  | 'onetime_key_no_ambient'
  | 'log_fallback_actor'
  | 'workflow_frame_no_instance'
  | 'rule_entity_id_unresolved'

const causationLogger = createLogger('causation')
const EXPECTED_DEGRADATION_REASONS: ReadonlySet<CausationDegradationReason> = new Set<CausationDegradationReason>([
  'queue_missing_envelope',
])
const DEGRADATION_REPORTED_KEY = Symbol.for('@open-mercato/shared/causation-degradation-reported')

type GlobalWithDegradationRegistry = typeof globalThis & {
  [DEGRADATION_REPORTED_KEY]?: Set<CausationDegradationReason>
}

function resolveDegradationRegistry(): Set<CausationDegradationReason> {
  const scope = globalThis as GlobalWithDegradationRegistry
  if (!scope[DEGRADATION_REPORTED_KEY]) scope[DEGRADATION_REPORTED_KEY] = new Set<CausationDegradationReason>()
  return scope[DEGRADATION_REPORTED_KEY]
}

export function reportCausationDegradation(
  reason: CausationDegradationReason,
  bindings: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const reported = resolveDegradationRegistry()
  if (reported.has(reason) || EXPECTED_DEGRADATION_REASONS.has(reason)) {
    causationLogger.debug('Causation degraded', { reason, ...bindings })
    return
  }
  reported.add(reason)
  causationLogger.warn('Causation degraded; affected writes record a weaker cause', { reason, ...bindings })
}

export function resetCausationDegradationReports(): void {
  resolveDegradationRegistry().clear()
}

export function createCorrelationId(): string {
  return randomUUID()
}

export function createCausationEnvelope(
  frames: CausationFrame[],
  options: { correlationId?: string | null; causedByLogId?: string | null } = {},
): CausationEnvelope {
  const correlationId = options.correlationId && options.correlationId.trim() ? options.correlationId : createCorrelationId()
  const sanitized = sanitizeCausation({
    correlationId,
    frames,
    causedByLogId: options.causedByLogId ?? null,
  })
  return sanitized ?? { correlationId, frames: [{ kind: 'unknown' }] }
}

export function appendCausationFrame(envelope: CausationEnvelope, frame: CausationFrame): CausationEnvelope {
  const sanitizedFrame = sanitizeCausationFrame(frame)
  if (!sanitizedFrame) return envelope
  const next = sanitizeCausation({ ...envelope, frames: [...envelope.frames, sanitizedFrame] })
  return next ?? envelope
}

export function getAmbientCausation(): CausationEnvelope | null {
  return resolveCausationStorage().getStore()?.envelope ?? null
}

function runWithSanitizedEnvelope<T>(envelope: CausationEnvelope | null, fn: () => T): T {
  return resolveCausationStorage().run({ envelope }, fn)
}

export function runWithCausation<T>(envelope: CausationEnvelope | null, fn: () => T): T {
  return runWithSanitizedEnvelope(envelope ? sanitizeCausation(envelope) : null, fn)
}

export function withCausationFrame<T>(frame: CausationFrame, fn: () => T): T {
  if (!isCausationEnabled()) return fn()
  const ambient = getAmbientCausation()
  const envelope = ambient ? appendCausationFrame(ambient, frame) : createCausationEnvelope([frame])
  return runWithSanitizedEnvelope(envelope, fn)
}

export function runEntryWithCausation<T>(
  frame: CausationFrame,
  fn: () => T,
  options: { correlationId?: string | null } = {},
): T {
  if (!isCausationEnabled()) return fn()
  return runWithSanitizedEnvelope(createCausationEnvelope([frame], { correlationId: options.correlationId ?? null }), fn)
}

export function runOutsideCausation<T>(fn: () => T): T {
  return resolveCausationStorage().exit(fn)
}

export function deriveCausationFrameFromAuth(auth: CausationAuthLike, options: { systemActor?: boolean } = {}): CausationFrame {
  if (auth?.isApiKey === true) {
    return { kind: 'api_key', id: typeof auth.keyId === 'string' && auth.keyId ? auth.keyId : null }
  }
  if (typeof auth?.sub === 'string' && auth.sub) return { kind: 'user' }
  if (options.systemActor === true) return { kind: 'system' }
  return { kind: 'unknown' }
}

export function buildEntryCausationForAuth(
  auth: CausationAuthLike,
  options: { systemActor?: boolean } = {},
): CausationEnvelope {
  if (auth?.isApiKey === true) {
    const origin = sanitizeCausation(auth.originCausation)
    if (origin) return markLoopbackKey(origin, auth.keyId)
  }
  return createCausationEnvelope([deriveCausationFrameFromAuth(auth, options)])
}

function markLoopbackKey(origin: CausationEnvelope, keyId: string | null | undefined): CausationEnvelope {
  if (typeof keyId !== 'string' || !keyId) return origin
  const frames = origin.frames.slice()
  const innermost = frames[frames.length - 1]
  frames[frames.length - 1] = { ...innermost, meta: { ...(innermost.meta ?? {}), viaKeyId: keyId } }
  return sanitizeCausation({ ...origin, frames }) ?? origin
}

export function runWithRequestCausation<T>(
  auth: CausationAuthLike,
  fn: () => T,
  options: { systemActor?: boolean } = {},
): T {
  if (!isCausationEnabled()) return fn()
  return runWithCausation(buildEntryCausationForAuth(auth, options), fn)
}

function isAnonymousEntryEnvelope(envelope: CausationEnvelope): boolean {
  if (envelope.frames.length !== 1 || envelope.causedByLogId) return false
  const [entry] = envelope.frames
  return entry.kind === 'unknown' && !entry.id && !entry.ref
}

function resolveBaseEnvelope(input: ResolveCausationForCommandInput): CausationEnvelope {
  const explicit = input.explicit ? sanitizeCausation(input.explicit) : null
  if (explicit) return explicit
  const ambient = getAmbientCausation()
  if (ambient && !isAnonymousEntryEnvelope(ambient)) return ambient
  const derived = buildEntryCausationForAuth(input.auth, { systemActor: input.systemActor })
  if (!ambient) return derived
  if (primaryCause(derived).kind === 'unknown') return ambient
  return { ...derived, correlationId: ambient.correlationId }
}

export function resolveCausationForCommand(input: ResolveCausationForCommandInput): CausationEnvelope {
  let envelope = resolveBaseEnvelope(input)
  const runAs = input.runAs
  if (runAs && typeof runAs.actorUserId === 'string' && runAs.actorUserId) {
    const primary = primaryCause(envelope)
    if (primary.kind !== 'agent' || primary.id !== runAs.actorUserId) {
      envelope = appendCausationFrame(envelope, { kind: 'agent', id: runAs.actorUserId })
    }
  }
  return envelope
}

export function stripCausationFromContext<T extends Record<string, unknown>>(context: T | null | undefined): T | null {
  if (!context || typeof context !== 'object') return context ?? null
  if (!Object.prototype.hasOwnProperty.call(context, CAUSATION_CONTEXT_KEY)) return context
  const rest: Record<string, unknown> = { ...context }
  delete rest[CAUSATION_CONTEXT_KEY]
  return rest as T
}
