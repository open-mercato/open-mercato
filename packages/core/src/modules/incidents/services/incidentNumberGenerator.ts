import type { EntityManager } from '@mikro-orm/postgresql'

export type IncidentNumberScope = { organizationId: string; tenantId: string }

const DEFAULT_START = 1

export class IncidentNumberGenerator {
  constructor(private readonly em: EntityManager) {}

  async allocate(scope: IncidentNumberScope, format: string): Promise<string> {
    const rows = await this.em.getConnection().execute<{ current_value: string }[]>(
      `insert into incident_number_sequences (id, organization_id, tenant_id, current_value, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, ?, now(), now())
       on conflict (organization_id, tenant_id)
       do update set current_value = incident_number_sequences.current_value + 1, updated_at = now()
       returning current_value`,
      [scope.organizationId, scope.tenantId, DEFAULT_START],
    )
    const seq = Number(rows?.[0]?.current_value ?? DEFAULT_START)
    return this.applyFormat(format, seq)
  }

  private applyFormat(source: string, seq: number): string {
    const now = new Date()
    return source.replace(/\{([a-zA-Z]+)(?::([^}]+))?\}/g, (match, token: string, arg?: string) => {
      switch (token) {
        case 'yyyy': return String(now.getUTCFullYear())
        case 'yy': return String(now.getUTCFullYear()).slice(-2)
        case 'mm': return String(now.getUTCMonth() + 1).padStart(2, '0')
        case 'dd': return String(now.getUTCDate()).padStart(2, '0')
        case 'seq': return String(seq).padStart(arg ? Number(arg) : 1, '0')
        default: return match
      }
    })
  }
}
