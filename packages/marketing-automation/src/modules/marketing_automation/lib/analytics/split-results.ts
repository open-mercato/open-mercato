import type { EntityManager } from '@mikro-orm/postgresql'
import type { LaneDescriptor } from '../engine/split.js'
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

/**
 * One lane's figures.
 *
 * Every count is restricted to the lane's OWN steps. An earlier version grouped by run alone, which
 * also counted the campaign's shared trunk messages: two lanes then looked identical wherever the trunk
 * dominated, and the "minimum sample per lane" gate below could be satisfied by a message neither lane
 * had sent.
 */
function laneSql(stepPlaceholders: string): string {
  return `
    with lane_runs as (
      select r.id
        from marketing_campaign_runs r
       where r.campaign_id = ?
         and r.tenant_id = ?
         and r.organization_id = ?
         and r.variant_choices ->> ? = ?
    )
    select (select count(*) from lane_runs)::int as runs,
           (select count(*)
              from marketing_message_sends s
             where s.tenant_id = ?
               and s.organization_id = ?
               and s.status = 'sent'
               and s.run_id in (select id from lane_runs)
               and s.step_id in (${stepPlaceholders}))::int as sends,
           (select count(distinct e.run_id)
              from marketing_message_send_events e
             where e.tenant_id = ?
               and e.organization_id = ?
               and e.type = 'opened'
               and e.run_id in (select id from lane_runs)
               and e.step_id in (${stepPlaceholders}))::int as opened,
           (select count(distinct e.run_id)
              from marketing_message_send_events e
             where e.tenant_id = ?
               and e.organization_id = ?
               and e.type = 'clicked'
               and e.run_id in (select id from lane_runs)
               and e.step_id in (${stepPlaceholders}))::int as clicked
  `
}

type ResultRow = { runs: number; sends: number; opened: number; clicked: number }

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return numerator / denominator
}

/**
 * Reads one row per lane.
 *
 * One query per lane rather than one for all of them: a lane is identified by a jsonb key AND by its
 * own set of step ids, and expressing that as a single grouped statement means either a lateral join per
 * lane anyway or string-building the step sets into the SQL. A campaign has a handful of lanes, so a
 * handful of bounded queries is the cheaper honesty.
 */
export async function loadSplitResults(
  em: EntityManager,
  campaignId: string,
  scope: SubjectScope,
  lanes: LaneDescriptor[],
): Promise<SplitVariantResult[]> {
  const results: SplitVariantResult[] = []

  for (const lane of lanes) {
    // A lane with no steps of its own — a holdout — has nothing to count, and `in ()` is not valid SQL.
    if (lane.stepIds.length === 0) {
      const runsOnly = await em.getConnection().execute<Array<{ runs: number }>>(
        `select count(*)::int as runs
           from marketing_campaign_runs r
          where r.campaign_id = ? and r.tenant_id = ? and r.organization_id = ?
            and r.variant_choices ->> ? = ?`,
        [campaignId, scope.tenantId, scope.organizationId, lane.splitStepId, lane.variant],
      )
      results.push({
        stepId: lane.splitStepId,
        variant: lane.variant,
        runs: runsOnly[0]?.runs ?? 0,
        sends: 0,
        opened: 0,
        clicked: 0,
        clickRate: null,
        openRate: null,
      })
      continue
    }

    // Placeholders, not values: the step ids stay bound parameters.
    const placeholders = lane.stepIds.map(() => '?').join(', ')
    const rows = await em.getConnection().execute<ResultRow[]>(laneSql(placeholders), [
      campaignId, scope.tenantId, scope.organizationId, lane.splitStepId, lane.variant,
      scope.tenantId, scope.organizationId, ...lane.stepIds,
      scope.tenantId, scope.organizationId, ...lane.stepIds,
      scope.tenantId, scope.organizationId, ...lane.stepIds,
    ])
    const row = rows[0]
    results.push({
      stepId: lane.splitStepId,
      variant: lane.variant,
      runs: row?.runs ?? 0,
      sends: row?.sends ?? 0,
      opened: row?.opened ?? 0,
      clicked: row?.clicked ?? 0,
      clickRate: rate(row?.clicked ?? 0, row?.sends ?? 0),
      openRate: rate(row?.opened ?? 0, row?.sends ?? 0),
    })
  }

  return results
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
