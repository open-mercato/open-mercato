import { sql } from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'

export async function readTenantAttachmentUsageBytes(em: EntityManager, tenantId: string): Promise<number> {
  try {
    const db = em.getKysely<any>() as any
    const row = await db
      .selectFrom('attachments')
      .select(sql<string>`sum(file_size)`.as('total_size'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst() as { total_size: string | number | null } | undefined
    const total = row?.total_size
    if (typeof total === 'number') return Number.isFinite(total) ? total : 0
    if (typeof total === 'string') {
      const parsed = Number(total)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
  } catch {
    return 0
  }
}
