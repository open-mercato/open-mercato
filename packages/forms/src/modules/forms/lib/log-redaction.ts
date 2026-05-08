/**
 * Forms-module log redaction helpers — R1 mitigation.
 *
 * Request bodies for `/api/form-submissions/*` MAY contain sensitive PHI/PII
 * fields (medical history, identifiers, free-text notes). The forms module
 * disables request-body logging on these routes by default; if any operator
 * still needs to capture diagnostic payloads, they MUST run them through
 * `redactSensitive` (in `services/encryption-service.ts`) first.
 *
 * This module exposes a thin `wrapLogger(originalLogger, compiled)` helper:
 * given a structured logger interface and a `CompiledFormVersion`, return a
 * proxy logger that scrubs sensitive field values from object payloads
 * before delegating. Loggers that vary by project should adapt this to
 * their own contract.
 *
 * Tampering-marker logs are the second concern this file documents — they
 * are emitted by `SubmissionService.save` when patches contain fields outside
 * the actor's editable set. The marker carries `(submission_id, user_id,
 * role, dropped_field_keys)` ONLY — never the offending values.
 */

import { redactSensitive } from '../services/encryption-service'
import type { CompiledFormVersion } from '../services/form-version-compiler'

export type StructuredLogger = {
  info(payload: Record<string, unknown>, message?: string): void
  warn(payload: Record<string, unknown>, message?: string): void
  error(payload: Record<string, unknown>, message?: string): void
}

const SENSITIVE_BODY_KEYS = ['patch', 'data', 'decoded_data', 'decodedData', 'payload', 'body'] as const

/**
 * Wraps a structured logger so that any payload key likely to contain a
 * form payload (`patch`, `data`, `payload`, `body`, `decoded_data`) is
 * passed through `redactSensitive` against the supplied compiled form
 * version before emission.
 *
 * The wrapper is conservative: it never throws; if it cannot interpret the
 * payload it falls back to the raw logger call. Production loggers should
 * additionally be configured to skip request-body logging entirely on the
 * forms namespace.
 */
export function wrapLogger(
  inner: StructuredLogger,
  compiled: CompiledFormVersion,
): StructuredLogger {
  const scrub = (payload: Record<string, unknown>): Record<string, unknown> => {
    if (!payload || typeof payload !== 'object') return payload
    const out: Record<string, unknown> = { ...payload }
    for (const key of SENSITIVE_BODY_KEYS) {
      const value = out[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        try {
          out[key] = redactSensitive(compiled, value as Record<string, unknown>)
        } catch {
          out[key] = '[REDACTION_FAILED]'
        }
      }
    }
    return out
  }
  return {
    info: (payload, message) => inner.info(scrub(payload), message),
    warn: (payload, message) => inner.warn(scrub(payload), message),
    error: (payload, message) => inner.error(scrub(payload), message),
  }
}

/**
 * Build a tampering-marker log entry. Used by `SubmissionService.save` when
 * a patch contained fields outside the active actor role's editable set.
 *
 * Keep payload minimal — submission_id, user_id, role, and the list of
 * dropped field keys. Never include offending values, never include
 * a stack trace.
 */
export function buildTamperingMarker(args: {
  submissionId: string
  userId: string
  role: string
  droppedFieldKeys: string[]
}): Record<string, unknown> {
  return {
    event: 'forms.security.tampering_marker',
    submissionId: args.submissionId,
    userId: args.userId,
    role: args.role,
    droppedFieldKeys: args.droppedFieldKeys.slice(0, 50),
  }
}
