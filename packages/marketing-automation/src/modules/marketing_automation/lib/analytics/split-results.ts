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
 *
 * Which is also why the DENOMINATOR is a count of runs. Every rate here is "of the people this lane
 * reached, how many acted" — never "per message", because a lane with two emails in it would then have
 * every rate structurally halved against a lane with one, and the split would be decided by how many
 * steps the author happened to put in each side rather than by the copy.
 */

export type SplitVariantResult = {
  stepId: string
  variant: string
  runs: number
  sends: number
  /**
   * Distinct runs that received at least one of this lane's messages.
   *
   * The denominator for every rate, and the sample the winner rule waits on. `sends` counts MESSAGES and is
   * reported beside it because an operator wants to know the volume, but it cannot divide a per-run
   * numerator: a two-email lane sends twice as many messages to the same people.
   */
  reached: number
  /**
   * Whether the lane has steps of its own.
   *
   * False for a HOLDOUT — a control lane that deliberately sends nothing. It is reported like any other lane,
   * because the number of people held back is the whole point of having one, but it is not a candidate in a
   * comparison of copy and it must not be counted as a lane still gathering its sample. Treating it as one
   * made a winner unreachable forever in every campaign that had a holdout: nothing can raise a control
   * group's click rate.
   */
  hasSteps: boolean
  opened: number
  clicked: number
  /** Clicks per person reached, or null with nobody reached — a rate over zero is not a zero rate. */
  clickRate: number | null
  openRate: number | null
  /**
   * What this lane's messages earned, and in which currency.
   *
   * Attributed the same way the funnel's conversion stage is: an order placed by one of this lane's recipients
   * after clicking one of ITS steps, inside the window. Null when nothing is attributable yet.
   *
   * `currencyCode` is carried rather than assumed because a shop selling in two currencies has two numbers here
   * and they must never be added — `mixedCurrency` says so, and the winner rule refuses to rank on revenue when
   * it is true instead of comparing figures that are not comparable.
   */
  revenue: number | null
  currencyCode: string | null
  mixedCurrency: boolean
  /** Revenue per person reached, which is what a comparison between unequal lanes needs. */
  revenuePerRecipient: number | null
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
           (select count(distinct s.run_id)
              from marketing_message_sends s
             where s.tenant_id = ?
               and s.organization_id = ?
               and s.status = 'sent'
               and s.run_id in (select id from lane_runs)
               and s.step_id in (${stepPlaceholders}))::int as reached,
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
               and e.step_id in (${stepPlaceholders}))::int as clicked,
           /**
            * What the lane earned, and how many currencies that is spread across.
            *
            * Attributed exactly as the funnel attributes a conversion — a click on one of THIS lane's steps
            * followed by an order from that recipient inside the window — so the two screens cannot disagree
            * about who converted. Distinct by order id, because one order must not be counted twice when a
            * recipient clicked two of the lane's messages before buying.
            */
           (select coalesce(sum(orders.total), 0)::float8
              from (
                select distinct o.id, o.grand_total_gross_amount as total
                  from marketing_message_send_events e
                  join marketing_campaign_runs r on r.id = e.run_id
                  join sales_orders o
                    on o.customer_entity_id = r.subject_entity_id
                   and o.placed_at > e.occurred_at
                   and o.placed_at <= e.occurred_at + make_interval(days => ?)
                 where e.tenant_id = ? and e.organization_id = ?
                   and e.type = 'clicked'
                   and e.run_id in (select id from lane_runs)
                   and e.step_id in (${stepPlaceholders})
                   and r.subject_entity_id is not null
                   and o.deleted_at is null
                   and o.placed_at is not null
                   and (o.status is null or o.status not in ('canceled', 'cancelled'))
              ) orders)::float8 as revenue,
           (select count(distinct o.currency_code)
              from marketing_message_send_events e
              join marketing_campaign_runs r on r.id = e.run_id
              join sales_orders o
                on o.customer_entity_id = r.subject_entity_id
               and o.placed_at > e.occurred_at
               and o.placed_at <= e.occurred_at + make_interval(days => ?)
             where e.tenant_id = ? and e.organization_id = ?
               and e.type = 'clicked'
               and e.run_id in (select id from lane_runs)
               and e.step_id in (${stepPlaceholders})
               and r.subject_entity_id is not null
               and o.deleted_at is null
               and o.placed_at is not null
               and (o.status is null or o.status not in ('canceled', 'cancelled')))::int as currencies,
           (select min(o.currency_code)
              from marketing_message_send_events e
              join marketing_campaign_runs r on r.id = e.run_id
              join sales_orders o
                on o.customer_entity_id = r.subject_entity_id
               and o.placed_at > e.occurred_at
               and o.placed_at <= e.occurred_at + make_interval(days => ?)
             where e.tenant_id = ? and e.organization_id = ?
               and e.type = 'clicked'
               and e.run_id in (select id from lane_runs)
               and e.step_id in (${stepPlaceholders})
               and r.subject_entity_id is not null
               and o.deleted_at is null
               and o.placed_at is not null
               and (o.status is null or o.status not in ('canceled', 'cancelled'))) as currency_code
  `
}

type ResultRow = {
  runs: number
  sends: number
  reached: number
  opened: number
  clicked: number
  revenue: number | null
  currencies: number
  currency_code: string | null
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return numerator / denominator
}

/**
 * The revenue half of a lane's row, and the currency caveat that comes with it.
 *
 * Null rather than zero when nothing has been attributed: "nobody has bought yet" and "they bought nothing" are
 * different facts, and only the second is a result. More than one currency is reported as such rather than summed
 * — a figure mixing PLN and EUR is not a number — and the winner rule refuses to rank on revenue when it sees one.
 */
function readRevenue(
  row: ResultRow | undefined,
  reached: number,
): Pick<SplitVariantResult, 'revenue' | 'currencyCode' | 'mixedCurrency' | 'revenuePerRecipient'> {
  const currencies = row?.currencies ?? 0
  if (!row || currencies === 0) {
    return { revenue: null, currencyCode: null, mixedCurrency: false, revenuePerRecipient: null }
  }
  const revenue = Math.round((row.revenue ?? 0) * 100) / 100
  const mixedCurrency = currencies > 1
  return {
    revenue,
    // With several currencies there is no single code to report, and reporting one of them would be a lie.
    currencyCode: mixedCurrency ? null : row.currency_code ?? null,
    mixedCurrency,
    // Per person reached, for the same reason the click rate is: lanes are rarely weighted equally.
    revenuePerRecipient: reached > 0 ? Math.round((revenue / reached) * 100) / 100 : null,
  }
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
  /**
   * How long after a click an order still counts towards a lane.
   *
   * The SAME window the revenue attribution and the funnel use, passed in rather than defaulted here so the
   * three cannot drift into disagreeing about which orders belong to a campaign.
   */
  conversionWindowDays = 7,
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
        reached: 0,
        hasSteps: false,
        opened: 0,
        clicked: 0,
        clickRate: null,
        openRate: null,
        // A holdout sends nothing, so nothing is attributable to it — which is the point of having one.
        revenue: null,
        currencyCode: null,
        mixedCurrency: false,
        revenuePerRecipient: null,
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
      scope.tenantId, scope.organizationId, ...lane.stepIds,
      // The three revenue subqueries: each takes the window, then the scope, then the step ids.
      conversionWindowDays, scope.tenantId, scope.organizationId, ...lane.stepIds,
      conversionWindowDays, scope.tenantId, scope.organizationId, ...lane.stepIds,
      conversionWindowDays, scope.tenantId, scope.organizationId, ...lane.stepIds,
    ])
    const row = rows[0]
    results.push({
      stepId: lane.splitStepId,
      variant: lane.variant,
      runs: row?.runs ?? 0,
      sends: row?.sends ?? 0,
      reached: row?.reached ?? 0,
      hasSteps: true,
      opened: row?.opened ?? 0,
      clicked: row?.clicked ?? 0,
      clickRate: rate(row?.clicked ?? 0, row?.reached ?? 0),
      openRate: rate(row?.opened ?? 0, row?.reached ?? 0),
      ...readRevenue(row, row?.reached ?? 0),
    })
  }

  return results
}

/**
 * What a winner is judged on.
 *
 * `clicks` is the default and was the only option: it is available on every campaign and needs no order data.
 * `revenue` is the better question — a variant that collects clicks and sells less is the classic trap, and this
 * module could not see it — but it needs attribution, so a shop whose orders are not attributable would never
 * conclude a test on it. The choice is the operator's, per tenant.
 */
export type WinnerMetric = 'clicks' | 'revenue'

export type SplitWinner = {
  stepId: string
  variant: string
  /** Which question this winner answered. */
  metric: WinnerMetric
  /** The winner's figure on that metric, and the runner-up's below it. */
  value: number
  runnerUpValue: number | null
  clickRate: number
  /** The runner-up's CLICK rate, kept whichever metric decided, so a screen can always show both. */
  runnerUpClickRate: number | null
  sends: number
  /** The sample the call was made on: people, not messages. */
  reached: number
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
 *
 * The minimum is counted in PEOPLE REACHED, not messages sent, for the same reason the rates are: a lane
 * holding two emails would otherwise clear a "minimum sample" gate on half as many recipients as the lane
 * it is being compared against.
 */
export function pickSplitWinner(
  results: SplitVariantResult[],
  stepId: string,
  minimumReached: number,
  metric: WinnerMetric = 'clicks',
): SplitWinner | null {
  /**
   * Holdouts are excluded from the comparison, not from the results.
   *
   * A control lane sends nothing on purpose, so it has no click rate and never will. Requiring every lane to
   * reach the minimum therefore meant no campaign with a holdout could ever produce a winner — the one
   * configuration where an operator most wants to know which message worked.
   */
  const lanes = results.filter((result) => result.stepId === stepId && result.hasSteps)
  if (lanes.length < 2) return null
  if (lanes.some((lane) => lane.reached < minimumReached)) return null

  /**
   * Revenue is refused rather than approximated when the lanes are not comparable.
   *
   * Two lanes earning in different currencies have no ordering, and neither does a lane with nothing attributed
   * yet — answering anyway would pick a winner on a number that does not mean what it says. Saying "not yet" is
   * the honest outcome, and it is also recoverable: attribution arrives as orders do.
   */
  if (metric === 'revenue') {
    if (lanes.some((lane) => lane.mixedCurrency)) return null
    const codes = new Set(lanes.map((lane) => lane.currencyCode).filter((code): code is string => Boolean(code)))
    if (codes.size > 1) return null
    if (lanes.some((lane) => lane.revenuePerRecipient === null)) return null
  }

  const score = (lane: SplitVariantResult): number | null => (
    metric === 'revenue' ? lane.revenuePerRecipient : lane.clickRate
  )

  const ranked = [...lanes].sort((left, right) => (score(right) ?? 0) - (score(left) ?? 0))
  const best = ranked[0]
  const runnerUp = ranked[1]
  const bestScore = score(best)
  if (bestScore === null) return null
  const runnerUpScore = runnerUp ? score(runnerUp) : null
  // A tie teaches nothing, and replacing the split would throw away the ability to keep measuring.
  if (runnerUp && runnerUpScore === bestScore) return null

  return {
    stepId,
    variant: best.variant,
    metric,
    value: bestScore,
    runnerUpValue: runnerUpScore,
    // Both rates travel regardless of which metric decided, so a screen never has to ask twice.
    clickRate: best.clickRate ?? 0,
    runnerUpClickRate: runnerUp?.clickRate ?? null,
    sends: best.sends,
    reached: best.reached,
  }
}
