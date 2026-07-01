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
      name: error.name || 'Error',
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
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
