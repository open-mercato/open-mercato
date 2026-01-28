import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { createHash } from 'node:crypto'
import { decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { resolveEntityIdFromMetadata } from '@open-mercato/shared/lib/encryption/entityIds'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  type DateRangePreset,
  resolveDateRange,
  getPreviousPeriod,
  calculatePercentageChange,
  determineChangeDirection,
  isValidDateRangePreset,
} from '@open-mercato/ui/backend/date-range'
import {
  type AggregateFunction,
  type DateGranularity,
  buildAggregationQuery,
} from '../lib/aggregations'
import type { AnalyticsRegistry } from './analyticsRegistry'

const WIDGET_DATA_CACHE_TTL = 120_000

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export class WidgetDataValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WidgetDataValidationError'
  }
}

function assertSafeIdentifier(value: string, name: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ${name}: ${value}`)
  }
}

export type WidgetDataRequest = {
  entityType: string
  metric: {
    field: string
    aggregate: AggregateFunction
  }
  groupBy?: {
    field: string
    granularity?: DateGranularity
    limit?: number
    resolveLabels?: boolean
  }
  filters?: Array<{
    field: string
    operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'is_null' | 'is_not_null'
    value?: unknown
  }>
  dateRange?: {
    field: string
    preset: DateRangePreset
  }
  comparison?: {
    type: 'previous_period' | 'previous_year'
  }
}

export type WidgetDataItem = {
  groupKey: unknown
  groupLabel?: string
  value: number | null
}

export type WidgetDataResponse = {
  value: number | null
  data: WidgetDataItem[]
  comparison?: {
    value: number | null
    change: number
    direction: 'up' | 'down' | 'unchanged'
  }
  metadata: {
    fetchedAt: string
    recordCount: number
  }
}

export type WidgetDataScope = {
  tenantId: string
  organizationIds?: string[]
}

export type WidgetDataServiceOptions = {
  em: EntityManager
  scope: WidgetDataScope
  registry: AnalyticsRegistry
  cache?: CacheStrategy
}

export class WidgetDataService {
  private em: EntityManager
  private scope: WidgetDataScope
  private registry: AnalyticsRegistry
  private cache?: CacheStrategy

  constructor(options: WidgetDataServiceOptions) {
    this.em = options.em
    this.scope = options.scope
    this.registry = options.registry
    this.cache = options.cache
  }

  private buildCacheKey(request: WidgetDataRequest): string {
    const hash = createHash('sha256')
    hash.update(JSON.stringify({ request, scope: this.scope }))
    return `widget-data:${hash.digest('hex').slice(0, 16)}`
  }

  private getCacheTags(entityType: string): string[] {
    return ['widget-data', `widget-data:${entityType}`]
  }

  async fetchWidgetData(request: WidgetDataRequest): Promise<WidgetDataResponse> {
    this.validateRequest(request)

    if (this.cache) {
      const cacheKey = this.buildCacheKey(request)
      try {
        const cached = await this.cache.get(cacheKey)
        if (cached && typeof cached === 'object' && 'value' in (cached as object)) {
          return cached as WidgetDataResponse
        }
      } catch {
      }
    }

    const now = new Date()
    let dateRangeResolved: { start: Date; end: Date } | undefined
    let comparisonRange: { start: Date; end: Date } | undefined

    if (request.dateRange) {
      dateRangeResolved = resolveDateRange(request.dateRange.preset, now)
      if (request.comparison) {
        comparisonRange = getPreviousPeriod(dateRangeResolved, request.dateRange.preset)
      }
    }

    const mainResult = await this.executeQuery(request, dateRangeResolved)

    let comparisonResult: { value: number | null; data: WidgetDataItem[] } | undefined
    if (comparisonRange && request.dateRange) {
      comparisonResult = await this.executeQuery(request, comparisonRange)
    }

    const response: WidgetDataResponse = {
      value: mainResult.value,
      data: mainResult.data,
      metadata: {
        fetchedAt: now.toISOString(),
        recordCount: mainResult.data.length || (mainResult.value !== null ? 1 : 0),
      },
    }

    if (comparisonResult && mainResult.value !== null && comparisonResult.value !== null) {
      response.comparison = {
        value: comparisonResult.value,
        change: calculatePercentageChange(mainResult.value, comparisonResult.value),
        direction: determineChangeDirection(mainResult.value, comparisonResult.value),
      }
    }

    if (this.cache) {
      const cacheKey = this.buildCacheKey(request)
      const tags = this.getCacheTags(request.entityType)
      try {
        await this.cache.set(cacheKey, response, { ttl: WIDGET_DATA_CACHE_TTL, tags })
      } catch {
      }
    }

    return response
  }

  private validateRequest(request: WidgetDataRequest): void {
    if (!this.registry.isValidEntityType(request.entityType)) {
      throw new WidgetDataValidationError(`Invalid entity type: ${request.entityType}`)
    }

    if (!request.metric?.field || !request.metric?.aggregate) {
      throw new WidgetDataValidationError('Metric field and aggregate are required')
    }

    const metricMapping = this.registry.getFieldMapping(request.entityType, request.metric.field)
    if (!metricMapping) {
      throw new WidgetDataValidationError(
        `Invalid metric field: ${request.metric.field} for entity type: ${request.entityType}`
      )
    }

    const validAggregates: AggregateFunction[] = ['count', 'sum', 'avg', 'min', 'max']
    if (!validAggregates.includes(request.metric.aggregate)) {
      throw new WidgetDataValidationError(`Invalid aggregate function: ${request.metric.aggregate}`)
    }

    if (request.dateRange && !isValidDateRangePreset(request.dateRange.preset)) {
      throw new WidgetDataValidationError(`Invalid date range preset: ${request.dateRange.preset}`)
    }

    if (request.groupBy) {
      const groupMapping = this.registry.getFieldMapping(request.entityType, request.groupBy.field)
      if (!groupMapping) {
        const [baseField] = request.groupBy.field.split('.')
        const baseMapping = this.registry.getFieldMapping(request.entityType, baseField)
        if (!baseMapping || baseMapping.type !== 'jsonb') {
          throw new WidgetDataValidationError(`Invalid groupBy field: ${request.groupBy.field}`)
        }
      }
    }
  }

  private async executeQuery(
    request: WidgetDataRequest,
    dateRange?: { start: Date; end: Date },
  ): Promise<{ value: number | null; data: WidgetDataItem[] }> {
    const query = buildAggregationQuery({
      entityType: request.entityType,
      metric: request.metric,
      groupBy: request.groupBy,
      dateRange: dateRange && request.dateRange ? { field: request.dateRange.field, ...dateRange } : undefined,
      filters: request.filters,
      scope: this.scope,
      registry: this.registry,
    })

    if (!query) {
      throw new Error('Failed to build aggregation query')
    }

    const rows = await this.em.getConnection().execute(query.sql, query.params)
    const results = Array.isArray(rows) ? rows : []

    if (request.groupBy) {
      let data: WidgetDataItem[] = results.map((row: Record<string, unknown>) => ({
        groupKey: row.group_key,
        value: row.value !== null ? Number(row.value) : null,
      }))

      if (request.groupBy.resolveLabels) {
        data = await this.resolveGroupLabels(data, request.entityType, request.groupBy.field)
      }

      const totalValue = data.reduce((sum: number, item: WidgetDataItem) => sum + (item.value ?? 0), 0)
      return { value: totalValue, data }
    }

    const singleValue = results[0]?.value !== undefined ? Number(results[0].value) : null
    return { value: singleValue, data: [] }
  }

  private async resolveGroupLabels(
    data: WidgetDataItem[],
    entityType: string,
    groupByField: string,
  ): Promise<WidgetDataItem[]> {
    const config = this.registry.getLabelResolverConfig(entityType, groupByField)

    if (!config) {
      return data.map((item) => ({
        ...item,
        groupLabel: item.groupKey != null && item.groupKey !== '' ? String(item.groupKey) : undefined,
      }))
    }

    const ids = data
      .map((item) => item.groupKey)
      .filter((id): id is string => {
        if (typeof id !== 'string' || id.length === 0) return false
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      })

    if (ids.length === 0) {
      return data.map((item) => ({ ...item, groupLabel: undefined }))
    }

    const uniqueIds = [...new Set(ids)]

    assertSafeIdentifier(config.table, 'table name')
    assertSafeIdentifier(config.idColumn, 'id column')
    assertSafeIdentifier(config.labelColumn, 'label column')

    const meta = this.resolveEntityMetadata(config.table)
    const idProp = meta ? this.resolveEntityPropertyName(meta, config.idColumn) : null
    const labelProp = meta ? this.resolveEntityPropertyName(meta, config.labelColumn) : null
    const tenantProp = meta
      ? (this.resolveEntityPropertyName(meta, 'tenant_id') ?? this.resolveEntityPropertyName(meta, 'tenantId'))
      : null
    const organizationProp = meta
      ? (this.resolveEntityPropertyName(meta, 'organization_id') ?? this.resolveEntityPropertyName(meta, 'organizationId'))
      : null
    const entityName = meta ? ((meta as any).class ?? meta.className ?? meta.name) : null

    if (meta && idProp && labelProp && tenantProp && entityName) {
      const where: Record<string, unknown> = {
        [idProp]: { $in: uniqueIds },
        [tenantProp]: this.scope.tenantId,
      }
      if (organizationProp && this.scope.organizationIds && this.scope.organizationIds.length > 0) {
        where[organizationProp] = { $in: this.scope.organizationIds }
      }

      try {
        const records = await findWithDecryption(
          this.em,
          entityName,
          where,
          { fields: [idProp, labelProp, tenantProp, organizationProp].filter(Boolean) },
          { tenantId: this.scope.tenantId, organizationId: this.resolveOrganizationId() },
        )

        const encryptionService = resolveTenantEncryptionService(this.em as any)
        const dek = encryptionService?.isEnabled() ? await encryptionService.getDek(this.scope.tenantId) : null
        let hasEncryptedLabels = false
        let hasDecryptedLabels = false

        const labelMap = new Map<string, string>()
        for (const record of records as Array<Record<string, unknown>>) {
          const id = record[idProp]
          let labelValue = record[labelProp]
          if (typeof labelValue === 'string' && this.isEncryptedPayload(labelValue)) {
            hasEncryptedLabels = true
            if (dek?.key) {
              const decrypted = this.decryptWithDek(labelValue, dek.key)
              if (decrypted !== null) {
                labelValue = decrypted
                hasDecryptedLabels = true
              }
            }
          } else if (labelValue != null && labelValue !== '') {
            hasDecryptedLabels = true
          }

          if (typeof id === 'string' && labelValue != null && labelValue !== '') {
            labelMap.set(id, String(labelValue))
          }
        }

        if (labelMap.size > 0 && (!hasEncryptedLabels || hasDecryptedLabels)) {
          return data.map((item) => ({
            ...item,
            groupLabel: typeof item.groupKey === 'string' && labelMap.has(item.groupKey)
              ? labelMap.get(item.groupKey)!
              : undefined,
          }))
        }
      } catch {
        // fall through to SQL resolution
      }
    }

    const clauses = [`"${config.idColumn}" = ANY(?::uuid[])`, 'tenant_id = ?']
    const params: unknown[] = [`{${uniqueIds.join(',')}}`, this.scope.tenantId]

    if (this.scope.organizationIds && this.scope.organizationIds.length > 0) {
      clauses.push('organization_id = ANY(?::uuid[])')
      params.push(`{${this.scope.organizationIds.join(',')}}`)
    }

    const sql = `SELECT "${config.idColumn}" as id, "${config.labelColumn}" as label, tenant_id, organization_id FROM "${config.table}" WHERE ${clauses.join(
      ' AND ',
    )}`

    try {
      const labelRows = await this.em.getConnection().execute(sql, params)
      const entityId = this.resolveEntityId(meta)
      const encryptionService = resolveTenantEncryptionService(this.em as any)
      const organizationId = this.resolveOrganizationId()
      const dek = encryptionService?.isEnabled() ? await encryptionService.getDek(this.scope.tenantId) : null

      const labelMap = new Map<string, string>()
      for (const row of labelRows as Array<{ id: string; label: string | null; tenant_id?: string | null; organization_id?: string | null }>) {
        let labelValue = row.label
        if (entityId && encryptionService?.isEnabled() && labelValue != null) {
          const rowOrgId = row.organization_id ?? organizationId ?? null
          const decrypted = await encryptionService.decryptEntityPayload(
            entityId,
            { [config.labelColumn]: labelValue },
            this.scope.tenantId,
            rowOrgId,
          )
          const resolved = decrypted[config.labelColumn]
          if (typeof resolved === 'string' || typeof resolved === 'number') {
            labelValue = String(resolved)
          }
        }

        if (labelValue && dek?.key && this.isEncryptedPayload(labelValue)) {
          const decrypted = this.decryptWithDek(labelValue, dek.key)
          if (decrypted !== null) {
            labelValue = decrypted
          }
        }

        if (row.id && labelValue != null && labelValue !== '') {
          labelMap.set(row.id, labelValue)
        }
      }

      return data.map((item) => ({
        ...item,
        groupLabel: typeof item.groupKey === 'string' && labelMap.has(item.groupKey)
          ? labelMap.get(item.groupKey)!
          : undefined,
      }))
    } catch {
      return data.map((item) => ({
        ...item,
        groupLabel: undefined,
      }))
    }
  }

  private resolveOrganizationId(): string | null {
    if (!this.scope.organizationIds || this.scope.organizationIds.length !== 1) return null
    return this.scope.organizationIds[0] ?? null
  }

  private resolveEntityMetadata(tableName: string): Record<string, any> | null {
    const registry = (this.em as any)?.getMetadata?.()
    if (!registry) return null
    const entries =
      (typeof registry.getAll === 'function' && registry.getAll()) ||
      (Array.isArray(registry.metadata) ? registry.metadata : Object.values(registry.metadata ?? {}))
    const metas = Array.isArray(entries) ? entries : Object.values(entries ?? {})
    const match = metas.find((meta: any) => {
      const table = meta?.tableName ?? meta?.collection
      if (typeof table !== 'string') return false
      if (table === tableName) return true
      return table.split('.').pop() === tableName
    })
    return match ?? null
  }

  private resolveEntityPropertyName(meta: Record<string, any>, columnName: string): string | null {
    const properties = meta?.properties ? Object.values(meta.properties) : []
    for (const prop of properties as Array<Record<string, any>>) {
      const fieldName = prop?.fieldName
      const fieldNames = prop?.fieldNames
      if (typeof fieldName === 'string' && fieldName === columnName) return prop?.name ?? null
      if (Array.isArray(fieldNames) && fieldNames.includes(columnName)) return prop?.name ?? null
      if (prop?.name === columnName) return prop?.name ?? null
    }
    return null
  }

  private resolveEntityId(meta: Record<string, any> | null): string | null {
    if (!meta) return null
    try {
      return resolveEntityIdFromMetadata(meta as any)
    } catch {
      return null
    }
  }

  private isEncryptedPayload(value: string): boolean {
    const parts = value.split(':')
    return parts.length === 4 && parts[3] === 'v1'
  }

  private decryptWithDek(value: string, dek: string): string | null {
    const first = decryptWithAesGcm(value, dek)
    if (first === null) return null
    if (!this.isEncryptedPayload(first)) return first
    return decryptWithAesGcm(first, dek) ?? first
  }
}

export function createWidgetDataService(
  em: EntityManager,
  scope: WidgetDataScope,
  registry: AnalyticsRegistry,
  cache?: CacheStrategy,
): WidgetDataService {
  return new WidgetDataService({ em, scope, registry, cache })
}
