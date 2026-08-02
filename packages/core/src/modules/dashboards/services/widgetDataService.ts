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
import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import {
  type AggregateFunction,
  type DateGranularity,
  buildAggregationQuery,
  buildGroupSourceRowsQuery,
  resolveGroupExpression,
} from '../lib/aggregations'
import {
  type ExactDecimal,
  EXACT_DECIMAL_ZERO,
  addExactDecimal,
  compareExactDecimal,
  exactDecimalToNumber,
  parseExactDecimal,
} from '../lib/exactDecimal'
import type { AnalyticsRegistry } from './analyticsRegistry'

const WIDGET_DATA_CACHE_TTL = 120_000
const WIDGET_DATA_SEGMENT_TTL = 86_400_000
const WIDGET_DATA_SEGMENT_KEY = 'widget-data:__segment__'

/**
 * Encrypted group sources cannot be grouped by the database, so the rows are scanned and
 * aggregated in application code. The cap keeps that scan bounded; overflowing it fails loudly
 * instead of charting a silently truncated result (#4622).
 */
const ENCRYPTED_GROUP_SCAN_LIMIT = 20_000

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

const logger = createLogger('dashboards').child({ component: 'widget-data' })

export class WidgetDataValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WidgetDataValidationError'
  }
}

export class WidgetDataScanLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WidgetDataScanLimitError'
  }
}

/**
 * Raised when encryption is configured but the group source cannot currently be resolved — an
 * unhealthy KMS, an unreadable encryption map, or a missing tenant DEK. Grouping would either read
 * ciphertext in SQL or silently collapse every encrypted row into "Unknown", so the request fails
 * closed instead (#4622).
 */
export class WidgetDataEncryptionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WidgetDataEncryptionUnavailableError'
  }
}

type EncryptedGroupSource = {
  entityId: string
  dbColumn: string
  jsonPath: string | null
}

function assertSafeIdentifier(value: string, name: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ${name}: ${value}`)
  }
}

/**
 * Encryption maps may register a field in either casing (`findKey` in the encryption service
 * accepts both), so match the analytics column tolerantly rather than by exact snake_case.
 */
function matchesColumn(fieldName: string, dbColumn: string): boolean {
  const normalize = (value: string) => value.replace(/_/g, '').toLowerCase()
  return normalize(fieldName) === normalize(dbColumn)
}

function readJsonPath(value: unknown, path: string): unknown {
  let current = value
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Running aggregate state for one group. Values are folded in as they are scanned — the bucket
 * never holds the row set — so the scan cost stays linear and independent of the row cap.
 */
type GroupBucket = {
  /** Rows with a non-null metric column, mirroring SQL `COUNT(column)`. */
  count: number
  /** Rows whose metric parsed as a decimal, mirroring the row set SQL aggregates operate on. */
  numericCount: number
  /** Exact running sum, so money never accumulates in binary floating point. */
  sum: ExactDecimal
  min: ExactDecimal | null
  max: ExactDecimal | null
}

function createGroupBucket(): GroupBucket {
  return { count: 0, numericCount: 0, sum: EXACT_DECIMAL_ZERO, min: null, max: null }
}

function foldMetricValue(bucket: GroupBucket, value: ExactDecimal): void {
  bucket.numericCount += 1
  bucket.sum = addExactDecimal(bucket.sum, value)
  if (bucket.min === null || compareExactDecimal(value, bucket.min) < 0) bucket.min = value
  if (bucket.max === null || compareExactDecimal(value, bucket.max) > 0) bucket.max = value
}

/**
 * Mirrors the SQL semantics of `buildAggregateExpression` for application-side aggregation. That
 * expression wraps `SUM`/`AVG` in `COALESCE(..., 0)`, so an empty value set aggregates to `0` on
 * both paths, while the uncoalesced `MIN`/`MAX` keep PostgreSQL's `NULL`. An encrypted group source
 * must not report a different value than the same data would report in plaintext (#4622).
 */
function aggregateBucket(aggregate: AggregateFunction, bucket: GroupBucket): number | null {
  switch (aggregate) {
    case 'count':
      return bucket.count
    case 'sum':
      return bucket.numericCount === 0 ? 0 : exactDecimalToNumber(bucket.sum)
    case 'avg':
      return bucket.numericCount === 0 ? 0 : exactDecimalToNumber(bucket.sum) / bucket.numericCount
    case 'min':
      return bucket.min === null ? null : exactDecimalToNumber(bucket.min)
    case 'max':
      return bucket.max === null ? null : exactDecimalToNumber(bucket.max)
    default:
      return bucket.count
  }
}

/**
 * Mirrors the SQL path's `ORDER BY value DESC NULLS LAST`. PostgreSQL defaults DESC to NULLS FIRST,
 * which would let empty buckets displace real ones under a group limit, so both paths state the
 * policy explicitly: highest value first, buckets without a value last.
 */
function compareWidgetDataItemsByValueDesc(
  left: { value: number | null },
  right: { value: number | null },
): number {
  if (left.value === null && right.value === null) return 0
  if (left.value === null) return 1
  if (right.value === null) return -1
  return right.value - left.value
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

    const shouldFetchComparison = Boolean(comparisonRange && request.dateRange)

    const [mainResult, comparisonResult] = await Promise.all([
      this.executeQuery(request, dateRangeResolved),
      shouldFetchComparison && comparisonRange
        ? this.executeQuery(request, comparisonRange)
        : Promise.resolve<{ value: number | null; data: WidgetDataItem[] } | undefined>(undefined),
    ])

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
        await this.cache.set(
          WIDGET_DATA_SEGMENT_KEY,
          { updatedAt: response.metadata.fetchedAt },
          { ttl: WIDGET_DATA_SEGMENT_TTL, tags: ['widget-data'] },
        )
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
    if (request.groupBy) {
      const encryptedSource = await this.resolveEncryptedGroupSource(request.entityType, request.groupBy)
      if (encryptedSource) {
        return this.executeEncryptedGroupQuery(request, encryptedSource, dateRange)
      }
    }

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

  /**
   * Reports the encrypted column a groupBy field reads from, or null when the source is stored in
   * plaintext and can be grouped by the database. Grouping over an encrypted column in SQL buckets
   * ciphertext and renders it to the user (#4622).
   */
  private async resolveEncryptedGroupSource(
    entityType: string,
    groupBy: NonNullable<WidgetDataRequest['groupBy']>,
  ): Promise<EncryptedGroupSource | null> {
    // Encryption is not configured for this deployment, so no column can hold ciphertext and the
    // database may group the source directly.
    if (!isTenantDataEncryptionEnabled()) return null

    const resolved = resolveGroupExpression(this.registry, entityType, groupBy)
    if (!resolved) return null

    const tableName = this.registry.getEntityTypeConfig(entityType)?.tableName
    if (!tableName) return null

    // Without an encryption entity id the table is outside the encryption map entirely, which is
    // the same state the encrypting subscriber sees when it skips the row.
    const entityId = this.resolveEncryptionEntityId(tableName)
    if (!entityId) return null

    const encryptionService = resolveTenantEncryptionService(this.em)
    if (!encryptionService) {
      throw new WidgetDataEncryptionUnavailableError(
        `Cannot determine whether ${groupBy.field} is encrypted: encryption service unavailable`,
      )
    }

    const organizationId = this.resolveOrganizationId()
    let encryptedFields: string[]
    try {
      // Deliberately independent of KMS health: the map describes how the rows were written, and
      // an unhealthy KMS must not be read as "this column is plaintext" (#4622).
      encryptedFields = await encryptionService.getEncryptedFieldNames(
        entityId,
        this.scope.tenantId,
        organizationId,
        { ignoreRuntimeHealth: true },
      )
    } catch (err) {
      logger.error('Failed to resolve encrypted fields for widget grouping', { err, entityId, entityType })
      throw new WidgetDataEncryptionUnavailableError(
        `Cannot determine whether ${groupBy.field} is encrypted: encryption map lookup failed`,
      )
    }

    if (!encryptedFields.some((field) => matchesColumn(field, resolved.dbColumn))) return null

    if (resolved.jsonPath === null && groupBy.granularity) {
      throw new WidgetDataValidationError(
        `Cannot group encrypted field by granularity: ${groupBy.field}`,
      )
    }

    return { entityId, dbColumn: resolved.dbColumn, jsonPath: resolved.jsonPath }
  }

  /**
   * Aggregates an encrypted group source in application code: rows are scanned, the group column is
   * decrypted, and only the resulting plaintext keys are grouped. Values that cannot be decrypted
   * collapse into the null ("Unknown") bucket so ciphertext never reaches the response.
   */
  private async executeEncryptedGroupQuery(
    request: WidgetDataRequest,
    source: EncryptedGroupSource,
    dateRange?: { start: Date; end: Date },
  ): Promise<{ value: number | null; data: WidgetDataItem[] }> {
    const query = buildGroupSourceRowsQuery({
      entityType: request.entityType,
      metric: request.metric,
      dateRange: dateRange && request.dateRange ? { field: request.dateRange.field, ...dateRange } : undefined,
      filters: request.filters,
      scope: this.scope,
      registry: this.registry,
      groupColumn: source.dbColumn,
      rowLimit: ENCRYPTED_GROUP_SCAN_LIMIT,
    })

    if (!query) {
      throw new Error('Failed to build aggregation query')
    }

    const rows = await this.em.getConnection().execute(query.sql, query.params)
    const results = Array.isArray(rows) ? rows : []

    if (results.length > ENCRYPTED_GROUP_SCAN_LIMIT) {
      throw new WidgetDataScanLimitError(
        `Too many rows to group encrypted field ${request.groupBy?.field} (limit ${ENCRYPTED_GROUP_SCAN_LIMIT})`,
      )
    }

    const encryptionService = resolveTenantEncryptionService(this.em)
    let dek: TenantDek | null = null
    try {
      dek = encryptionService ? await encryptionService.getDek(this.scope.tenantId) : null
    } catch (err) {
      logger.error('Failed to resolve the tenant DEK for widget grouping', { err, entityId: source.entityId })
      dek = null
    }

    const buckets = new Map<string | null, GroupBucket>()
    let undecryptableRows = 0

    for (const row of results as Array<Record<string, unknown>>) {
      const resolvedKey = this.resolveDecryptedGroupKey(row.group_source, source, dek?.key ?? null)
      // An undecryptable source joins the null ("Unknown") bucket rather than being dropped, so the
      // widget total still matches the underlying rows.
      if (resolvedKey === undefined) undecryptableRows += 1
      const groupKey = resolvedKey === undefined ? null : resolvedKey

      let bucket = buckets.get(groupKey)
      if (!bucket) {
        bucket = createGroupBucket()
        buckets.set(groupKey, bucket)
      }

      const metricValue = row.metric_value
      if (metricValue === null || metricValue === undefined) continue
      bucket.count += 1
      const numeric = parseExactDecimal(metricValue)
      if (numeric) foldMetricValue(bucket, numeric)
    }

    if (undecryptableRows > 0) {
      // No DEK at all means every ciphertext row would collapse into "Unknown" and the widget would
      // report a confidently wrong distribution, so fail closed rather than chart it (#4622).
      if (!dek) {
        throw new WidgetDataEncryptionUnavailableError(
          `Cannot group encrypted field ${request.groupBy?.field}: tenant encryption key is unavailable`,
        )
      }
      logger.warn('Grouped rows with an undecryptable group source as unknown', {
        entityId: source.entityId,
        column: source.dbColumn,
        rows: undecryptableRows,
      })
    }

    let data: WidgetDataItem[] = Array.from(buckets.entries())
      .map(([groupKey, bucket]) => ({ groupKey, value: aggregateBucket(request.metric.aggregate, bucket) }))
      .sort(compareWidgetDataItemsByValueDesc)

    if (request.groupBy?.limit && request.groupBy.limit > 0) {
      data = data.slice(0, Math.min(request.groupBy.limit, 100))
    }

    if (request.groupBy?.resolveLabels) {
      data = await this.resolveGroupLabels(data, request.entityType, request.groupBy.field)
    }

    const totalValue = data.reduce((sum: number, item: WidgetDataItem) => sum + (item.value ?? 0), 0)
    return { value: totalValue, data }
  }

  /**
   * Returns the plaintext group key for a scanned row, `null` for an empty/absent value, or
   * `undefined` when the source is ciphertext that could not be decrypted.
   */
  private resolveDecryptedGroupKey(
    rawValue: unknown,
    source: EncryptedGroupSource,
    dek: string | null,
  ): string | null | undefined {
    if (rawValue === null || rawValue === undefined) return null

    let value: unknown = rawValue
    if (typeof value === 'string' && this.isEncryptedPayload(value)) {
      if (!dek) return undefined
      const decrypted = this.decryptWithDek(value, dek)
      if (decrypted === null) return undefined
      value = parseDecryptedFieldValue(decrypted)
    }

    if (source.jsonPath !== null) {
      value = readJsonPath(value, source.jsonPath)
    }

    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'object') return null
    const key = String(value)
    // Defense in depth: a nested value that is itself ciphertext must never reach the response.
    return this.isEncryptedPayload(key) ? undefined : key
  }

  private async resolveGroupLabels(
    data: WidgetDataItem[],
    entityType: string,
    groupByField: string,
  ): Promise<WidgetDataItem[]> {
    const config = this.registry.getLabelResolverConfig(entityType, groupByField)

    if (!config) {
      return data.map((item) => {
        if (item.groupKey == null || item.groupKey === '') return { ...item, groupLabel: undefined }
        const label = String(item.groupKey)
        // A ciphertext group key has no meaningful label; echoing it would render encrypted data
        // into the chart legend (#4622).
        return { ...item, groupLabel: this.isEncryptedPayload(label) ? undefined : label }
      })
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

  /**
   * Resolves the encryption entity id for an analytics table. A request-scoped `EntityManager` fork
   * frequently reports an empty metadata registry, which used to make every group source look
   * unencrypted and send the request back to the ciphertext-grouping SQL path (#4622). The table
   * name alone is enough for the entity-id lookup, so it is the fallback.
   */
  private resolveEncryptionEntityId(tableName: string): string | null {
    return this.resolveEntityId(this.resolveEntityMetadata(tableName)) ?? this.resolveEntityId({ tableName })
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
