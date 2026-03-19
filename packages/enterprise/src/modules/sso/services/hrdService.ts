import { EntityManager } from '@mikro-orm/postgresql'
import { SsoConfig } from '../data/entities'

export class HrdService {
  constructor(private em: EntityManager) {}

  async findActiveConfigByEmailDomain(email: string): Promise<SsoConfig | null> {
    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain) return null

    const knex = this.em.getKnex()
    const row = await knex('sso_configs')
      .whereRaw("allowed_domains @> ?::jsonb", [JSON.stringify([domain])])
      .where('is_active', true)
      .whereNull('deleted_at')
      .first()

    if (!row) return null

    return this.em.map(SsoConfig, row)
  }
}
