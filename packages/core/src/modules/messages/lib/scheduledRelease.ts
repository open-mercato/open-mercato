import type { EntityManager } from '@mikro-orm/postgresql'
import { sql, type Kysely } from 'kysely'
import { SCHEDULED_RELEASE_BATCH } from './scheduledSend'

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
 * One atomic statement flips due scheduled messages of one organization to
 * `sent`; only the worker whose UPDATE returns a row hands it off, so two
 * concurrent ticks never release the same message twice.
 */
export function buildClaimDueScheduledMessagesQuery(db: Kysely<ScheduledReleaseDatabase>, scope: ScheduledReleaseScope) {
  let due = db.selectFrom('messages')
    .select('id')
    .where('status', '=', 'scheduled')
    .where('scheduled_at', '<=', sql<Date>`now()`)
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
  due = scope.organizationId
    ? due.where('organization_id', '=', scope.organizationId)
    : due.where('organization_id', 'is', null)
  return db.updateTable('messages')
    .set({
      status: 'sent',
      is_draft: false,
      sent_at: sql<Date>`now()`,
      updated_at: sql<Date>`now()`,
      scheduled_release_attempts: sql<number>`scheduled_release_attempts + 1`,
    })
    .where('id', 'in', due.orderBy('scheduled_at').limit(SCHEDULED_RELEASE_BATCH).forUpdate().skipLocked())
    .where('status', '=', 'scheduled')
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
