/**
 * The funnel drill-down's engagement stage, as a bounded SQL predicate.
 *
 * The runs list used to answer "who reached this stage" by selecting every matching
 * `run_id` from `marketing_message_sends`/`marketing_message_send_events` into a JS array and then filtering
 * `marketing_campaign_runs` with `id IN (…)`. The `IN` list grows with the campaign — a few hundred thousand
 * sends is a few hundred thousand bound parameters, which is a query nobody should ask Postgres to plan, and
 * on some drivers simply fails past the parameter limit.
 *
 * This runs the same check as an `exists` subquery correlated to the candidate row instead, so nothing is ever
 * materialized into memory or bound as a parameter list: the subquery's cost is one indexed lookup per row
 * `marketing_campaign_runs` already considered, not one per person who reached the stage. Both source tables
 * lead their relevant index with `run_id` (`mkt_sends_run_step_idx`, `mkt_send_events_run_step_idx`), so the
 * correlation is an index lookup rather than a scan.
 */
export type RunEngagement = 'received' | 'opened' | 'clicked'

/**
 * `sql` is written against a query that aliases `marketing_campaign_runs` as `r` — it correlates on `r.id`,
 * `r.tenant_id` and `r.organization_id`, so the caller MUST use that alias. `params` are the `?` placeholders
 * in encounter order, to be spliced into the caller's own parameter list at the point `sql` is spliced in.
 */
export function buildEngagementRunFilter(
  engagement: RunEngagement,
  campaignId: string,
): { sql: string; params: unknown[] } {
  if (engagement === 'received') {
    return {
      sql: `exists (
        select 1 from marketing_message_sends s
         where s.run_id = r.id and s.tenant_id = r.tenant_id and s.organization_id = r.organization_id
           and s.campaign_id = ? and s.status = 'sent'
      )`,
      params: [campaignId],
    }
  }
  return {
    sql: `exists (
      select 1 from marketing_message_send_events e
       where e.run_id = r.id and e.tenant_id = r.tenant_id and e.organization_id = r.organization_id
         and e.campaign_id = ? and e.type = ?
    )`,
    params: [campaignId, engagement],
  }
}
