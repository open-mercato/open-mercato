import type { EntityManager } from '@mikro-orm/postgresql'
import { CheckoutSessionEvent } from '../data/entities'

/**
 * C14 (§4.2, §13): `CheckoutSessionEvent.payload` is redacted AT WRITE TIME — "never card
 * data, addresses, e-mail, phone or gateway secrets". Allowlist-shaped on purpose (never a
 * blocklist): only primitives, and only keys whose name does not match a known PII
 * pattern, survive. Anything else (nested objects, PII-named keys, functions) is dropped
 * rather than guessed at — the §4.2 kinds this module emits only ever need ids, codes,
 * amounts and statuses, so an allowlist costs nothing and a future caller that genuinely
 * needs a new scalar field just has to not name it like a PII field.
 */
const PII_KEY_PATTERN = /email|phone|address|firstname|lastname|name|card|cvv|secret|token|password|ip\b|user_agent|useragent/i

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value
      .map((entry) => redactValue(entry))
      .filter((entry) => entry !== undefined)
  }
  if (typeof value === 'object') return redactSessionEventPayload(value as Record<string, unknown>)
  // Functions, symbols, etc. — never persisted.
  return undefined
}

/**
 * Strips any key whose NAME matches a known PII pattern, then recursively redacts the
 * remaining values. Returns a plain object safe to persist as `CheckoutSessionEvent.payload`.
 */
export function redactSessionEventPayload(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!input) return null
  const result: Record<string, unknown> = {}
  for (const [key, rawValue] of Object.entries(input)) {
    if (PII_KEY_PATTERN.test(key)) continue
    const value = redactValue(rawValue)
    if (value === undefined) continue
    result[key] = value
  }
  return result
}

export type SessionEventKind =
  | 'step_entered'
  | 'field_updated'
  | 'rate_quoted'
  | 'promotions_evaluated'
  | 'cart_locked'
  | 'stock_reserved'
  | 'credit_reserved'
  | 'document_created'
  | 'stock_committed'
  // Release 5, Step 5.1 (§7.2/§8.6, C16): the quote outcome's own successful stock
  // release — distinct from `compensation`'s "something failed, release what was taken"
  // and from `stock_committed`'s "stock was taken permanently".
  | 'stock_released'
  | 'promotions_registered'
  | 'payment_initiated'
  | 'payment_result'
  // Release 5, Step 5.1 (§8.6, D-R5-20): the quote outcome's own terminal event — distinct
  // from `payment_result`, which implies a payment attempt that never happens for a quote.
  | 'quote_completed'
  | 'approval_state'
  | 'recovery'
  | 'compensation'
  | 'failure'
  | 'session_created'
  | 'session_canceled'

export type SessionEventActor = 'buyer' | 'system' | 'merchant' | 'agent'

/**
 * Appends one `CheckoutSessionEvent` row. Append-only (§4.2, C20 exempt) — never updated,
 * never deleted. `payload` is redacted here, at the single write seam, so no caller can
 * accidentally persist PII by forgetting to redact its own input.
 */
export async function writeSessionEvent(
  em: EntityManager,
  input: {
    tenantId: string
    organizationId: string
    sessionId: string
    kind: SessionEventKind
    actor: SessionEventActor
    payload?: Record<string, unknown> | null
  },
): Promise<void> {
  const event = em.create(CheckoutSessionEvent, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    kind: input.kind,
    actor: input.actor,
    payload: redactSessionEventPayload(input.payload ?? null),
  })
  em.persist(event)
  await em.flush()
}
