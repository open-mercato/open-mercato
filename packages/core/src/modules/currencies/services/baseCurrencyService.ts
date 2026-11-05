import type { EntityManager } from '@mikro-orm/core'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('currencies').child({ component: 'base-currency-service' })

export type BaseCurrencyResolution =
  | { status: 'resolved'; code: string }
  | { status: 'missing' }
  | { status: 'ambiguous' }
  | { status: 'unavailable' }

export type BaseCurrencyScope = {
  tenantId: string
  organizationIds: string[]
}

export class BaseCurrencyService {
  constructor(private readonly em: EntityManager) {}

  async resolveBaseCurrency(scope: BaseCurrencyScope): Promise<BaseCurrencyResolution> {
    const organizationIds = [...new Set(scope.organizationIds)]
    if (organizationIds.length === 0) return { status: 'ambiguous' }

    let rows: Array<Record<string, unknown>>
    try {
      const result = await this.em.getConnection().execute(
        'SELECT organization_id, code FROM currencies WHERE tenant_id = ? AND organization_id = ANY(?::uuid[]) AND is_base = true AND deleted_at IS NULL',
        [scope.tenantId, `{${organizationIds.join(',')}}`],
      )
      rows = (Array.isArray(result) ? result : []) as Array<Record<string, unknown>>
    } catch (err) {
      logger.warn('Base currency lookup unavailable', { err })
      return { status: 'unavailable' }
    }

    const expectedOrganizations = new Set(organizationIds)
    const resolvedOrganizations = new Set<string>()
    const codes = new Set<string>()

    for (const row of rows) {
      const organizationId = typeof row.organization_id === 'string' ? row.organization_id : ''
      const code = typeof row.code === 'string' ? row.code.trim().toUpperCase() : ''
      if (
        !expectedOrganizations.has(organizationId)
        || resolvedOrganizations.has(organizationId)
        || !code
      ) {
        return { status: 'ambiguous' }
      }
      resolvedOrganizations.add(organizationId)
      codes.add(code)
    }

    if (resolvedOrganizations.size !== expectedOrganizations.size) return { status: 'missing' }
    if (codes.size !== 1) return { status: 'ambiguous' }
    const [code] = codes
    return code ? { status: 'resolved', code } : { status: 'ambiguous' }
  }
}
