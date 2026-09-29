import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubjectScope } from '../subject-document.js'
import type { CampaignStep } from '../engine/types.js'
import { SPLIT_STEP_TYPE, readVariants } from '../engine/split.js'

/**
 * Where people fall out INSIDE a journey.
 *
 * The campaign funnel answers entered → sent → opened → clicked → converted, which is the right shape for one
 * message and useless for a six-step sequence: "forty people were sent something" cannot say whether the third
 * email is where they stop. Every run already carries its own `step_log` — one entry per step it executed, with
 * the outcome — so the answer has existed per run since the engine did. Nothing aggregated it.
 *
 * **Ordered by the DEFINITION, never by the counts.** A journey funnel that sorts itself by volume is not a
 * funnel; the point is to read it in the order the customer experiences it.
 *
 * **A lane step's predecessor is the SPLIT, not the step before the split.** Only a share of the people who
 * reached a split enter each lane, so comparing a lane step against the trunk would report the split's weights
 * as a drop-off and make every A/B test look like a catastrophe. For the same reason a step AFTER a split is
 * measured against the split too: which lane a given person walked is path-dependent, and the split is the last
 * point every one of them shared.
 */

export type JourneyStep = {
  stepId: string
  type: string
  /** The lane this step belongs to, or null in the trunk. */
  variantKey: string | null
  /** The step whose reach is this step's denominator. Null for the first step of the journey. */
  previousStepId: string | null
  /** Distinct people whose run recorded this step at all, whatever the outcome. */
  people: number
  /** Of those, the ones where it did its work, was skipped by a gate, or failed. */
  done: number
  skipped: number
  failed: number
  /**
   * Share of the people who reached the previous step, 0–1.
   *
   * Null for the first step, and null wherever the predecessor is empty — a rate over nobody is not a rate of
   * nothing, which is the same rule the campaign funnel follows.
   */
  reachedFromPrevious: number | null
  /** Share of everyone who reached the FIRST step, which is the number an operator quotes. */
  shareOfFirst: number | null
}

/** Deep enough for any authored journey; the save rules bound nesting well below this. */
const MAX_DEPTH = 5

type JourneyPosition = { stepId: string; type: string; variantKey: string | null; previousStepId: string | null }

/**
 * The journey in order, with each step's own predecessor.
 *
 * Pure and exported because this walk — not the counting — is where the decisions are, and they are the kind a
 * later edit silently breaks: descending into lanes at all, and choosing the split as the predecessor on both
 * sides of it.
 */
export function describeJourney(steps: CampaignStep[], variantKey: string | null = null, previousStepId: string | null = null, depth = 0): JourneyPosition[] {
  if (depth > MAX_DEPTH) return []
  const positions: JourneyPosition[] = []
  let previous = previousStepId
  for (const step of steps) {
    positions.push({ stepId: step.id, type: step.type, variantKey, previousStepId: previous })
    if (step.type === SPLIT_STEP_TYPE) {
      for (const variant of readVariants(step)) {
        positions.push(...describeJourney(variant.steps, variant.key, step.id, depth + 1))
      }
      // Everything after the split measures against the split: the lane somebody walked is path-dependent, and
      // the split is the last point all of them shared.
      previous = step.id
      continue
    }
    previous = step.id
  }
  return positions
}

type StepCountRow = { step_id: string; people: number; done: number; skipped: number; failed: number }

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 10_000) / 10_000
}

/**
 * Joins the authored order to the recorded counts.
 *
 * A step with no counts is reported as zero rather than omitted: "nobody has reached step four yet" is the
 * answer somebody is looking for, and a missing row would read as a step that does not exist.
 */
export function buildStepFunnel(positions: JourneyPosition[], counts: Map<string, StepCountRow>): JourneyStep[] {
  const peopleAt = (stepId: string | null): number => (stepId === null ? 0 : counts.get(stepId)?.people ?? 0)
  const first = positions[0]
  const firstPeople = first ? peopleAt(first.stepId) : 0

  return positions.map((position) => {
    const row = counts.get(position.stepId)
    const people = row?.people ?? 0
    return {
      stepId: position.stepId,
      type: position.type,
      variantKey: position.variantKey,
      previousStepId: position.previousStepId,
      people,
      done: row?.done ?? 0,
      skipped: row?.skipped ?? 0,
      failed: row?.failed ?? 0,
      reachedFromPrevious: position.previousStepId === null ? null : ratio(people, peopleAt(position.previousStepId)),
      shareOfFirst: firstPeople > 0 ? ratio(people, firstPeople) : null,
    }
  })
}

/**
 * One statement over the step logs.
 *
 * `jsonb_array_elements` rather than a new table: the log is already written on every transition, and a second
 * per-step table would be a second source of truth for the same fact — with the added failure mode of being
 * written by a different code path than the one that advances the run.
 */
const STEP_COUNTS_SQL = `
  select
      entry->>'stepId' as step_id,
      count(distinct r.id)::int as people,
      count(distinct case when entry->>'status' = 'done' then r.id end)::int as done,
      count(distinct case when entry->>'status' = 'skipped' then r.id end)::int as skipped,
      count(distinct case when entry->>'status' = 'failed' then r.id end)::int as failed
    from marketing_campaign_runs r
    cross join lateral jsonb_array_elements(r.step_log) as entry
   where r.campaign_id = ? and r.tenant_id = ? and r.organization_id = ?
     and entry->>'stepId' is not null
   group by 1
`

export async function loadStepFunnel(
  em: EntityManager,
  campaignId: string,
  scope: SubjectScope,
  steps: CampaignStep[],
): Promise<JourneyStep[]> {
  const positions = describeJourney(steps)
  if (positions.length === 0) return []
  const rows = await em.getConnection().execute<StepCountRow[]>(
    STEP_COUNTS_SQL,
    [campaignId, scope.tenantId, scope.organizationId],
  )
  return buildStepFunnel(positions, new Map(rows.map((row) => [row.step_id, row])))
}
