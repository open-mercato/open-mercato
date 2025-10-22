import { createHash } from 'node:crypto'
import { embed } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { VectorSearchRecord } from '../data/entities'
import { buildIndexDoc } from '@open-mercato/core/modules/query_index/lib/indexer'
import { resolveVectorSearchConfigs } from '../lib/registry'
import type {
  VectorSearchBuildResult,
  VectorSearchEntityConfig,
} from '@open-mercato/shared/modules/vector-search'

type UpsertPayload = {
  entityType: string
  recordId: string
  organizationId?: string | null
  tenantId?: string | null
}

type DeletePayload = {
  entityType: string
  recordId: string
  organizationId?: string | null
  tenantId?: string | null
}

type SearchOptions = {
  tenantId?: string | null
  organizationId?: string | null
  limit?: number
}

export type VectorSearchResult = {
  id: string
  entityType: string
  recordId: string
  moduleId: string
  title: string
  lead: string | null
  icon: string | null
  url: string
  links: VectorSearchRecord['links'] | null
  payload: Record<string, unknown> | null
  similarity: number
}

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_EMBEDDING_DIMENSIONS = 1536

export class VectorSearchService {
  private readonly registry: Map<string, VectorSearchEntityConfig>
  private openAIClient: ReturnType<typeof createOpenAI> | null = null
  private tableReady = false

  constructor(private readonly em: EntityManager) {
    this.registry = resolveVectorSearchConfigs()
  }

  async upsertFromIndexEvent(payload: UpsertPayload): Promise<void> {
    const entityType = payload.entityType
    const config = this.registry.get(entityType)
    if (!config) return

    const knex = this.getKnex()
    const doc = await buildIndexDoc(this.em, {
      entityType,
      recordId: payload.recordId,
      organizationId: payload.organizationId ?? null,
      tenantId: payload.tenantId ?? null,
    })
    if (!doc) {
      await this.markDeleted({
        entityType,
        recordId: payload.recordId,
        organizationId: payload.organizationId ?? null,
        tenantId: payload.tenantId ?? null,
      })
      return
    }

    const buildResult = await this.safeBuild(config, {
      entity: entityType,
      recordId: payload.recordId,
      organizationId: payload.organizationId ?? null,
      tenantId: payload.tenantId ?? null,
      em: this.em,
      knex,
      indexDoc: doc,
    })
    if (!buildResult) {
      await this.markDeleted({
        entityType,
        recordId: payload.recordId,
        organizationId: payload.organizationId ?? null,
        tenantId: payload.tenantId ?? null,
      })
      return
    }

    const combinedText = this.combineText(buildResult, doc, config.includeIndexDoc !== false)
    if (!combinedText.trim().length) {
      await this.markDeleted({
        entityType,
        recordId: payload.recordId,
        organizationId: payload.organizationId ?? null,
        tenantId: payload.tenantId ?? null,
      })
      return
    }

    const checksum = this.computeChecksum({
      entityType,
      recordId: payload.recordId,
      organizationId: payload.organizationId ?? null,
      tenantId: payload.tenantId ?? null,
      buildResult,
      combinedText,
    })

    if (!(await this.ensureTable(knex))) return

    const scopeQuery = this.scopeQuery(knex, {
      entityType,
      recordId: payload.recordId,
      organizationId: payload.organizationId ?? null,
      tenantId: payload.tenantId ?? null,
    })
    const existing = await scopeQuery.clone().first()

    const moduleId = entityType.split(':')[0] ?? 'unknown'
    const payloadJson = {
      metadata: buildResult.metadata ?? null,
      indexDoc: doc,
    }

    const shouldEmbed = checksum !== existing?.checksum || !existing?.embedding
    let embeddingVector: number[] | null = null
    let embeddingModel = existing?.embedding_model ?? config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL
    let embeddingDimensions = existing?.embedding_dimensions ?? config.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS
    let embeddingError: string | null = null

    if (shouldEmbed) {
      const embedding = await this.tryEmbed(combinedText, config.embeddingModel, config.embeddingDimensions)
      embeddingVector = embedding?.vector ?? null
      embeddingModel = embedding?.model ?? embeddingModel
      embeddingDimensions = embedding?.dimensions ?? embeddingDimensions
      embeddingError = embedding?.error ?? null
    }

    const recordPayload: Record<string, unknown> = {
      entity_type: entityType,
      record_id: payload.recordId,
      module_id: moduleId,
      organization_id: payload.organizationId ?? null,
      tenant_id: payload.tenantId ?? null,
      title: buildResult.title,
      lead: buildResult.lead ?? null,
      icon: buildResult.icon ?? null,
      primary_url: buildResult.url,
      links: buildResult.links ?? null,
      search_terms: buildResult.searchTerms ?? null,
      payload: payloadJson,
      combined_text: combinedText,
      embedding_model: embeddingModel ?? null,
      embedding_dimensions: embeddingDimensions ?? null,
      checksum,
      embedding_error: embeddingError,
      deleted_at: null,
      updated_at: knex.fn.now(),
      last_indexed_at: knex.fn.now(),
    }

    if (embeddingVector && embeddingVector.length) {
      recordPayload.embedding = knex.raw('?::vector', [this.formatVector(embeddingVector)])
    } else if (shouldEmbed) {
      recordPayload.embedding = null
    }

    const insertPayload = { ...recordPayload, created_at: knex.fn.now() }

    try {
      await knex('vector_search_records')
        .insert(insertPayload)
        .onConflict(['entity_type', 'record_id', 'organization_id', 'tenant_id'])
        .merge(recordPayload)
    } catch (error) {
      // Fallback for databases without multi-column conflict target support
      await scopeQuery
        .clone()
        .update(recordPayload)
      const exists = await scopeQuery.clone().first()
      if (!exists) {
        await knex('vector_search_records').insert(insertPayload)
      }
    }
  }

  async markDeleted(payload: DeletePayload): Promise<void> {
    const knex = this.getKnex()
    if (!(await this.ensureTable(knex))) return
    await this.scopeQuery(knex, payload)
      .update({
        deleted_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
  }

  async search(query: string, opts: SearchOptions = {}): Promise<VectorSearchResult[]> {
    const sanitized = typeof query === 'string' ? query.trim() : ''
    if (!sanitized.length) return []

    const knex = this.getKnex()
    if (!(await this.ensureTable(knex))) return []
    const limit = Math.min(Math.max(opts.limit ?? 8, 1), 50)

    const embedding = await this.tryEmbed(sanitized, undefined, undefined)
    const baseQuery = knex('vector_search_records')
      .select([
        'id',
        'entity_type',
        'record_id',
        'module_id',
        'title',
        'lead',
        'icon',
        'primary_url',
        'links',
        'payload',
      ])
      .whereNull('deleted_at')

    if (opts.organizationId) baseQuery.andWhere('organization_id', opts.organizationId)
    if (opts.organizationId === null) baseQuery.andWhereNull('organization_id')
    if (opts.tenantId) baseQuery.andWhere('tenant_id', opts.tenantId)
    if (opts.tenantId === null) baseQuery.andWhereNull('tenant_id')

    if (embedding?.vector && embedding.vector.length) {
      const literal = this.formatVector(embedding.vector)
      baseQuery
        .select(knex.raw('1 - ("embedding" <=> ?::vector) as similarity', [literal]))
        .whereNotNull('embedding')
        .orderByRaw('"embedding" <=> ?::vector', [literal])
        .limit(limit)
    } else {
      baseQuery
        .select(knex.raw('0.0 as similarity'))
        .orderBy('updated_at', 'desc')
        .limit(limit)
        .andWhere((qb) => {
          qb.whereILike('title', `%${sanitized}%`)
            .orWhereILike('combined_text', `%${sanitized}%`)
        })
    }

    const rows = await baseQuery
    return rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      recordId: row.record_id,
      moduleId: row.module_id,
      title: row.title,
      lead: row.lead ?? null,
      icon: row.icon ?? null,
      url: row.primary_url,
      links: row.links ?? null,
      payload: row.payload ?? null,
      similarity: typeof row.similarity === 'number' ? row.similarity : 0,
    }))
  }

  async list(params: { page: number; pageSize: number; query?: string | null; tenantId?: string | null; organizationId?: string | null }) {
    const knex = this.getKnex()
    if (!(await this.ensureTable(knex))) {
      return { items: [], total: 0, page: Math.max(params.page, 1), pageSize: Math.max(Math.min(params.pageSize, 100), 1) }
    }
    const page = Math.max(params.page, 1)
    const pageSize = Math.max(Math.min(params.pageSize, 100), 1)
    const offset = (page - 1) * pageSize

    const base = knex('vector_search_records')
      .whereNull('deleted_at')
      .modify((qb) => {
        if (params.organizationId) qb.andWhere('organization_id', params.organizationId)
        else if (params.organizationId === null) qb.andWhereNull('organization_id')
        if (params.tenantId) qb.andWhere('tenant_id', params.tenantId)
        else if (params.tenantId === null) qb.andWhereNull('tenant_id')
      })

    let itemsQuery = base.clone()
      .select([
        'id',
        'entity_type',
        'record_id',
        'module_id',
        'title',
        'lead',
        'icon',
        'primary_url',
        'links',
        'search_terms',
        'embedding_model',
        'embedding_dimensions',
        'embedding_error',
        'last_indexed_at',
        'updated_at',
      ])
      .limit(pageSize)
      .offset(offset)

    let countQuery = base.clone()

    if (params.query && params.query.trim().length) {
      const search = params.query.trim()
      const embedding = await this.tryEmbed(search, undefined, undefined)

      if (embedding?.vector && embedding.vector.length) {
        const literal = this.formatVector(embedding.vector)
        itemsQuery = itemsQuery
          .whereNotNull('embedding')
          .select(knex.raw('1 - ("embedding" <=> ?::vector) as similarity', [literal]))
          .orderByRaw('"embedding" <=> ?::vector', [literal])
          .orderBy('updated_at', 'desc')
        countQuery = countQuery.whereNotNull('embedding')
      } else {
        itemsQuery = itemsQuery
          .select(knex.raw('0.0 as similarity'))
          .orderBy('updated_at', 'desc')
          .andWhere((qb) => {
            qb.whereILike('title', `%${search}%`)
              .orWhereILike('combined_text', `%${search}%`)
              .orWhereRaw('exists (select 1 from jsonb_array_elements_text(coalesce(search_terms, \'[]\'::jsonb)) as term where term ilike ?)', [`%${search}%`])
          })
        countQuery = countQuery.andWhere((qb) => {
          qb.whereILike('title', `%${search}%`)
            .orWhereILike('combined_text', `%${search}%`)
            .orWhereRaw('exists (select 1 from jsonb_array_elements_text(coalesce(search_terms, \'[]\'::jsonb)) as term where term ilike ?)', [`%${search}%`])
        })
      }
    } else {
      itemsQuery = itemsQuery
        .select(knex.raw('0.0 as similarity'))
        .orderBy('updated_at', 'desc')
    }

    const [items, totalRow] = await Promise.all([
      itemsQuery,
      countQuery.count<{ count: string }>('id as count').first(),
    ])

    const total = totalRow ? Number(totalRow.count) || 0 : 0

    return {
      items,
      total,
      page,
      pageSize,
    }
  }

  hasEmbeddingSupport(): boolean {
    return this.resolveApiKey() != null
  }

  private async safeBuild(config: VectorSearchEntityConfig, ctx: Parameters<VectorSearchEntityConfig['build']>[0]): Promise<VectorSearchBuildResult | null> {
    try {
      const result = await config.build(ctx)
      if (!result) return null
      return {
        title: result.title,
        lead: result.lead ?? null,
        icon: result.icon ?? null,
        url: result.url,
        urlLabel: result.urlLabel ?? null,
        links: result.links ?? null,
        text: result.text,
        extraTexts: result.extraTexts ?? [],
        metadata: result.metadata ?? undefined,
        searchTerms: result.searchTerms ?? undefined,
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[vector_search] build failed', error)
      return null
    }
  }

  private combineText(result: VectorSearchBuildResult, doc: Record<string, unknown>, includeDoc: boolean): string {
    const parts: string[] = []
    if (result.text) {
      if (Array.isArray(result.text)) {
        for (const chunk of result.text) {
          if (typeof chunk === 'string' && chunk.trim().length) parts.push(chunk.trim())
        }
      } else if (typeof result.text === 'string') {
        parts.push(result.text.trim())
      }
    }
    if (Array.isArray(result.extraTexts)) {
      for (const chunk of result.extraTexts) {
        if (typeof chunk === 'string' && chunk.trim().length) parts.push(chunk.trim())
      }
    }
    if (includeDoc) {
      const docText = this.stringifyDoc(doc)
      if (docText.trim().length) parts.push(docText)
    }
    return parts.join('\n\n')
  }

  private stringifyDoc(input: Record<string, unknown>): string {
    const entries = Object.entries(input ?? {})
    return entries
      .map(([key, value]) => {
        if (value === null || value === undefined) return ''
        if (typeof value === 'object') {
          return `${key}: ${JSON.stringify(value)}`
        }
        return `${key}: ${value}`
      })
      .filter(Boolean)
      .join('\n')
  }

  private computeChecksum(payload: unknown): string {
    const stable = this.stableStringify(payload)
    return createHash('sha256').update(stable).digest('hex')
  }

  private stableStringify(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
    if (typeof value === 'string') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>
      const keys = Object.keys(obj).sort()
      return `{${keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(obj[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
  }

  private scopeQuery(knex: Knex, payload: { entityType: string; recordId: string; organizationId: string | null; tenantId: string | null }) {
    return knex('vector_search_records')
      .where('entity_type', payload.entityType)
      .andWhere('record_id', payload.recordId)
      .modify((qb) => {
        if (payload.organizationId === null) qb.andWhereNull('organization_id')
        else qb.andWhere('organization_id', payload.organizationId)
        if (payload.tenantId === null) qb.andWhereNull('tenant_id')
        else qb.andWhere('tenant_id', payload.tenantId)
      })
  }

  private async tryEmbed(text: string, preferredModel?: string, preferredDimensions?: number) {
    const apiKey = this.resolveApiKey()
    if (!apiKey) return { vector: null, model: preferredModel ?? DEFAULT_EMBEDDING_MODEL, dimensions: preferredDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS, error: 'missing_api_key' }
    try {
      if (!this.openAIClient) {
        this.openAIClient = createOpenAI({ apiKey })
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[vector_search] failed to instantiate OpenAI client', error)
      return { vector: null, model: preferredModel ?? DEFAULT_EMBEDDING_MODEL, dimensions: preferredDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS, error: 'client_init_failed' }
    }

    const modelName = preferredModel ?? DEFAULT_EMBEDDING_MODEL
    try {
      const response = await embed({
        model: this.openAIClient!.embedding(modelName),
        value: text,
      })
      const vector = Array.isArray(response.embeddings?.[0]) ? response.embeddings[0] as number[] : null
      return {
        vector,
        model: modelName,
        dimensions: vector?.length ?? preferredDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS,
        error: null,
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[vector_search] embedding failed', error)
      return {
        vector: null,
        model: modelName,
        dimensions: preferredDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS,
        error: error instanceof Error ? error.message : 'embedding_failed',
      }
    }
  }

  private formatVector(vector: number[]): string {
    const normalized = vector.map((value) => {
      if (!Number.isFinite(value)) return 0
      return Number.parseFloat(Number(value).toFixed(6))
    })
    return `[${normalized.join(',')}]`
  }

  private resolveApiKey(): string | null {
    return process.env.VECTOR_SEARCH_OPENAI_API_KEY
      || process.env.OPENAI_API_KEY
      || null
  }

  private getKnex(): Knex {
    return (this.em.getConnection().getKnex() as Knex)
  }

  private async ensureTable(knex: Knex): Promise<boolean> {
    if (this.tableReady) return true
    try {
      const exists = await knex.schema.hasTable('vector_search_records')
      this.tableReady = exists
      return exists
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[vector_search] failed to verify table availability', error)
      return false
    }
  }
}
