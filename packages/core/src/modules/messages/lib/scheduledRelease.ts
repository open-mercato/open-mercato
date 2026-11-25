import type { EntityManager } from '@mikro-orm/postgresql'
import { sql, type Kysely } from 'kysely'
import { SCHEDULED_RELEASE_BATCH, SCHEDULED_RELEASE_LEASE_MINUTES } from './scheduledSend'

export type ScheduledReleaseDatabase = {
  messages: {
    id: string
    status: string
    is_draft: boolean
    sent_at: Date | null
    updated_at: Date
    scheduled_at: Date | null
    scheduled_release_attempts: number
    tenant_id: string
    organization_id: string | null
    deleted_at: Date | null
  }
}

export type ClaimedScheduledMessage = {
  id: string
  scheduledAt: Date | null
  attempts: number
}

export type ScheduledReleaseScope = { tenantId: string; organizationId: string | null }

/**
 * One atomic statement moves due scheduled messages of one organization to
 * `releasing` (still a draft, so neither the retry tick nor the editor touch
 * them); only the worker whose UPDATE returns a row hands it off, so two
 * concurrent ticks never release the same message twice. `updated_at` is the
 * lease: a `releasing` row whose worker died is claimed again once it expires.
 */
export function buildClaimDueScheduledMessagesQuery(db: Kysely<ScheduledReleaseDatabase>, scope: ScheduledReleaseScope) {
  let due = db.selectFrom('messages')
    .select('id')
    .where((eb) => eb.or([
      eb.and([eb('status', '=', 'scheduled'), eb('scheduled_at', '<=', sql<Date>`now()`)]),
      eb.and([
        eb('status', '=', 'releasing'),
        eb('updated_at', '<', sql<Date>`now() - make_interval(mins => ${SCHEDULED_RELEASE_LEASE_MINUTES})`),
      ]),
    ]))
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
  due = scope.organizationId
    ? due.where('organization_id', '=', scope.organizationId)
    : due.where('organization_id', 'is', null)
  return db.updateTable('messages')
    .set({
      status: 'releasing',
      updated_at: sql<Date>`now()`,
      scheduled_release_attempts: sql<number>`scheduled_release_attempts + 1`,
    })
    .where('id', 'in', due.orderBy('scheduled_at').limit(SCHEDULED_RELEASE_BATCH).forUpdate().skipLocked())
    .where('status', 'in', ['scheduled', 'releasing'])
    .returning(['id', 'scheduled_at', 'scheduled_release_attempts'])
}

export async function claimDueScheduledMessages(
  em: EntityManager,
  scope: ScheduledReleaseScope,
): Promise<ClaimedScheduledMessage[]> {
  const rows = await buildClaimDueScheduledMessagesQuery(em.getKysely<ScheduledReleaseDatabase>(), scope).execute()
  return rows.map((row) => ({
    id: row.id,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
    attempts: Number(row.scheduled_release_attempts),
  }))
}
