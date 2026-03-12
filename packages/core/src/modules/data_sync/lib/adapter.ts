export interface TenantScope {
  organizationId: string
  tenantId: string
}

export interface FieldMapping {
  externalField: string
  localField: string
  transform?: string
  required?: boolean
  defaultValue?: unknown
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

  streamImport?(input: StreamImportInput): AsyncIterable<ImportBatch>
  streamExport?(input: StreamExportInput): AsyncIterable<ExportBatch>
  getInitialCursor?(input: { entityType: string; scope: TenantScope }): Promise<string | null>
  getMapping(input: { entityType: string; scope: TenantScope }): Promise<DataMapping>
  validateConnection?(input: {
    entityType: string
    credentials: Record<string, unknown>
    mapping: DataMapping
    scope: TenantScope
  }): Promise<ValidationResult>
}
