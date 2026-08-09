import type { LogRecord } from '../types'
import { redactPii } from './redact'

/**
 * Serialize an error for telemetry: name, message, and stack only.
 *
 * Deliberately does NOT include arbitrary error properties (request bodies,
 * `cause` payloads, query parameters) — those can carry PII. The cause CHAIN is
 * folded into the message text (names/messages only), never its data. Message +
 * stack are run through `redactPii` so a leaked email never reaches the backend
 * (active-redaction backstop over the don't-emit posture).
 */
export function serializeError(error: unknown): NonNullable<LogRecord['error']> {
  if (error instanceof Error) {
    return {
      name: redactPii(error.name || 'Error'),
      message: redactPii(foldCause(error)),
      stack: error.stack ? redactPii(error.stack) : undefined,
    }
  }
  return { name: 'NonError', message: redactPii(safeString(error)) }
}

function foldCause(error: Error, seen = new WeakSet<object>()): string {
  if (seen.has(error)) return error.message
  seen.add(error)
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error) {
    return `${error.message} — caused by ${cause.name || 'Error'}: ${foldCause(cause, seen)}`
  }
  return error.message
}

function safeString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (typeof value === 'symbol') return value.description ? `Symbol(${value.description})` : 'Symbol'
  if (typeof value === 'function') return '[function]'
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  // Never stringify arbitrary objects: request bodies, provider errors, and
  // thrown payloads commonly contain credentials or personal data.
  return '[non-error object]'
}
