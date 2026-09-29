import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubjectScope } from '../subject-document.js'

/**
 * Which links people actually clicked.
 *
 * `link_url` has been written on every click event since tracking existed and nothing read it, so a campaign
 * could report "forty people clicked" and nobody could ask what they clicked — which is the question that
 * decides what the next message leads with. The column was write-only; this is what reads it.
 *
 * **Counted in PEOPLE first.** `people` is distinct runs, the same unit as the funnel and the A/B rates, because
 * one recipient opening a link four times is not four interested customers. `clicks` is carried beside it
 * deliberately: the two diverging is itself information — a link clicked twice per person is one people came
 * back to, and a link where the counts are equal was clicked once and abandoned.
 *
 * The share is over the people who clicked ANYTHING in this campaign, so it answers "of those who engaged, how
 * many went here". The shares therefore sum to more than one whenever anybody clicked two different links, which
 * is correct and not a rounding error: they are overlapping populations, not slices of a pie.
 */

export type LinkClicks = {
  /** As authored, truncated at write time. Never re-resolved: it is a historical fact about a message. */
  url: string
  /** Distinct runs that clicked it — people, not clicks. */
  people: number
  /** Raw click events, which is how "came back to it" becomes visible. */
  clicks: number
  /** Share of everyone who clicked anything in this campaign, 0–1, or null when nobody clicked at all. */
  shareOfClickers: number | null
  /**
   * The steps whose messages carried it.
   *
   * Plural because the same link legitimately appears in a reminder and in the original, and knowing which
   * message drove the clicks is the difference between "this offer works" and "the second email works".
   */
  stepIds: string[]
}

export type LinkReport = {
  links: LinkClicks[]
  /** Distinct people who clicked anything, which is every share's denominator. */
  clickers: number
  /**
   * Whether links were left out.
   *
   * A campaign with hundreds of distinct URLs is real — a newsletter with a product grid — and this report is a
   * ranking, not an inventory. Saying so is the module's rule about truncation: a report that silently stops at
   * a ceiling is one somebody quotes as a total.
   */
  truncated: boolean
}

/** Enough to see the shape of engagement; past this a ranking stops being read. */
export const LINK_REPORT_LIMIT = 25

type LinkRow = {
  url: string
  people: number
  clicks: number
  step_ids: string[] | null
}

/**
 * The share arithmetic, separated from the query.
 *
 * Pure because the decision worth testing is not the grouping — Postgres does that — but what a share means
 * when nobody clicked: null, never zero, for the same reason every other rate in this module is null over an
 * empty denominator.
 */
export function buildLinkReport(rows: LinkRow[], clickers: number, limit = LINK_REPORT_LIMIT): LinkReport {
  const ranked = rows.slice(0, limit).map((row) => ({
    url: row.url,
    people: row.people,
    clicks: row.clicks,
    shareOfClickers: clickers > 0 ? Math.round((row.people / clickers) * 10_000) / 10_000 : null,
    // De-duplicated and ordered here rather than in SQL, so the shape is the same whichever driver answers.
    stepIds: [...new Set(row.step_ids ?? [])].sort(),
  }))
  return { links: ranked, clickers, truncated: rows.length > limit }
}

/**
 * One statement, asking for one row more than it will report.
 *
 * The extra row is how truncation is detected without a second count — the same trick the membership resolver
 * uses, and for the same reason: a `count(*)` over the grouping would double the work to answer a question the
 * ranking already contains.
 */
const LINK_SQL = `
  select
      e.link_url as url,
      count(distinct e.run_id)::int as people,
      count(*)::int as clicks,
      array_agg(distinct e.step_id) as step_ids
    from marketing_message_send_events e
   where e.campaign_id = ? and e.tenant_id = ? and e.organization_id = ?
     and e.type = 'clicked'
     and e.link_url is not null
   group by e.link_url
   order by people desc, clicks desc, url asc
   limit ?
`

/** Distinct people who clicked anything, including clicks on links recorded before `link_url` was written. */
const CLICKERS_SQL = `
  select count(distinct e.run_id)::int as clickers
    from marketing_message_send_events e
   where e.campaign_id = ? and e.tenant_id = ? and e.organization_id = ?
     and e.type = 'clicked'
`

export async function loadLinkReport(
  em: EntityManager,
  campaignId: string,
  scope: SubjectScope,
  limit = LINK_REPORT_LIMIT,
): Promise<LinkReport> {
  const { tenantId, organizationId } = scope
  const connection = em.getConnection()
  const [rows, clickerRows] = await Promise.all([
    connection.execute<LinkRow[]>(LINK_SQL, [campaignId, tenantId, organizationId, limit + 1]),
    connection.execute<Array<{ clickers: number }>>(CLICKERS_SQL, [campaignId, tenantId, organizationId]),
  ])
  return buildLinkReport(rows, clickerRows[0]?.clickers ?? 0, limit)
}
