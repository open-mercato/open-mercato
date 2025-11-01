import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityManager } from '@mikro-orm/postgresql'
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
  type VectorIndexEntry,
} from '../types'
import type { VectorDriver } from '../types'
import { computeChecksum } from './checksum'
import { EmbeddingService } from './embedding'
import { logVectorOperation } from '../lib/vector-logs'

type ContainerResolver = () => unknown

const ENRICHMENT_FIELD_HINTS: Record<EntityId, string[]> = {
  'customers:customer_entity': [
    'id',
    'display_name',
    'description',
    'status',
    'lifecycle_stage',
    'primary_email',
    'primary_phone',
    'kind',
    'customer_kind',
  ],
  'customers:customer_comment': ['id', 'entity_id', 'body', 'appearance_icon', 'appearance_color'],
  'customers:customer_activity': ['id', 'entity_id', 'activity_type', 'subject', 'body', 'deal_id'],
  'customers:customer_deal': ['id', 'title', 'pipeline_stage', 'status', 'value_amount', 'value_currency'],
  'customers:customer_todo_link': ['id', 'entity_id', 'todo_id', 'todo_source'],
  'customers:customer_person_profile': [
    'id',
    'entity_id',
    'first_name',
    'last_name',
    'preferred_name',
    'job_title',
    'department',
  ],
  'customers:customer_company_profile': [
    'id',
    'entity_id',
    'brand_name',
    'legal_name',
    'domain',
    'industry',
    'size_bucket',
  ],
}

export type VectorIndexServiceOptions = {
  drivers: VectorDriver[]
  embeddingService: EmbeddingService
  queryEngine: QueryEngine
  moduleConfigs: VectorModuleConfig[]
  defaultDriverId?: VectorDriverId
  containerResolver?: ContainerResolver
  eventBus?: {
    emitEvent(event: string, payload: any, options?: any): Promise<void>
  }
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
  organizationId?: string | null
}

export type VectorIndexOperationResult = {
  action: 'indexed' | 'deleted' | 'skipped'
  created?: boolean
  existed?: boolean
  tenantId: string
  organizationId: string | null
  reason?: 'unsupported' | 'missing_record' | 'checksum_match'
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

  async ensureDriverReady(entityId?: EntityId): Promise<void> {
    if (entityId) {
      const entry = this.entityConfig.get(entityId)
      if (!entry) return
      const driver = this.getDriver(entry.driverId)
      await driver.ensureReady()
      return
    }
    const uniqueDrivers = new Set<VectorDriverId>()
    for (const entry of this.entityConfig.values()) {
      uniqueDrivers.add(entry.driverId)
    }
    if (!uniqueDrivers.size) uniqueDrivers.add(this.defaultDriverId)
    await Promise.all(Array.from(uniqueDrivers).map(async (driverId) => {
      try {
        const driver = this.getDriver(driverId)
        await driver.ensureReady()
      } catch (err) {
        console.warn('[vector] Failed to ensure driver readiness', { driverId, error: err instanceof Error ? err.message : err })
      }
    }))
  }

  private getDriver(driverId: VectorDriverId): VectorDriver {
    const driver = this.driverMap.get(driverId)
    if (!driver) {
      throw new Error(`[vector] Driver ${driverId} is not registered`)
    }
    return driver
  }

  private getEnrichmentFields(entityId: EntityId): string[] | undefined {
    const hints = ENRICHMENT_FIELD_HINTS[entityId]
    if (!hints) return undefined
    const unique = new Set<string>(['id', ...hints])
    return Array.from(unique)
  }

  private async fetchRecord(entityId: EntityId, recordIds: string[], tenantId: string, organizationId?: string | null) {
    const filters: Record<string, any> = { id: { $in: recordIds } }
    const result = await this.opts.queryEngine.query(entityId, {
      tenantId,
      organizationId: organizationId ?? undefined,
      filters,
      includeCustomFields: true,
      fields: this.getEnrichmentFields(entityId),
    })
    const byId = new Map<string, Record<string, any>>()
    for (const item of result.items) {
      const key = String((item as any).id ?? '')
      if (!key) continue
      byId.set(key, item as Record<string, any>)
    }
    return byId
  }

  private extractRecordPayload(entityId: EntityId, raw: Record<string, any>) {
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

    if (record.entity_id == null && record.entityId == null && entityId.endsWith('_company_profile')) {
      console.warn('[vector.index] company profile missing entity id in payload', {
        id: record.id,
        keys: Object.keys(record),
      })
    }

    return { record, customFields }
  }

  private async indexExisting(
    entry: { config: VectorEntityConfig; driverId: VectorDriverId },
    driver: VectorDriver,
    args: IndexRecordArgs,
    raw: Record<string, any>,
    opts: { skipDelete?: boolean } = {},
  ): Promise<VectorIndexOperationResult> {
    const scopeOrg = args.organizationId ?? null
    const { record, customFields } = this.extractRecordPayload(args.entityId, raw)
    const source = await this.resolveSource(args.entityId, entry.config, {
      record,
      customFields,
      tenantId: args.tenantId,
      organizationId: scopeOrg,
    })
    if (!source) {
      const existing = await driver.getChecksum(args.entityId, args.recordId, args.tenantId)
      if (!opts.skipDelete && existing) {
        await driver.delete(args.entityId, args.recordId, args.tenantId)
        return {
          action: 'deleted',
          existed: true,
          tenantId: args.tenantId,
          organizationId: scopeOrg,
        }
      }
      return {
        action: 'skipped',
        existed: Boolean(existing),
        tenantId: args.tenantId,
        organizationId: scopeOrg,
        reason: 'missing_record',
      }
    }

    const checksumSource = source.checksumSource ?? { record, customFields }
    const checksum = computeChecksum(checksumSource)
    const current = await driver.getChecksum(args.entityId, args.recordId, args.tenantId)
    if (current && current === checksum) {
      return {
        action: 'skipped',
        existed: true,
        tenantId: args.tenantId,
        organizationId: scopeOrg,
        reason: 'checksum_match',
      }
    }
    if (!this.opts.embeddingService.available) {
      throw new Error('[vector] Embedding service unavailable (missing OPENAI_API_KEY)')
    }
    const embedding = await this.opts.embeddingService.createEmbedding(source.input)
    const presenter = await this.resolvePresenter(entry.config, {
      record,
      customFields,
      tenantId: args.tenantId,
      organizationId: scopeOrg,
    }, source.presenter ?? null)
    if (!presenter?.title) {
      if (process.env.VECTOR_DEBUG === '1') {
        console.warn('[vector.index] missing presenter title', {
          entityId: args.entityId,
          recordId: args.recordId,
          recordSample: {
            display_name: record.display_name,
            displayName: record.displayName,
            name: record.name,
            title: record.title,
            subject: record.subject,
            kind: record.kind,
          },
        })
      }
    }
    const links = await this.resolveLinks(entry.config, {
      record,
      customFields,
      tenantId: args.tenantId,
      organizationId: scopeOrg,
    }, source.links ?? null)
    const url = await this.resolveUrl(entry.config, {
      record,
      customFields,
      tenantId: args.tenantId,
      organizationId: scopeOrg,
    })

    const normalizedPresenter = this.ensurePresenter(presenter, record, customFields, args.recordId, args.entityId)
    const normalizedLinks = Array.isArray(links) && links.length ? links : null
    const snapshot = this.deriveSnapshot(record, customFields)
    const resultTitle = this.resolveResultTitle(normalizedPresenter, record, customFields, args.recordId)
    const resultSubtitle = normalizedPresenter.subtitle ?? snapshot ?? null
    const resultIcon = normalizedPresenter.icon ?? this.mapDefaultIcon(args.entityId)
    const resultBadge = normalizedPresenter.badge ?? null
    const primaryLink = this.resolvePrimaryLink(normalizedLinks, url, resultTitle)

    const presenterForStorage: VectorResultPresenter = {
      title: resultTitle,
      subtitle: resultSubtitle ?? undefined,
      icon: resultIcon ?? undefined,
      badge: resultBadge ?? undefined,
    }

    await driver.upsert({
      driverId: entry.driverId,
      entityId: args.entityId,
      recordId: args.recordId,
      tenantId: args.tenantId,
      organizationId: scopeOrg,
      checksum,
      embedding,
      url: url ?? null,
      presenter: presenterForStorage,
      links: normalizedLinks,
      payload: source.payload ?? null,
      resultTitle,
      resultSubtitle,
      resultIcon: resultIcon ?? null,
      resultBadge,
      resultSnapshot: snapshot,
      primaryLinkHref: primaryLink?.href ?? null,
      primaryLinkLabel: primaryLink?.label ?? null,
    })

    return {
      action: 'indexed',
      created: !current,
      existed: true,
      tenantId: args.tenantId,
      organizationId: scopeOrg,
    }
  }

  private ensurePresenter(
    presenter: VectorResultPresenter | null,
    record: Record<string, any>,
    customFields: Record<string, any>,
    recordId: string,
    entityId: EntityId,
  ): VectorResultPresenter {
    if (presenter?.title) return presenter
    const fallback = this.buildFallbackPresenter(record, customFields, recordId, entityId)
    return fallback
  }

  private resolveResultTitle(
    presenter: VectorResultPresenter,
    record: Record<string, any>,
    customFields: Record<string, any>,
    recordId: string,
  ): string {
    const candidate =
      presenter.title ??
      record.display_name ??
      record.displayName ??
      record.name ??
      record.title ??
      record.subject ??
      customFields.title ??
      customFields.name ??
      recordId
    const text = String(candidate).trim()
    return text.length ? text : recordId
  }

  private buildFallbackPresenter(
    record: Record<string, any>,
    customFields: Record<string, any>,
    recordId: string,
    entityId: EntityId,
  ): VectorResultPresenter {
    const titleCandidate =
      record.display_name ??
      record.displayName ??
      record.name ??
      record.title ??
      record.subject ??
      recordId
    const subtitleCandidate =
      record.description ??
      record.summary ??
      record.body ??
      customFields.summary ??
      customFields.description ??
      null
    const icon = typeof record.kind === 'string'
      ? this.mapEntityIcon(record.kind)
      : this.mapDefaultIcon(entityId)
    return {
      title: String(titleCandidate),
      subtitle: subtitleCandidate ? String(subtitleCandidate) : undefined,
      icon: icon ?? undefined,
    }
  }

  private mapEntityIcon(kind?: string | null): string | null {
    if (!kind) return null
    const normalized = kind.toLowerCase()
    if (normalized === 'person') return 'user'
    if (normalized === 'company' || normalized === 'organization') return 'building'
    return null
  }

  private mapDefaultIcon(entityId: EntityId): string | null {
    if (entityId.startsWith('customers:customer_deal')) return 'briefcase'
    if (entityId.startsWith('customers:customer_comment')) return 'sticky-note'
    if (entityId.startsWith('customers:customer_activity')) return 'bolt'
    if (entityId.startsWith('customers:customer_todo')) return 'check-square'
    return null
  }

  private resolvePrimaryLink(
    links: VectorLinkDescriptor[] | null,
    url: string | null,
    fallbackLabel: string,
  ): { href: string; label: string } | null {
    if (links?.length) {
      const primary = links.find((link) => link.kind === 'primary') ?? links[0]
      if (primary?.href) {
        return { href: primary.href, label: primary.label ?? fallbackLabel }
      }
    }
    if (url) {
      return { href: url, label: fallbackLabel }
    }
    return null
  }

  private deriveSnapshot(
    record: Record<string, any>,
    customFields: Record<string, any>,
  ): string | null {
    const candidates = [
      record.summary,
      record.description,
      record.body,
      customFields.summary,
      customFields.description,
      customFields.body,
    ]
    for (const value of candidates) {
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed.length) return trimmed
      }
    }
    return null
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

  async indexRecord(args: IndexRecordArgs): Promise<VectorIndexOperationResult> {
    const entry = this.entityConfig.get(args.entityId)
    if (!entry) {
      return {
        action: 'skipped',
        existed: false,
        tenantId: args.tenantId,
        organizationId: args.organizationId ?? null,
        reason: 'unsupported',
      }
    }
    const driver = this.getDriver(entry.driverId)
    await driver.ensureReady()

    const records = await this.fetchRecord(args.entityId, [args.recordId], args.tenantId, args.organizationId)
    const raw = records.get(args.recordId)
    if (!raw) {
      const existing = await driver.getChecksum(args.entityId, args.recordId, args.tenantId)
      if (existing) {
        await driver.delete(args.entityId, args.recordId, args.tenantId)
        return {
          action: 'deleted',
          existed: true,
          tenantId: args.tenantId,
          organizationId: args.organizationId ?? null,
        }
      }
      return {
        action: 'skipped',
        existed: false,
        tenantId: args.tenantId,
        organizationId: args.organizationId ?? null,
        reason: 'missing_record',
      }
    }
    return this.indexExisting(entry, driver, args, raw as Record<string, any>)
  }

  async deleteRecord(args: DeleteRecordArgs): Promise<VectorIndexOperationResult> {
    const entry = this.entityConfig.get(args.entityId)
    if (!entry) {
      return {
        action: 'skipped',
        existed: false,
        tenantId: args.tenantId,
        organizationId: args.organizationId ?? null,
        reason: 'unsupported',
      }
    }
    const driver = this.getDriver(entry.driverId)
    await driver.ensureReady()
    const scopeOrg = args.organizationId ?? null
    const existing = await driver.getChecksum(args.entityId, args.recordId, args.tenantId)
    if (existing) {
      await driver.delete(args.entityId, args.recordId, args.tenantId)
      return {
        action: 'deleted',
        existed: true,
        tenantId: args.tenantId,
        organizationId: scopeOrg,
      }
    }
    return {
      action: 'skipped',
      existed: false,
      tenantId: args.tenantId,
      organizationId: scopeOrg,
      reason: 'missing_record',
    }
  }

  async reindexEntity(args: { entityId: EntityId; tenantId?: string | null; organizationId?: string | null; purgeFirst?: boolean }): Promise<void> {
    const entry = this.entityConfig.get(args.entityId)
    if (!entry) return
    const driver = this.getDriver(entry.driverId)
    await driver.ensureReady()

    const shouldPurge = args.purgeFirst === true
    const reindexStartedAt = new Date()

    if (this.opts.eventBus) {
      if (shouldPurge && driver.purge && args.tenantId) {
        await driver.purge(args.entityId, args.tenantId)
      } else if (shouldPurge && !args.tenantId) {
        console.warn('[vector] Skipping purge for multi-tenant reindex (tenant not provided)')
      }
      const payload: Record<string, unknown> = {
        entityType: args.entityId,
      }
      if (shouldPurge) {
        payload.force = true
        payload.resetCoverage = true
      }
      if (args.tenantId !== undefined) payload.tenantId = args.tenantId
      if (args.organizationId !== undefined) payload.organizationId = args.organizationId
      await this.opts.eventBus.emitEvent('query_index.reindex', payload)
      return
    }

    if (!args.tenantId) {
      throw new Error('[vector] Reindex without tenantId requires event bus integration')
    }

    if (shouldPurge && driver.purge) {
      await driver.purge(args.entityId, args.tenantId)
    }

    const pageSize = 50
    let page = 1
    const loggingEm = this.resolveEntityManager()
    for (;;) {
      const result = await this.opts.queryEngine.query(args.entityId, {
        tenantId: args.tenantId,
        organizationId: args.organizationId ?? undefined,
        page: { page, pageSize },
        includeCustomFields: true,
        fields: this.getEnrichmentFields(args.entityId),
      })
      if (!result.items.length) break
      for (const raw of result.items) {
        const recordId = String((raw as any).id ?? '')
        if (!recordId) continue
        const opResult = await this.indexExisting(
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
        await logVectorOperation({
          em: loggingEm,
          handler: 'service:vector.reindex',
          entityType: args.entityId,
          recordId,
          result: opResult,
        })
      }
      if (result.items.length < pageSize) break
      page += 1
    }

    if (shouldPurge) {
      await this.removeOrphans({
        entityId: args.entityId,
        tenantId: args.tenantId,
        organizationId: args.organizationId,
        olderThan: reindexStartedAt,
      })
    }
  }

  async reindexAll(args: { tenantId?: string | null; organizationId?: string | null; purgeFirst?: boolean }): Promise<void> {
    for (const entityId of this.listEnabledEntities()) {
      await this.reindexEntity({ entityId, tenantId: args.tenantId, organizationId: args.organizationId ?? null, purgeFirst: args.purgeFirst })
    }
  }

  private resolveEntityManager(): EntityManager | null {
    if (!this.opts.containerResolver) return null
    try {
      const container = this.opts.containerResolver()
      if (!container || typeof (container as any).resolve !== 'function') return null
      const resolver = container as { resolve(name: string): unknown }
      const em = resolver.resolve('em')
      return (em as EntityManager | null) ?? null
    } catch {
      return null
    }
  }

  async purgeIndex(args: { tenantId: string; organizationId?: string | null; entityId?: EntityId | null }): Promise<void> {
    const targets = args.entityId ? [args.entityId] : this.listEnabledEntities()
    if (!targets.length) return

    const grouped = new Map<VectorDriverId, EntityId[]>()
    for (const entityId of targets) {
      const cfg = this.entityConfig.get(entityId)
      if (!cfg) continue
      const driver = this.getDriver(cfg.driverId)
      if (typeof driver.purge !== 'function') {
        throw new Error(`[vector] Driver ${cfg.driverId} does not support purging entities`)
      }
      if (!grouped.has(cfg.driverId)) grouped.set(cfg.driverId, [])
      grouped.get(cfg.driverId)!.push(entityId)
    }

    for (const [driverId, entityIds] of grouped.entries()) {
      const driver = this.getDriver(driverId)
      await driver.ensureReady()
      for (const entityId of entityIds) {
        await driver.purge!(entityId, args.tenantId)
      }
    }
  }

  async removeOrphans(args: {
    entityId: EntityId
    tenantId?: string | null
    organizationId?: string | null
    olderThan: Date
  }): Promise<number> {
    const entry = this.entityConfig.get(args.entityId)
    if (!entry) return 0
    const driver = this.getDriver(entry.driverId)
    await driver.ensureReady()

    const driverAny = driver as VectorDriver & {
      removeOrphans?: (params: {
        entityId: EntityId
        tenantId?: string | null
        organizationId?: string | null
        olderThan: Date
      }) => Promise<number | void>
    }

    if (typeof driverAny.removeOrphans === 'function') {
      const deleted = await driverAny.removeOrphans({
        entityId: args.entityId,
        tenantId: args.tenantId,
        organizationId: args.organizationId,
        olderThan: args.olderThan,
      })
      return typeof deleted === 'number' ? deleted : 0
    }

    console.warn('[vector] Driver does not support orphan cleanup', { driverId: entry.driverId })
    return 0
  }

  async countIndexEntries(args: {
    tenantId: string
    organizationId?: string | null
    entityId?: EntityId
    driverId?: VectorDriverId
  }): Promise<number> {
    if (!args.tenantId) return 0
    const targetEntity = args.entityId ? this.entityConfig.get(args.entityId) : null
    if (args.entityId && !targetEntity) {
      return 0
    }
    const driverId =
      args.driverId ??
      (targetEntity ? targetEntity.driverId : this.defaultDriverId)
    const driver = this.getDriver(driverId)
    await driver.ensureReady()
    const countParams = {
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      entityId: args.entityId,
    }
    if (typeof driver.count === 'function') {
      try {
        return await driver.count(countParams)
      } catch (err) {
        console.warn('[vector] Driver count failed, falling back to list', {
          driverId,
          error: err instanceof Error ? err.message : err,
        })
      }
    }
    if (typeof driver.list === 'function') {
      const limit = 1000
      let offset = 0
      let total = 0
      for (;;) {
        const batch = await driver.list({
          tenantId: countParams.tenantId,
          organizationId: countParams.organizationId,
          entityId: countParams.entityId,
          limit,
          offset,
          orderBy: 'created',
        })
        const size = batch.length
        total += size
        if (size < limit) break
        offset += limit
      }
      return total
    }
    console.warn('[vector] Driver does not support counting or listing index entries', { driverId })
    return 0
  }

  async listIndexEntries(args: {
    tenantId: string
    organizationId?: string | null
    entityId?: EntityId
    limit?: number
    offset?: number
    driverId?: VectorDriverId
  }): Promise<VectorIndexEntry[]> {
    const targetEntity = args.entityId ? this.entityConfig.get(args.entityId) : null
    if (args.entityId && !targetEntity) {
      return []
    }
    const driverId =
      args.driverId ??
      (targetEntity ? targetEntity.driverId : this.defaultDriverId)
    const driver = this.getDriver(driverId)
    if (typeof driver.list !== 'function') {
      throw new Error(`[vector] Driver ${driverId} does not support listing index entries`)
    }
    await driver.ensureReady()
    const list = await driver.list({
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      entityId: args.entityId,
      limit: args.limit,
      offset: args.offset,
      orderBy: 'updated',
    })
    if (!list.length) {
      return []
    }

    return list.map((entry) => {
      const presenter = entry.presenter ?? {
        title: entry.resultTitle,
        subtitle: entry.resultSubtitle ?? undefined,
        icon: entry.resultIcon ?? undefined,
        badge: entry.resultBadge ?? undefined,
      }
      const links = entry.links ?? (entry.primaryLinkHref
        ? [{ href: entry.primaryLinkHref, label: entry.primaryLinkLabel ?? entry.resultTitle, kind: 'primary' as const }]
        : null)
      const url = entry.url ?? entry.primaryLinkHref ?? null
      const metadata = entry.metadata ?? (entry.resultSnapshot ? { snapshot: entry.resultSnapshot } : null)
      return {
        ...entry,
        driverId,
        presenter,
        links,
        url,
        metadata,
        score: entry.score ?? null,
      }
    })
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

    return hits.map((hit) => {
      const presenter = hit.presenter ?? {
        title: hit.resultTitle,
        subtitle: hit.resultSubtitle ?? undefined,
        icon: hit.resultIcon ?? undefined,
        badge: hit.resultBadge ?? undefined,
      }
      const links = hit.links ?? (hit.primaryLinkHref
        ? [{ href: hit.primaryLinkHref, label: hit.primaryLinkLabel ?? hit.resultTitle, kind: 'primary' as const }]
        : null)
      const url = hit.url ?? hit.primaryLinkHref ?? null
      const metadata = hit.payload ?? (hit.resultSnapshot ? { snapshot: hit.resultSnapshot } : null)
      return {
        entityId: hit.entityId,
        recordId: hit.recordId,
        score: hit.score,
        url,
        presenter,
        links,
        driverId,
        metadata,
      }
    })
  }
}
