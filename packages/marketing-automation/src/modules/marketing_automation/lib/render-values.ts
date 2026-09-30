import type { EntityManager } from '@mikro-orm/postgresql'
import type { AutomationContext } from './engine/types.js'
import type { SubjectScope } from './scope.js'
import { loadOrderAggregates } from './subject-document.js'
import { loadScorePoints } from './scores.js'
import { loadLatestNps } from './survey.js'
import { loadTierThresholds } from './tiers.js'
import { resolveTier } from './engine/tiers.js'
import type { AwilixContainer } from 'awilix'

/**
 * The values a message's copy is actually rendered against.
 *
 * `COPY_PLACEHOLDERS` advertises eight paths to an author, the editor shows them, and the AI drafter writes
 * them. Six of them could never resolve on a real send: the persisted run context deliberately carries no
 * customer record — `primary_email` and `display_name` are encrypted at rest and copying them into jsonb
 * would mirror PII the rest of the platform protects — and nothing put them back before interpolation. The
 * preview endpoint spread them in and reported `personalised: true`, so the screen showed "Welcome, Ada"
 * while the send produced the subject `Welcome, {{customer.displayName}}`. The module's own shipped Welcome
 * and Birthday templates did exactly that.
 *
 * Resolved at SEND time and never persisted, which keeps the reason the context omits them intact, and has a
 * second effect worth stating: a customer who changes their name or address mid-journey gets the later steps
 * rendered with the new one.
 *
 * Loaded by what the copy ASKS for. Most messages reference the name and nothing else, and the name comes
 * free with the address lookup a send already does — so the common case costs no extra query at all.
 */
export type RenderRoot = 'customer' | 'score' | 'orders' | 'survey'

const ROOTS: RenderRoot[] = ['customer', 'score', 'orders', 'survey']

/** Which roots a set of copy strings mentions. A root nobody wrote about is never fetched. */
export function neededRenderRoots(strings: Array<string | null | undefined>): Set<RenderRoot> {
  const needed = new Set<RenderRoot>()
  for (const text of strings) {
    if (!text) continue
    for (const root of ROOTS) {
      // `{{ customer.displayName }}` — the placeholder syntax tolerates spaces, so the test does too.
      if (new RegExp(`\\{\\{\\s*${root}\\.`).test(text)) needed.add(root)
    }
  }
  return needed
}

export type RenderValues = Partial<Record<RenderRoot, unknown>>

/**
 * @param customer Already loaded by the caller for the recipient address, so the name costs nothing.
 */
export async function loadRenderValues(
  em: EntityManager,
  container: AwilixContainer,
  ctx: AutomationContext,
  scope: SubjectScope,
  needed: Set<RenderRoot>,
  customer: { id: string; displayName?: string | null; primaryEmail?: string | null } | null,
  now: Date,
): Promise<RenderValues> {
  const values: RenderValues = {}
  if (!ctx.subjectEntityId) return values

  if (needed.has('customer') && customer) {
    values.customer = { displayName: customer.displayName ?? null, email: customer.primaryEmail ?? null }
  }

  const [orders, points, tierThresholds, nps] = await Promise.all([
    needed.has('orders') ? loadOrderAggregates(em, ctx.subjectEntityId, scope, now) : null,
    needed.has('score') ? loadScorePoints(em, ctx.subjectEntityId, scope) : null,
    needed.has('score') ? loadTierThresholds(container, scope) : null,
    needed.has('survey') ? loadLatestNps(em, ctx.subjectEntityId, scope) : null,
  ])

  if (orders) {
    values.orders = {
      count: orders.count,
      totalGross: orders.totalGross,
      // Absent rather than null for a never-buyer, exactly as the subject document has it: a placeholder
      // that renders "0 days since your last order" to somebody who has never ordered is worse than one
      // that renders nothing.
      ...(orders.daysSinceLast === undefined ? {} : { daysSinceLast: orders.daysSinceLast }),
    }
  }
  if (points !== null && tierThresholds) {
    values.score = { points, tier: resolveTier(points, tierThresholds).key }
  }
  if (nps) values.survey = { nps: nps.score, answeredAt: nps.answeredAt }

  return values
}
