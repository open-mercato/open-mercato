import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import {
  type VectorModuleConfig,
  type VectorEntityConfig,
  type VectorQueryRequest,
  type VectorSearchHit,
  type VectorIndexSource,
  type VectorDriverId,
  type VectorLinkDescriptor,
  type VectorResultPresenter,
} from '../types'
import type { VectorDriver } from '../types'
import { computeChecksum } from './checksum'
import { EmbeddingService } from './embedding'

type ContainerResolver = () => unknown

export type VectorIndexServiceOptions = {
  drivers: VectorDriver[]
  embeddingService: EmbeddingService
  queryEngine: QueryEngine
  moduleConfigs: VectorModuleConfig[]
  defaultDriverId?: VectorDriverId
  containerResolver?: ContainerResolver
}

type IndexRecordArgs = {
  entityId: EntityId
  recordId: string
  tenantId: string
  organizationId?: string | null
}

type DeleteRecordArgs = {
  entityId: EntityId
  recordId: string
  tenantId: string
}

export class VectorIndexService {
  private readonly driverMap = new Map<VectorDriverId, VectorDriver>()
  private readonly entityConfig = new Map<EntityId, { config: VectorEntityConfig; driverId: VectorDriverId }>()
  private readonly defaultDriverId: VectorDriverId

  constructor(private readonly opts: VectorIndexServiceOptions) {
    for (const driver of opts.drivers) {
      this.driverMap.set(driver.id, driver)
    }
    this.defaultDriverId = opts.defaultDriverId ?? 'pgvector'
    for (const moduleConfig of opts.moduleConfigs) {
      const driverId = moduleConfig.defaultDriverId ?? this.defaultDriverId
      for (const entity of moduleConfig.entities ?? []) {
        if (!entity?.entityId) continue
        if (entity.enabled === false) continue
        const targetDriver = entity.driverId ?? driverId
        this.entityConfig.set(entity.entityId, { config: entity, driverId: targetDriver })
      }
    }
  }

  listEnabledEntities(): EntityId[] {
    return Array.from(this.entityConfig.keys())
  }

  private getDriver(driverId: VectorDriverId): VectorDriver {
    const driver = this.driverMap.get(driverId)
    if (!driver) {
      throw new Error(`[vector] Driver ${driverId} is not registered`)
    }
    return driver
  }

  private async fetchRecord(entityId: EntityId, recordIds: string[], tenantId: string, organizationId?: string | null) {
    const filters: Record<string, any> = { id: { $in: recordIds } }
    const result = await this.opts.queryEngine.query(entityId, {
      tenantId,
      organizationId: organizationId ?? undefined,
      filters,
      includeCustomFields: true,
    })
    const byId = new Map<string, Record<string, any>>()
    for (const item of result.items) {
      const key = String((item as any).id ?? '')
      if (!key) continue
      byId.set(key, item as Record<string, any>)
    }
    return byId
  }

  private extractRecordPayload(raw: Record<string, any>) {
    const record: Record<string, any> = {}
    const customFields: Record<string, any> = {}
    const multiMap = new Map<string, boolean>()

    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith('cf:') && key.endsWith('__is_multi')) {
        const base = key.replace(/__is_multi$/, '')
        multiMap.set(base, Boolean(value))
        continue
      }
      if (key.startsWith('cf:')) {
        customFields[key.slice(3)] = value
        continue
      }
      record[key] = value
    }

    for (const [key, isMulti] of multiMap.entries()) {
      const bare = key.slice(3)
      if (bare && customFields[bare] != null && !Array.isArray(customFields[bare]) && isMulti) {
        customFields[bare] = [customFields[bare]]
      }
    }

    return { record, customFields }
  }

  private async indexExisting(entry: { config: VectorEntityConfig; driverId: VectorDriverId }, driver: VectorDriver, args: IndexRecordArgs, raw: Record<string, any>, opts: { skipDelete?: boolean } = {}): Promise<void> {
    const { record, customFields } = this.extractRecordPayload(raw)
    const source = await this.resolveSource(args.entityId, entry.config, {
      record,
      customFields,
      tenantId: args.tenantId,
      organizationId: args.organizationId ?? null,
    })
    if (!source) {
      if (!opts.skipDelete) {
        await driver.delete(args.entityId, args.recordId, args.tenantId)
      }
      return
    }

    const checksumSource = source.checksumSource ?? { record, customFields }
    const checksum = computeChecksum(checksumSource)
    const current = await driver.getChecksum(args.entityId, args.recordId, args.tenantId)
    if (current && current === checksum) {
      return
    }
    if (!this.opts.embeddingService.available) {
      throw new Error('[vector] Embedding service unavailable (missing OPENAI_API_KEY)')
    }
    const embedding = await this.opts.embeddingService.createEmbedding(source.input)
    const presenter = await this.resolvePresenter(entry.config, {
      record,
      customFields,
      tenantId: args.tenantId,
      organizationId: args.organizationId ?? null,
    }, source.presenter ?? null)
    const links = await this.resolveLinks(entry.config, {
      record,
      customFields,
      tenantId: args.tenantId,
      organizationId: args.organizationId ?? null,
    }, source.links ?? null)
    const url = await this.resolveUrl(entry.config, {
      record,
      customFields,
      tenantId: args.tenantId,
      organizationId: args.organizationId ?? null,
    })

    await driver.upsert({
      driverId: entry.driverId,
      entityId: args.entityId,
      recordId: args.recordId,
      tenantId: args.tenantId,
      organizationId: args.organizationId ?? null,
      checksum,
      embedding,
      url: url ?? null,
      presenter: presenter ?? null,
      links: links ?? null,
      payload: source.payload ?? null,
    })
  }

  private buildDefaultSource(entityId: EntityId, payload: { record: Record<string, any>; customFields: Record<string, any> }): VectorIndexSource {
    const { record, customFields } = payload
    const lines: string[] = []

    const pushEntry = (label: string, value: unknown) => {
      if (value === null || value === undefined) return
      if (typeof value === 'string' && value.trim().length === 0) return
      if (typeof value === 'object') {
        lines.push(`${label}: ${JSON.stringify(value)}`)
      } else {
        lines.push(`${label}: ${value}`)
      }
    }

    const preferredFields = ['title', 'name', 'displayName', 'summary', 'subject']
    for (const field of preferredFields) {
      if (record[field] != null) pushEntry(field, record[field])
    }

    for (const [key, value] of Object.entries(record)) {
      if (preferredFields.includes(key)) continue
      if (key === 'id' || key === 'tenantId' || key === 'organizationId' || key === 'createdAt' || key === 'updatedAt') continue
      pushEntry(key, value)
    }

    for (const [key, value] of Object.entries(customFields)) {
      pushEntry(`custom.${key}`, value)
    }

    if (lines.length === 0) {
      lines.push(`${entityId}#${record.id ?? ''}`)
    }

    return {
      input: lines,
      payload: null,
      checksumSource: { record, customFields },
    }
  }

  private async resolveSource(entityId: EntityId, config: VectorEntityConfig, ctx: {
    record: Record<string, any>
    customFields: Record<string, any>
    organizationId?: string | null
    tenantId: string
  }): Promise<VectorIndexSource | null> {
    const baseCtx = {
      record: ctx.record,
      customFields: ctx.customFields,
      organizationId: ctx.organizationId ?? null,
      tenantId: ctx.tenantId,
      queryEngine: this.opts.queryEngine,
      container: this.opts.containerResolver ? this.opts.containerResolver() : undefined,
    }
    if (config.buildSource) {
      const built = await config.buildSource(baseCtx)
      if (built) return built
      return null
    }
    return this.buildDefaultSource(entityId, { record: ctx.record, customFields: ctx.customFields })
  }

  private async resolvePresenter(
    config: VectorEntityConfig,
    ctx: {
      record: Record<string, any>
      customFields: Record<string, any>
      organizationId?: string | null
      tenantId: string
    },
    fallback?: VectorResultPresenter | null,
  ): Promise<VectorResultPresenter | null> {
    const baseCtx = {
      record: ctx.record,
      customFields: ctx.customFields,
      organizationId: ctx.organizationId ?? null,
      tenantId: ctx.tenantId,
      queryEngine: this.opts.queryEngine,
      container: this.opts.containerResolver ? this.opts.containerResolver() : undefined,
    }
    if (config.formatResult) {
      const formatted = await config.formatResult(baseCtx)
      if (formatted) return formatted
    }
    if (fallback) return fallback
    const nameLike = ctx.record.displayName || ctx.record.title || ctx.record.name
    if (typeof nameLike === 'string' && nameLike.trim().length > 0) {
      const subtitle = ctx.record.description || ctx.record.summary
      return {
        title: nameLike,
        subtitle: typeof subtitle === 'string' ? subtitle : undefined,
      }
    }
    return null
  }

  private async resolveLinks(
    config: VectorEntityConfig,
    ctx: {
      record: Record<string, any>
      customFields: Record<string, any>
      organizationId?: string | null
      tenantId: string
    },
    fallback?: VectorLinkDescriptor[] | null,
  ): Promise<VectorLinkDescriptor[] | null> {
    const baseCtx = {
      record: ctx.record,
      customFields: ctx.customFields,
      organizationId: ctx.organizationId ?? null,
      tenantId: ctx.tenantId,
      queryEngine: this.opts.queryEngine,
      container: this.opts.containerResolver ? this.opts.containerResolver() : undefined,
    }
    if (config.resolveLinks) {
      const resolved = await config.resolveLinks(baseCtx)
      if (resolved?.length) return resolved
    }
    return fallback ?? null
  }

  private async resolveUrl(
    config: VectorEntityConfig,
    ctx: {
      record: Record<string, any>
      customFields: Record<string, any>
      organizationId?: string | null
      tenantId: string
    },
    fallback?: string | null,
  ): Promise<string | null> {
    if (config.resolveUrl) {
      const candidate = await config.resolveUrl({
        record: ctx.record,
        customFields: ctx.customFields,
        organizationId: ctx.organizationId ?? null,
        tenantId: ctx.tenantId,
        queryEngine: this.opts.queryEngine,
        container: this.opts.containerResolver ? this.opts.containerResolver() : undefined,
      })
      if (candidate) return candidate
    }
    return fallback ?? null
  }

  async indexRecord(args: IndexRecordArgs): Promise<void> {
    const entry = this.entityConfig.get(args.entityId)
    if (!entry) return
    const driver = this.getDriver(entry.driverId)
    await driver.ensureReady()

    const records = await this.fetchRecord(args.entityId, [args.recordId], args.tenantId, args.organizationId)
    const raw = records.get(args.recordId)
    if (!raw) {
      await driver.delete(args.entityId, args.recordId, args.tenantId)
      return
    }
    await this.indexExisting(entry, driver, args, raw as Record<string, any>)
  }

  async deleteRecord(args: DeleteRecordArgs): Promise<void> {
    const entry = this.entityConfig.get(args.entityId)
    if (!entry) return
    const driver = this.getDriver(entry.driverId)
    await driver.ensureReady()
    await driver.delete(args.entityId, args.recordId, args.tenantId)
  }

  async reindexEntity(args: { entityId: EntityId; tenantId: string; organizationId?: string | null; purgeFirst?: boolean }): Promise<void> {
    const entry = this.entityConfig.get(args.entityId)
    if (!entry) return
    const driver = this.getDriver(entry.driverId)
    await driver.ensureReady()
    if (args.purgeFirst !== false && driver.purge) {
      await driver.purge(args.entityId, args.tenantId)
    }

    const pageSize = 50
    let page = 1
    for (;;) {
      const result = await this.opts.queryEngine.query(args.entityId, {
        tenantId: args.tenantId,
        organizationId: args.organizationId ?? undefined,
        page: { page, pageSize },
        includeCustomFields: true,
      })
      if (!result.items.length) break
      for (const raw of result.items) {
        const recordId = String((raw as any).id ?? '')
        if (!recordId) continue
        await this.indexExisting(
          entry,
          driver,
          {
            entityId: args.entityId,
            recordId,
            tenantId: args.tenantId,
            organizationId: args.organizationId ?? null,
          },
          raw as Record<string, any>,
          { skipDelete: true },
        )
      }
      if (result.items.length < pageSize) break
      page += 1
    }
  }

  async reindexAll(args: { tenantId: string; organizationId?: string | null; purgeFirst?: boolean }): Promise<void> {
    for (const entityId of this.listEnabledEntities()) {
      await this.reindexEntity({ entityId, tenantId: args.tenantId, organizationId: args.organizationId ?? null, purgeFirst: args.purgeFirst })
    }
  }

  async search(request: VectorQueryRequest): Promise<VectorSearchHit[]> {
    const driverId = request.driverId ?? this.defaultDriverId
    const driver = this.getDriver(driverId)
    await driver.ensureReady()
    if (!this.opts.embeddingService.available) {
      throw new Error('[vector] Embedding service unavailable (missing OPENAI_API_KEY)')
    }
    const embedding = await this.opts.embeddingService.createEmbedding(request.query)
    const hits = await driver.query({
      vector: embedding,
      limit: request.limit ?? 10,
      filter: {
        tenantId: request.tenantId,
        organizationId: request.organizationId ?? null,
        entityIds: undefined,
      },
    })

    if (!hits.length) return []

    const grouped = new Map<EntityId, Set<string>>()
    for (const hit of hits) {
      if (!grouped.has(hit.entityId)) grouped.set(hit.entityId, new Set())
      grouped.get(hit.entityId)!.add(hit.recordId)
    }

    const recordCache = new Map<EntityId, Map<string, Record<string, any>>>()
    for (const [entityId, ids] of grouped.entries()) {
      const entry = this.entityConfig.get(entityId)
      if (!entry) continue
      const map = await this.fetchRecord(entityId, Array.from(ids), request.tenantId, request.organizationId ?? null)
      recordCache.set(entityId, map)
    }

    const results: VectorSearchHit[] = []
    for (const hit of hits) {
      const entry = this.entityConfig.get(hit.entityId)
      if (!entry) continue
      const recordsForEntity = recordCache.get(hit.entityId)
      const raw = recordsForEntity?.get(hit.recordId)
      if (!raw) {
        await driver.delete(hit.entityId, hit.recordId, request.tenantId)
        continue
      }
      const { record, customFields } = this.extractRecordPayload(raw)
      const presenter = await this.resolvePresenter(entry.config, {
        record,
        customFields,
        tenantId: request.tenantId,
        organizationId: request.organizationId ?? null,
      }, hit.presenter ?? null)
      const links = await this.resolveLinks(entry.config, {
        record,
        customFields,
        tenantId: request.tenantId,
        organizationId: request.organizationId ?? null,
      }, hit.links ?? null)
      const url = await this.resolveUrl(entry.config, {
        record,
        customFields,
        tenantId: request.tenantId,
        organizationId: request.organizationId ?? null,
      }, hit.url ?? null)
      results.push({
        entityId: hit.entityId,
        recordId: hit.recordId,
        score: hit.score,
        url: url ?? null,
        presenter: presenter ?? null,
        links: links ?? null,
        driverId,
        metadata: hit.payload ?? null,
      })
    }
    return results
  }
}
