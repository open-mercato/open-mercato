import { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import { SsoConfig } from '../data/entities'

export class HrdService {
  constructor(private em: EntityManager) {}

  async findActiveConfigByEmailDomain(email: string): Promise<SsoConfig | null> {
    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain) return null

    const db = (this.em as any).getKysely() as Kysely<any>
    const rows = await db
      .selectFrom('sso_configs' as any)
      .selectAll()
      .where(sql<boolean>`allowed_domains @> ${JSON.stringify([domain])}::jsonb`)
      .where('is_active' as any, '=', true)
      .where('deleted_at' as any, 'is', null as any)
      .limit(2)
      .execute()

    if (rows.length !== 1) return null

    return this.em.map(SsoConfig, rows[0] as Record<string, unknown>)
  }
}
