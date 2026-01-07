import type { SearchService } from '../service'
import type {
  SearchModuleConfig,
  SearchEntityConfig,
  SearchBuildContext,
  IndexableRecord,
  SearchResultPresenter,
  SearchResultLink,
} from '../types'
import type { EntityId } from '@open-mercato/shared/modules/entities'

/**
 * Parameters for indexing a record.
 */
export type IndexRecordParams = {
  entityId: EntityId
  recordId: string
  tenantId: string
  organizationId?: string | null
  record: Record<string, unknown>
  customFields?: Record<string, unknown>
}

/**
 * Parameters for deleting a record from the search index.
 */
export type DeleteRecordParams = {
  entityId: EntityId
  recordId: string
  tenantId: string
}

/**
 * Parameters for purging all records of an entity type.
 */
export type PurgeEntityParams = {
  entityId: EntityId
  tenantId: string
}

/**
 * SearchIndexer orchestrates indexing operations by resolving entity configs
 * and building IndexableRecords for the SearchService.
 */
export class SearchIndexer {
  private readonly entityConfigMap: Map<EntityId, SearchEntityConfig>

  constructor(
    private readonly searchService: SearchService,
    private readonly moduleConfigs: SearchModuleConfig[],
  ) {
    this.entityConfigMap = new Map()
    for (const moduleConfig of moduleConfigs) {
      for (const entityConfig of moduleConfig.entities) {
        if (entityConfig.enabled !== false) {
          this.entityConfigMap.set(entityConfig.entityId as EntityId, entityConfig)
        }
      }
    }
  }

  /**
   * Get the entity config for a given entity ID.
   */
  getEntityConfig(entityId: EntityId): SearchEntityConfig | undefined {
    return this.entityConfigMap.get(entityId)
  }

  /**
   * Check if an entity is configured for search indexing.
   */
  isEntityEnabled(entityId: EntityId): boolean {
    const config = this.entityConfigMap.get(entityId)
    return config?.enabled !== false
  }

  /**
   * Index a record in the search service.
   */
  async indexRecord(params: IndexRecordParams): Promise<void> {
    const config = this.entityConfigMap.get(params.entityId)
    if (!config || config.enabled === false) {
      return // Entity not configured for search
    }

    const buildContext: SearchBuildContext = {
      record: params.record,
      customFields: params.customFields ?? {},
      organizationId: params.organizationId,
      tenantId: params.tenantId,
    }

    // Build presenter using config
    let presenter: SearchResultPresenter | undefined
    if (config.formatResult) {
      try {
        const result = await config.formatResult(buildContext)
        if (result) presenter = result
      } catch (error) {
        console.warn('[SearchIndexer] formatResult failed', {
          entityId: params.entityId,
          recordId: params.recordId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    // Resolve URL
    let url: string | undefined
    if (config.resolveUrl) {
      try {
        const result = await config.resolveUrl(buildContext)
        if (result) url = result
      } catch (error) {
        console.warn('[SearchIndexer] resolveUrl failed', {
          entityId: params.entityId,
          recordId: params.recordId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    // Resolve links
    let links: SearchResultLink[] | undefined
    if (config.resolveLinks) {
      try {
        const result = await config.resolveLinks(buildContext)
        if (result) links = result
      } catch (error) {
        console.warn('[SearchIndexer] resolveLinks failed', {
          entityId: params.entityId,
          recordId: params.recordId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    // Build IndexableRecord
    const indexableRecord: IndexableRecord = {
      entityId: params.entityId,
      recordId: params.recordId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      fields: params.record,
      presenter,
      url,
      links,
    }

    await this.searchService.index(indexableRecord)
  }

  /**
   * Delete a record from the search index.
   */
  async deleteRecord(params: DeleteRecordParams): Promise<void> {
    await this.searchService.delete(params.entityId, params.recordId, params.tenantId)
  }

  /**
   * Purge all records of an entity type from the search index.
   */
  async purgeEntity(params: PurgeEntityParams): Promise<void> {
    await this.searchService.purge(params.entityId, params.tenantId)
  }

  /**
   * Bulk index multiple records.
   */
  async bulkIndexRecords(params: IndexRecordParams[]): Promise<void> {
    const indexableRecords: IndexableRecord[] = []

    for (const param of params) {
      const config = this.entityConfigMap.get(param.entityId)
      if (!config || config.enabled === false) {
        continue
      }

      const buildContext: SearchBuildContext = {
        record: param.record,
        customFields: param.customFields ?? {},
        organizationId: param.organizationId,
        tenantId: param.tenantId,
      }

      let presenter: SearchResultPresenter | undefined
      if (config.formatResult) {
        try {
          const result = await config.formatResult(buildContext)
          if (result) presenter = result
        } catch {
          // Skip presenter on error
        }
      }

      let url: string | undefined
      if (config.resolveUrl) {
        try {
          const result = await config.resolveUrl(buildContext)
          if (result) url = result
        } catch {
          // Skip URL on error
        }
      }

      let links: SearchResultLink[] | undefined
      if (config.resolveLinks) {
        try {
          const result = await config.resolveLinks(buildContext)
          if (result) links = result
        } catch {
          // Skip links on error
        }
      }

      indexableRecords.push({
        entityId: param.entityId,
        recordId: param.recordId,
        tenantId: param.tenantId,
        organizationId: param.organizationId,
        fields: param.record,
        presenter,
        url,
        links,
      })
    }

    if (indexableRecords.length > 0) {
      await this.searchService.bulkIndex(indexableRecords)
    }
  }
}
