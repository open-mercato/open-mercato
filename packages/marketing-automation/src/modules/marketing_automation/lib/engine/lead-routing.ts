/**
 * Which sales rep a new lead goes to.
 *
 * Pure, and the rule is **least loaded wins** rather than round robin. A stored cursor is the obvious
 * implementation and the worse one: it needs a table, it has to be reset when somebody joins or leaves the
 * pool, and after a rep is away for a fortnight it keeps handing them the same share as everybody else.
 * Counting current work is stateless, self-correcting, and answers the question an operator actually has —
 * who has capacity.
 *
 * Ties break on the user id, ascending. That is arbitrary but DETERMINISTIC, which is what makes the
 * assignment testable and a re-run idempotent.
 */

export type RoutingDecision =
  | { assign: true; userId: string }
  | { assign: false; reason: 'empty_pool' | 'already_owned' }

export type RoutingInput = {
  /** The rep pool, as configured for the tenant. */
  pool: string[]
  /** How many live leads each rep currently owns. A rep missing from the map owns none. */
  load: Record<string, number>
  /** The current owner, when the lead already has one. */
  currentOwnerUserId?: string | null
  /** Reassign a lead that already has an owner. Off by default — see below. */
  reassign?: boolean
}

/**
 * Picks the rep, or explains why nobody was picked.
 *
 * **An already-owned lead is left alone unless asked otherwise.** Taking a customer away from the rep who has
 * been talking to them is the single most damaging thing a routing rule can do, and it is exactly what a
 * campaign re-entry or a redelivered job would cause if the default were to reassign.
 */
export function chooseAssignee(input: RoutingInput): RoutingDecision {
  if (input.currentOwnerUserId && !input.reassign) return { assign: false, reason: 'already_owned' }

  const pool = [...new Set(input.pool.filter((userId) => userId.trim().length > 0))].sort()
  if (pool.length === 0) return { assign: false, reason: 'empty_pool' }

  let best = pool[0]
  let bestLoad = input.load[best] ?? 0
  for (const userId of pool.slice(1)) {
    const load = input.load[userId] ?? 0
    // Strictly less: equal load keeps the earlier id, which is what makes the tie-break deterministic.
    if (load < bestLoad) {
      best = userId
      bestLoad = load
    }
  }
  return { assign: true, userId: best }
}

/** A rep's week, as the digest reports it. */
export type RepDigest = {
  userId: string
  newLeads: Array<{ id: string; displayName: string }>
  totalOwned: number
}

/**
 * Whether this rep's digest is worth sending.
 *
 * A digest saying "you got no new leads" is a notification that teaches people to ignore notifications. The
 * total is included for context but never a reason to send on its own.
 */
export function digestIsWorthSending(digest: RepDigest): boolean {
  return digest.newLeads.length > 0
}
