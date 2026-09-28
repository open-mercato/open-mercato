import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubjectScope } from '../subject-document.js'

/**
 * A/B results, read from what actually happened.
 *
 * Every figure comes from the lane RECORDED on the run rather than recomputed from the definition: the
 * choice is deterministic, so recomputing would agree — until somebody edits the split, at which point
 * historical runs would be re-attributed to lanes they never walked and the comparison would become
 * fiction.
 *
 * Opens and clicks are counted as UNIQUE RUNS, not raw events. A mail client re-fetching the pixel is
 * not a second person reading the message, and a winner picked on raw opens would reward whichever
 * variant happened to reach more aggressive inbox previewers.
 */

export type SplitVariantResult = {
  stepId: string
  variant: string
  runs: number
  sends: number
  opened: number
  clicked: number
  /** Clicks per send, or null with no sends — a rate over zero is not a zero rate. */
  clickRate: number | null
  openRate: number | null
}

const SPLIT_RESULTS_SQL = `
  with lanes as (
    select r.id as run_id, choice.key as step_id, choice.value as variant
      from marketing_campaign_runs r
      cross join lateral jsonb_each_text(r.variant_choices) as choice(key, value)
     where r.campaign_id = ?
       and r.tenant_id = ?
       and r.organization_id = ?
       and r.variant_choices is not null
  ),
  sends as (
    select run_id, count(*)::int as sent
      from marketing_message_sends
     where campaign_id = ? and tenant_id = ? and organization_id = ? and status = 'sent'
     group by run_id
  ),
  engagement as (
    select run_id,
           max(case when type = 'opened' then 1 else 0 end)::int as opened,
           max(case when type = 'clicked' then 1 else 0 end)::int as clicked
      from marketing_message_send_events
     where campaign_id = ? and tenant_id = ? and organization_id = ?
     group by run_id
  )
  select lanes.step_id,
         lanes.variant,
         count(*)::int as runs,
         coalesce(sum(sends.sent), 0)::int as sends,
         coalesce(sum(engagement.opened), 0)::int as opened,
         coalesce(sum(engagement.clicked), 0)::int as clicked
    from lanes
    left join sends on sends.run_id = lanes.run_id
    left join engagement on engagement.run_id = lanes.run_id
   group by lanes.step_id, lanes.variant
   order by lanes.step_id asc, lanes.variant asc
`

type ResultRow = {
  step_id: string
  variant: string
  runs: number
  sends: number
  opened: number
  clicked: number
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return numerator / denominator
}

export async function loadSplitResults(
  em: EntityManager,
  campaignId: string,
  scope: SubjectScope,
): Promise<SplitVariantResult[]> {
  const rows = await em.getConnection().execute<ResultRow[]>(SPLIT_RESULTS_SQL, [
    campaignId, scope.tenantId, scope.organizationId,
    campaignId, scope.tenantId, scope.organizationId,
    campaignId, scope.tenantId, scope.organizationId,
  ])
  return rows.map((row) => ({
    stepId: row.step_id,
    variant: row.variant,
    runs: row.runs,
    sends: row.sends,
    opened: row.opened,
    clicked: row.clicked,
    clickRate: rate(row.clicked, row.sends),
    openRate: rate(row.opened, row.sends),
  }))
}

export type SplitWinner = {
  stepId: string
  variant: string
  clickRate: number
  /** The runner-up's rate, so a caller can see how close the call was. */
  runnerUpClickRate: number | null
  sends: number
}

/**
 * Picks a winner for one split, or returns null.
 *
 * Refuses to answer until EVERY lane has reached the minimum sample. Declaring a winner on a lane
 * nobody has received yet is the classic way to pick the variant that happened to go out first, and an
 * automation that does it confidently is worse than one that says "not yet".
 *
 * Ties return null as well: with equal rates there is nothing to learn, and replacing the split would
 * throw away the ability to keep measuring.
 */
export function pickSplitWinner(
  results: SplitVariantResult[],
  stepId: string,
  minimumSends: number,
): SplitWinner | null {
  const lanes = results.filter((result) => result.stepId === stepId)
  if (lanes.length < 2) return null
  if (lanes.some((lane) => lane.sends < minimumSends)) return null

  const ranked = [...lanes].sort((left, right) => (right.clickRate ?? 0) - (left.clickRate ?? 0))
  const best = ranked[0]
  const runnerUp = ranked[1]
  if (best.clickRate === null) return null
  if (runnerUp && (runnerUp.clickRate ?? 0) === best.clickRate) return null

  return {
    stepId,
    variant: best.variant,
    clickRate: best.clickRate,
    runnerUpClickRate: runnerUp?.clickRate ?? null,
    sends: best.sends,
  }
}
