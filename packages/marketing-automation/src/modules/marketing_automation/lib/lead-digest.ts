import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingJobRun } from '../data/entities.js'
import { buildRepDigests, loadRoutingPool } from './lead-routing.js'
import { digestIsWorthSending } from './engine/lead-routing.js'

/**
 * The weekly lead digest, delivered as an IN-APP notification.
 *
 * **Not email, deliberately.** Emailing a rep needs their address, and the only ways to get one from here are
 * to read the auth module's user table or to store a copy in this module's config — a cross-module table read
 * or a stale duplicate of somebody's contact details. The notifications module already delivers to a user id,
 * localises the copy and respects that person's own delivery preferences (including email, if they want it),
 * which makes it both less coupling and more correct.
 */

export type DigestScope = { tenantId: string; organizationId: string }

/** A week, as the digest's window and its interval. */
export const DIGEST_INTERVAL_DAYS = 7

/** The job kind recorded for a digest pass, which is also how "have I sent one this week" is answered. */
export const DIGEST_JOB_KIND = 'lead_digest'

type NotificationServiceLike = {
  createBatch(
    input: {
      type: string
      titleKey?: string
      bodyKey?: string
      titleVariables?: Record<string, string>
      bodyVariables?: Record<string, string>
      severity?: 'info' | 'success' | 'warning' | 'error'
      sourceModule?: string
      linkHref?: string
      groupKey?: string
      recipientUserIds: string[]
    },
    ctx: { tenantId: string; organizationId?: string | null; userId?: string | null },
  ): Promise<unknown>
}

export type DigestOutcome = { sent: number; skipped: number }

/**
 * Whether a digest is owed this week.
 *
 * Answered from the job log rather than from a flag of its own: the pass is already recorded there for the
 * operator, and a second source of truth for the same fact is a second thing to get wrong. Rows in
 * `running` count, which is what makes the log a CLAIM rather than a receipt — see the caller.
 */
export async function leadDigestIsDue(
  em: EntityManager,
  scope: DigestScope,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - DIGEST_INTERVAL_DAYS * 86_400_000)
  const recent = await em.find(
    MarketingJobRun,
    { ...scope, kind: DIGEST_JOB_KIND, startedAt: { $gte: since } },
    { limit: 1 },
  )
  return recent.length === 0
}

/**
 * Sends each rep their week.
 *
 * Does NOT decide whether it is due. It used to, and the caller then wrote the job row afterwards — so the
 * row that answers "already sent this week" appeared only once the sending had finished, and two overlapping
 * ticks both read "not yet" and both sent. The caller claims the week by creating the row first and runs this
 * inside that claim; `leadDigestIsDue` is the question it asks before claiming.
 */
export async function sendWeeklyLeadDigests(
  em: EntityManager,
  container: AwilixContainer,
  scope: DigestScope,
  now: Date,
): Promise<DigestOutcome> {
  const since = new Date(now.getTime() - DIGEST_INTERVAL_DAYS * 86_400_000)

  const pool = await loadRoutingPool(container, scope)
  if (pool.length === 0) return { sent: 0, skipped: 0 }

  let notifications: NotificationServiceLike
  try {
    notifications = container.resolve<NotificationServiceLike>('notificationService')
  } catch {
    // A trimmed installation without the notifications module routes leads fine; it just cannot tell anybody.
    return { sent: 0, skipped: pool.length }
  }

  const digests = await buildRepDigests(em, scope, pool, since)
  let sent = 0
  let skipped = 0

  for (const digest of digests) {
    if (!digestIsWorthSending(digest)) {
      // A digest saying "no new leads" teaches people to ignore notifications.
      skipped += 1
      continue
    }
    await notifications.createBatch(
      {
        type: 'marketing_automation.lead_digest',
        titleKey: 'marketing_automation.notifications.leadDigest.title',
        bodyKey: 'marketing_automation.notifications.leadDigest.body',
        titleVariables: { count: String(digest.newLeads.length) },
        bodyVariables: {
          count: String(digest.newLeads.length),
          total: String(digest.totalOwned),
          names: digest.newLeads.map((lead) => lead.displayName).join(', '),
        },
        severity: 'info',
        sourceModule: 'marketing_automation',
        linkHref: '/backend/marketing/lead-routing',
        // One per rep per week: a redelivered pass groups onto the same key rather than stacking.
        groupKey: `marketing_automation.lead_digest.${digest.userId}`,
        recipientUserIds: [digest.userId],
      },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    sent += 1
  }

  return { sent, skipped }
}
