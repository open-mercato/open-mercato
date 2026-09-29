import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'

/**
 * Tenant-scoped operator overrides of a notification type's delivery contract,
 * read from `notification_type_overrides`. Types without a row (or whose row
 * stores neither field) are absent from the map — the code declarations apply.
 * Used by the create-time gate, the deliver-subscriber recompute, and the
 * preference write path so `shouldDeliver` applies the same effective
 * eligibility + opt-out governance the types API reports.
 */
export type NotificationTypeOverrides = {
  /** Stored eligibility override; `null` ⇒ inherit the code-declared `type.channels`. */
  channels: string[] | null
  /** Stored `nonOptOut` override; `null` ⇒ inherit the code-declared flag. */
  nonOptOut: boolean | null
}

export async function getNotificationTypeOverrides(
  em: EntityManager,
  tenantId: string,
  typeIds: string[],
): Promise<Map<string, NotificationTypeOverrides>> {
  const result = new Map<string, NotificationTypeOverrides>()
  const uniqueIds = Array.from(new Set(typeIds)).filter((id) => id.length > 0)
  if (!uniqueIds.length || !tenantId) return result
  const db = em.getKysely<any>() as Kysely<any>
  const rows = (await db
    .selectFrom('notification_type_overrides')
    .select(['notification_type_id', 'channels', 'non_opt_out'])
    .where('tenant_id', '=', tenantId)
    .where('notification_type_id', 'in', uniqueIds)
    .execute()) as Array<{
    notification_type_id: string
    channels: string[] | null
    non_opt_out: boolean | null
  }>
  for (const row of rows) {
    const channels = Array.isArray(row.channels) ? row.channels : null
    const nonOptOut = typeof row.non_opt_out === 'boolean' ? row.non_opt_out : null
    if (channels !== null || nonOptOut !== null) {
      result.set(row.notification_type_id, { channels, nonOptOut })
    }
  }
  return result
}
