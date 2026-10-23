import type { AutomationContext } from './engine/types.js'

/**
 * The persistence boundary between the run's facts and the text a partner sent.
 *
 * Above this, there is one `AutomationContext` with `trigger` on it — the executor reads it, interpolation
 * resolves `{{trigger.*}}` from it, and nothing had to change to keep either working. In the database the two
 * halves are separate columns, because they want opposite things: `context` is queried with SQL by the
 * erasure, and `trigger_context` is encrypted at rest because it holds whatever a partner posted.
 *
 * Encrypting `context` whole was the obvious move and does not work: `context ->> 'subjectEntityId'` is how
 * the erasure finds a person's runs, and ciphertext cannot answer it.
 */
export type PersistedRunContext = {
  context: Record<string, unknown>
  triggerContext: Record<string, unknown> | null
}

/** Splits a context for storage. Null rather than `{}` when there is no trigger, so the column stays empty. */
export function splitRunContext(context: AutomationContext): PersistedRunContext {
  const { trigger, ...rest } = context as AutomationContext & { trigger?: unknown }
  const isObject = !!trigger && typeof trigger === 'object' && !Array.isArray(trigger)
  const payload = isObject ? (trigger as Record<string, unknown>) : null
  return {
    context: rest as Record<string, unknown>,
    triggerContext: payload && Object.keys(payload).length > 0 ? payload : null,
  }
}

/**
 * Puts the two halves back together for the engine.
 *
 * `trigger` is always present as an object, even when the column is empty: `interpolate` leaves an
 * unresolved placeholder verbatim, so a missing `trigger` would print `{{trigger.orderId}}` into somebody's
 * email rather than nothing.
 */
export function mergeRunContext(row: {
  context: Record<string, unknown>
  triggerContext?: Record<string, unknown> | null
}): AutomationContext {
  return { ...row.context, trigger: row.triggerContext ?? {} } as unknown as AutomationContext
}
