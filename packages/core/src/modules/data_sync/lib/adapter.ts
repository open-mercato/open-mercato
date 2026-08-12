export interface TenantScope {
  organizationId: string
  tenantId: string
}

export type FieldMappingKind =
  | 'core'
  | 'relation'
  | 'external_id'
  | 'custom_field'
  | 'metadata'
  | 'ignore'

export type FieldMappingDedupeRole = 'primary' | 'secondary'

export interface FieldMapping {
  externalField: string
  localField: string
  transform?: string
  required?: boolean
  defaultValue?: unknown
  mappingKind?: FieldMappingKind
  dedupeRole?: FieldMappingDedupeRole
}

export interface DataMapping {
  entityType: string
  fields: FieldMapping[]
  matchStrategy: 'externalId' | 'sku' | 'email' | 'custom'
  matchField?: string
}

export interface StreamImportInput {
  entityType: string
  cursor?: string
  batchSize: number
  credentials: Record<string, unknown>
  mapping: DataMapping
  scope: TenantScope
  runId?: string
}

export interface ImportItem {
  externalId: string
  data: Record<string, unknown>
  action: 'create' | 'update' | 'skip' | 'failed'
  hash?: string
}

export interface ImportBatch {
  items: ImportItem[]
  cursor: string
  hasMore: boolean
  totalEstimate?: number
  processedCount?: number
  refreshCoverageEntityTypes?: string[]
  message?: string
  batchIndex: number
}

export interface StreamExportInput {
  entityType: string
  cursor?: string
  batchSize: number
  credentials: Record<string, unknown>
  mapping: DataMapping
  scope: TenantScope
  filter?: Record<string, unknown>
  runId?: string
}

export interface ExportItemResult {
  localId: string
  externalId?: string
  status: 'success' | 'error' | 'skipped'
  error?: string
}

export interface ExportBatch {
  results: ExportItemResult[]
  cursor: string
  hasMore: boolean
  batchIndex: number
}

export interface ValidationResult {
  ok: boolean
  message?: string
  details?: Record<string, unknown>
}

export interface DataSyncAdapter {
  readonly providerKey: string
  readonly direction: 'import' | 'export' | 'bidirectional'
  readonly supportedEntities: string[]
  /**
   * How a run may be started.
   *
   * - `generic` (default): `/api/data_sync/run` has enough information to
   *   create and enqueue the run.
   * - `provider`: the provider owns a prerequisite flow before a run can be
   *   enqueued, such as uploading a CSV and linking that upload to the run.
   */
  readonly runMode?: 'generic' | 'provider'
  readonly operationalTelemetry?: boolean

  streamImport?(input: StreamImportInput): AsyncIterable<ImportBatch>
  streamExport?(input: StreamExportInput): AsyncIterable<ExportBatch>
  /**
   * Whether the engine mirrors this entity type's cursor into the shared
   * `sync_cursors` row — one row per (integration, entityType, direction,
   * scope), overwritten by every run that commits a batch.
   *
   * Default `true`. Return `false` for an entity type whose cursor is a single
   * run's scan state rather than a durable position in a log. The run row keeps
   * `initialCursor` + `cursor` either way, so a redelivered job still resumes
   * exactly; what goes away is two concurrent or consecutive runs of the same
   * entity type silently redefining each other's start position.
   *
   * The distinction is a blast radius, not a preference: losing a log position
   * means re-draining the whole change queue, while losing a table walk's
   * position means re-walking a table the adapter already re-walks idempotently.
   * The predicate is per entity type because one adapter commonly serves both
   * kinds — an incremental feed and a whole-table backfill.
   */
  persistsSharedCursor?(entityType: string): boolean
  getInitialCursor?(input: { entityType: string; scope: TenantScope }): Promise<string | null>
  getMapping(input: { entityType: string; scope: TenantScope }): Promise<DataMapping>
  validateConnection?(input: {
    entityType: string
    credentials: Record<string, unknown>
    mapping: DataMapping
    scope: TenantScope
  }): Promise<ValidationResult>
}
