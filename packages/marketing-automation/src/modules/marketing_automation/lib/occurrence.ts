import { createHash } from 'node:crypto'

/**
 * Identifies one OCCURRENCE of a platform event, so a redelivery of it cannot start a second run.
 *
 * Queues and webhooks redeliver as a matter of course: a BullMQ job whose worker died mid-handler
 * comes back, a provider retries a callback it never saw acknowledged. Without a key, the second
 * delivery is indistinguishable from a second thing happening, and the customer receives the
 * campaign twice.
 *
 * The key is derived from the payload rather than assigned, because the platform's event bus passes
 * a payload through untouched and carries no per-emission identifier: a redelivery is therefore
 * byte-identical, and hashing it is what makes the two deliveries recognisably the same occurrence.
 *
 * The consequence to keep in view: two genuinely separate occurrences with identical payloads — a
 * tag removed and re-added, say — hash the same. That is why the key is enforced only within
 * `OCCURRENCE_DEDUP_WINDOW_HOURS` and then erased, instead of forever. Permanent uniqueness would
 * quietly convert every `unlimited` re-entry policy into `once`.
 */

/**
 * How long a key stays enforced.
 *
 * Long enough to cover any redelivery a queue or a provider will attempt — those are minutes — and
 * short enough to sit well inside the day-scale windows a re-entry policy is expressed in, so a
 * deliberate repeat is never mistaken for a duplicate.
 */
export const OCCURRENCE_DEDUP_WINDOW_HOURS = 6

/**
 * JSON with object keys in a fixed order.
 *
 * `JSON.stringify` preserves insertion order, so the same payload assembled in a different order
 * would hash differently and the duplicate would slip through. Arrays keep their order, which is
 * part of the value rather than an accident of construction.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const canonical: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      // An absent key and a key set to undefined are the same fact, and `JSON.stringify` already
      // drops the latter — dropping it here too keeps the two from hashing differently.
      if (source[key] === undefined) continue
      canonical[key] = canonicalize(source[key])
    }
    return canonical
  }
  return value
}

/**
 * The occurrence key for an event delivery.
 *
 * Scoped by tenant and organization as well as event id, so identical payloads in two
 * organizations are never confused for one another.
 */
export function occurrenceKeyFor(
  eventId: string,
  scope: { tenantId: string; organizationId: string },
  payload: Record<string, unknown>,
): string {
  const canonical = JSON.stringify(canonicalize({
    eventId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    payload,
  }))
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * A DURABLE claim, for a sweep that must act on something exactly once ever.
 *
 * Shares the run table's occurrence index — so the database enforces it, not a check — but carries a
 * prefix, because the two kinds of key have opposite lifetimes. An event key is released after
 * `OCCURRENCE_DEDUP_WINDOW_HOURS` so a repeat of the same fact can legitimately re-enter; a claim on
 * "we asked this customer to review order X" must never be released, or the request is sent again.
 */
export const SWEEP_CLAIM_PREFIX = 'claim:'

export function sweepClaimKey(parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex')
  return `${SWEEP_CLAIM_PREFIX}${digest}`
}

export function isSweepClaimKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith(SWEEP_CLAIM_PREFIX)
}
