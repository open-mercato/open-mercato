import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubjectScope } from '../subject-document.js'

/**
 * Sends, opens and clicks per day, for a campaign.
 *
 * Grouped in SQL over a generated date series rather than in JavaScript over rows: a chart with gaps
 * where nothing happened draws a line through them and implies activity that did not occur, and filling
 * the gaps after the fact means the query and the filling disagree about what "a day" is. Postgres
 * generates the days, so there is exactly one answer.
 *
 * Days are bucketed in UTC. That is a deliberate simplification and worth knowing when reading a chart:
 * the engagement events come from mail clients all over the world, so any single bucketing is arbitrary,
 * and an arbitrary rule everybody can see beats a clever one nobody can reproduce.
 */

export type DailyPoint = {
  /** `YYYY-MM-DD`, UTC. */
  date: string
  sent: number
  opened: number
  clicked: number
}

const DAILY_SQL = `
  with days as (
    select generate_series(
             (?::timestamptz)::date,
             (?::timestamptz)::date,
             interval '1 day'
           )::date as day
  ),
  sends as (
    select date_trunc('day', sent_at)::date as day, count(*)::int as total
      from marketing_message_sends
     where campaign_id = ? and tenant_id = ? and organization_id = ? and status = 'sent'
     group by 1
  ),
  opens as (
    select date_trunc('day', occurred_at)::date as day, count(distinct run_id)::int as total
      from marketing_message_send_events
     where campaign_id = ? and tenant_id = ? and organization_id = ? and type = 'opened'
     group by 1
  ),
  clicks as (
    select date_trunc('day', occurred_at)::date as day, count(distinct run_id)::int as total
      from marketing_message_send_events
     where campaign_id = ? and tenant_id = ? and organization_id = ? and type = 'clicked'
     group by 1
  )
  select to_char(days.day, 'YYYY-MM-DD') as date,
         coalesce(sends.total, 0)::int as sent,
         coalesce(opens.total, 0)::int as opened,
         coalesce(clicks.total, 0)::int as clicked
    from days
    left join sends on sends.day = days.day
    left join opens on opens.day = days.day
    left join clicks on clicks.day = days.day
   order by days.day asc
`

type DailyRow = { date: string; sent: number; opened: number; clicked: number }

export async function loadDailySeries(
  em: EntityManager,
  campaignId: string,
  scope: SubjectScope,
  window: { from: Date; to: Date },
): Promise<DailyPoint[]> {
  const rows = await em.getConnection().execute<DailyRow[]>(DAILY_SQL, [
    window.from, window.to,
    campaignId, scope.tenantId, scope.organizationId,
    campaignId, scope.tenantId, scope.organizationId,
    campaignId, scope.tenantId, scope.organizationId,
  ])
  return rows.map((row) => ({
    date: row.date,
    sent: row.sent ?? 0,
    opened: row.opened ?? 0,
    clicked: row.clicked ?? 0,
  }))
}
