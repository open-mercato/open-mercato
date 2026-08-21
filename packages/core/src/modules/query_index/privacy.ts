import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  PrivacyDataClassHandler,
  PrivacyEnvironmentSanitizationInput,
} from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import { EntityIndexRow } from './data/entities'

type SearchIndexerLike = {
  purgeEntity(input: { entityId: string; tenantId: string; organizationId: string }): Promise<void>
}

export const QUERY_INDEX_CONTENT_DATA_CLASS_ID = 'query_index.content'

registerPrivacyDataClass({
  id: QUERY_INDEX_CONTENT_DATA_CLASS_ID,
  module: 'query_index',
  title: 'Search index content',
  description: 'Database, full-text, and vector projections derived from tenant data.',
  handlerService: 'queryIndexEnvironmentPrivacyHandler',
  subjectKinds: [],
  subjectActions: [],
  environmentSanitization: { categories: ['personal_data', 'ai_content'] },
})

export class QueryIndexEnvironmentPrivacyHandler implements PrivacyDataClassHandler {
  constructor(
    private readonly em: EntityManager,
    private readonly resolveSearchIndexer: () => SearchIndexerLike | null,
  ) {}

  async sanitizeEnvironment(input: PrivacyEnvironmentSanitizationInput) {
    const rows = await this.findRows(input)
    if (input.dryRun || rows.length === 0) return { matched: rows.length, affected: 0 }
    const entityTypes = Array.from(new Set(rows.map((row) => row.entityType))).sort()
    const searchIndexer = this.resolveSearchIndexer()
    if (!searchIndexer) {
      throw new Error('[internal] Search index sanitization requires the searchIndexer service')
    }
    for (const entityType of entityTypes) {
      await searchIndexer.purgeEntity({
        entityId: entityType,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
      })
    }
    return { matched: rows.length, affected: rows.length }
  }

  async verifyEnvironmentSanitization(input: PrivacyEnvironmentSanitizationInput) {
    const rows = await this.em.count(EntityIndexRow, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      deletedAt: null,
    })
    const findings = rows > 0 ? [{ code: 'query_index.content_present', count: rows }] : []
    return { passed: findings.length === 0, findings }
  }

  private findRows(input: PrivacyEnvironmentSanitizationInput): Promise<EntityIndexRow[]> {
    return this.em.find(EntityIndexRow, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      deletedAt: null,
    })
  }
}
