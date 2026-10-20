import {
  createCausationEnvelope,
  getAmbientCausation,
  isCausationEnabled,
  reportCausationDegradation,
  runWithCausation,
  sanitizeCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'

export const CAUSATION_META_KEY = '_causation'
export const MISSING_CAUSATION_REF = 'queue:missing_causation'
export const INVALID_CAUSATION_REF = 'queue:invalid_causation'

type JobMetadata = Record<string, unknown> | undefined

function captureAmbientCausation(): CausationEnvelope | null {
  if (!isCausationEnabled()) return null
  return sanitizeCausation(getAmbientCausation())
}

function withoutCausation(metadata: JobMetadata): JobMetadata {
  if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, CAUSATION_META_KEY)) return metadata
  const rest: Record<string, unknown> = { ...metadata }
  delete rest[CAUSATION_META_KEY]
  return Object.keys(rest).length > 0 ? rest : undefined
}

export function attachCausationMetadata(metadata: JobMetadata): JobMetadata {
  const envelope = captureAmbientCausation()
  if (!envelope) return withoutCausation(metadata)
  return { ...(metadata ?? {}), [CAUSATION_META_KEY]: envelope }
}

export function readJobCausation(metadata: JobMetadata): CausationEnvelope | null {
  return sanitizeCausation(metadata?.[CAUSATION_META_KEY])
}

function resolveJobCausation(queueName: string, metadata: JobMetadata): CausationEnvelope {
  const stored = metadata?.[CAUSATION_META_KEY]
  if (stored === undefined || stored === null) {
    reportCausationDegradation('queue_missing_envelope', { queue: queueName })
    return createCausationEnvelope([{ kind: 'unknown', ref: MISSING_CAUSATION_REF }])
  }
  const envelope = sanitizeCausation(stored)
  if (envelope) return envelope
  reportCausationDegradation('queue_invalid_envelope', { queue: queueName })
  return createCausationEnvelope([{ kind: 'unknown', ref: INVALID_CAUSATION_REF }])
}

export function runJobInCausation<T>(queueName: string, metadata: JobMetadata, fn: () => T): T {
  if (!isCausationEnabled()) return runWithCausation(null, fn)
  return runWithCausation(resolveJobCausation(queueName, metadata), fn)
}
