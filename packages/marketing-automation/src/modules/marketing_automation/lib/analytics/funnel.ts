import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubjectScope } from '../subject-document.js'
import { PLACED_ORDER_FILTER_SQL_ALIASED } from '../order-filter.js'
import { SALES_ORDERS } from '../external/tables.js'

/**
 * The campaign funnel: how many people reached each stage, and where they fell out.
 *
 * **Counted in PEOPLE, never in messages.** A funnel of messages is not a funnel — a journey with three emails
 * in it would report three times the "sent" of a journey with one and look like it reached three times as many
 * customers. Every stage below is a count of distinct RUNS, which is this module's unit for one person going
 * through one campaign once.
 *
 * **There is no "delivered" stage, on purpose.** Delivery is what the receiving mail server did, and the
 * platform has no provider feedback contract — so a delivered count here could only be a copy of the sent
 * count wearing a more confident name. The `delivered` EVENT type exists in the table for a provider that one
 * day reports it; until something writes those rows, showing the stage would be inventing a number. The gap
 * is recorded as a core proposal in the spec instead.
 *
 * **Conversion reuses the attribution query's definition**, rather than inventing a second one: a customer who
 * clicked and then ordered inside the window. Two definitions of "converted" on two screens is how a report
 * stops being trusted.
 */

export type FunnelStage = {
  /** `entered` | `sent` | `opened` | `clicked` | `converted`. */
  key: string
  /** Distinct people who reached this stage. */
  people: number
  /**
   * Share of the people who reached the PREVIOUS stage, 0–1, or null for the first stage and wherever the
   * previous stage is empty. Null rather than zero: a rate over nobody is not a rate of nothing.
   */
  conversionFromPrevious: number | null
  /** Share of the people who ENTERED the campaign at all, which is the number an operator quotes. */
  shareOfEntered: number | null
}

export type CampaignFunnel = {
  stages: FunnelStage[]
  /**
   * Whether anything is known about opens and clicks at all.
   *
   * False when the campaign has never had tracking enabled on a message, so the screen can say "tracking is
   * off for this campaign" instead of showing three zeroes that look like a campaign nobody engaged with.
   */
  hasEngagementData: boolean
}

const FUNNEL_SQL = `
  with entered as (
    select id, subject_entity_id
      from marketing_campaign_runs
     where campaign_id = ? and tenant_id = ? and organization_id = ?
  ),
  sent as (
    select distinct s.run_id as id
      from marketing_message_sends s
     where s.campaign_id = ? and s.tenant_id = ? and s.organization_id = ?
       and s.status = 'sent'
       and s.run_id is not null
  ),
  opened as (
    select distinct e.run_id as id
      from marketing_message_send_events e
     where e.campaign_id = ? and e.tenant_id = ? and e.organization_id = ?
       and e.type = 'opened'
  ),
  clicked as (
    select distinct e.run_id as id
      from marketing_message_send_events e
     where e.campaign_id = ? and e.tenant_id = ? and e.organization_id = ?
       and e.type = 'clicked'
  ),
  /**
   * A conversion is a click followed by an order inside the window — the SAME definition the revenue
   * attribution uses, keyed back to the run so the funnel counts people rather than orders.
   */
  converted as (
    select distinct e.run_id as id
      from marketing_message_send_events e
      join entered r on r.id = e.run_id
      join ${SALES_ORDERS} o
        on o.customer_entity_id = r.subject_entity_id
       and o.placed_at > e.occurred_at
       and o.placed_at <= e.occurred_at + make_interval(days => ?)
     where e.campaign_id = ? and e.tenant_id = ? and e.organization_id = ?
       and e.type = 'clicked'
       and r.subject_entity_id is not null
       and ${PLACED_ORDER_FILTER_SQL_ALIASED}
  )
  select
    (select count(*) from entered)::int as entered,
    (select count(*) from sent)::int as sent,
    (select count(*) from opened)::int as opened,
    (select count(*) from clicked)::int as clicked,
    (select count(*) from converted)::int as converted
`

type FunnelRow = {
  entered: number
  sent: number
  opened: number
  clicked: number
  converted: number
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 10_000) / 10_000
}

/**
 * Turns the five counts into stages with their drop-off.
 *
 * Pure, because the arithmetic is where the decisions are: what a rate over nobody means, and which
 * denominator each percentage uses. A reader of the screen needs both — "half of those who opened clicked" and
 * "a tenth of everyone who entered clicked" are different facts and operators quote whichever suits them.
 */
export function buildFunnelStages(counts: FunnelRow): FunnelStage[] {
  const ordered: Array<[string, number]> = [
    ['entered', counts.entered],
    ['sent', counts.sent],
    ['opened', counts.opened],
    ['clicked', counts.clicked],
    ['converted', counts.converted],
  ]

  return ordered.map(([key, people], index) => {
    const previous = index === 0 ? null : ordered[index - 1][1]
    return {
      key,
      people,
      conversionFromPrevious: previous === null ? null : ratio(people, previous),
      shareOfEntered: index === 0 ? null : ratio(people, counts.entered),
    }
  })
}

export async function loadCampaignFunnel(
  em: EntityManager,
  campaignId: string,
  scope: SubjectScope,
  options: { conversionWindowDays: number },
): Promise<CampaignFunnel> {
  const { tenantId, organizationId } = scope
  const rows = await em.getConnection().execute<FunnelRow[]>(FUNNEL_SQL, [
    campaignId, tenantId, organizationId,
    campaignId, tenantId, organizationId,
    campaignId, tenantId, organizationId,
    campaignId, tenantId, organizationId,
    options.conversionWindowDays,
    campaignId, tenantId, organizationId,
    tenantId, organizationId,
  ])
  const counts = rows[0] ?? { entered: 0, sent: 0, opened: 0, clicked: 0, converted: 0 }

  return {
    stages: buildFunnelStages(counts),
    // An untracked campaign delivers perfectly well and simply cannot report engagement; saying so is the
    // difference between "nobody opened this" and "we were not watching".
    hasEngagementData: counts.opened > 0 || counts.clicked > 0,
  }
}
