import type { EntityManager } from '@mikro-orm/postgresql'
import { usableTimeZone } from '../engine/gates.js'
import type { SubjectScope } from '../subject-document.js'

/**
 * The hour a customer usually opens email, learned from their own opens.
 *
 * The data exists because Phase 3 records opens; this only reads it. Deliberately the customer's OWN
 * history rather than a cohort average: "9am is best" is a statement about a population, and the whole
 * point of per-customer timing is that the night-shift worker is not the population.
 */

export type HourlyOpens = { hour: number; opens: number }

/**
 * Below this many opens there is no pattern, only noise.
 *
 * Two opens at 3am would otherwise schedule every future send for 3am — the kind of confident
 * optimisation that is worse than none.
 */
export const MINIMUM_OPENS_FOR_PATTERN = 5

/**
 * The modal hour, or null.
 *
 * Ties resolve to the EARLIER hour: with equal evidence the earlier slot reaches the customer sooner,
 * and an arbitrary but deterministic rule beats one that depends on row order.
 *
 * The minimum applies to the CHOSEN hour, not to the total across all of them. Summing the total was the
 * mistake: five opens spread over five different hours passed a gate written to reject exactly that, and the
 * winner was then an hour with a single open — the confidently wrong 3am this constant exists to prevent.
 */
export function pickPreferredHour(
  rows: HourlyOpens[],
  minimumOpens: number = MINIMUM_OPENS_FOR_PATTERN,
): number | null {
  let best: HourlyOpens | null = null
  for (const row of rows) {
    if (row.opens <= 0) continue
    if (row.hour < 0 || row.hour > 23) continue
    if (!best || row.opens > best.opens || (row.opens === best.opens && row.hour < best.hour)) {
      best = row
    }
  }
  if (!best || best.opens < minimumOpens) return null
  return best.hour
}

const HOURLY_OPENS_SQL = `
  select extract(hour from (e.occurred_at at time zone ?))::int as hour,
         -- Distinct RUNS, like every other engagement count in this module. Counting raw events let one 3am
         -- message re-fetched five times by a mail client clear the minimum-evidence bar on its own and pin
         -- every future send to 3am — the exact "confidently wrong" answer the minimum exists to prevent.
         count(distinct e.run_id)::int as opens
    from marketing_message_send_events e
    join marketing_campaign_runs r on r.id = e.run_id
   where e.type = 'opened'
     and e.tenant_id = ?
     and e.organization_id = ?
     -- Scope repeated on the run for the planner, as in loadEngagement: the join already constrains it, but
     -- without this the (tenant, org, subject) index on runs cannot be used.
     and r.tenant_id = ?
     and r.organization_id = ?
     and r.subject_entity_id = ?
   group by 1
   order by 1
`

/**
 * Reads the subject's open hours IN THEIR OWN TIMEZONE.
 *
 * Converting in SQL rather than in JavaScript keeps the grouping and the conversion in one place; doing
 * it after the fact would group by server hour and then relabel, which is a different and wrong answer
 * for anybody who is not in the server's timezone.
 */
export async function loadPreferredSendHour(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
  timeZone: string,
  minimumOpens: number = MINIMUM_OPENS_FOR_PATTERN,
): Promise<number | null> {
  const rows = await em.getConnection().execute<Array<{ hour: number; opens: number }>>(
    HOURLY_OPENS_SQL,
    // A name Postgres does not know raises rather than injecting — it is a bound parameter — so one typo in
    // one customer's profile used to fail the step. Same UTC fallback as the quiet-hours code.
    [usableTimeZone(timeZone), scope.tenantId, scope.organizationId, scope.tenantId, scope.organizationId, subjectEntityId],
  )
  return pickPreferredHour(rows.map((row) => ({ hour: row.hour, opens: row.opens })), minimumOpens)
}
