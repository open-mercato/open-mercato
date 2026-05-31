/**
 * Data Quality Module — Shared Types
 *
 * Types for the cross-module data quality target registry.
 * Modules expose targets via `data-quality.ts` files; a generator aggregates them.
 */

export type DataQualityFieldType = 'text' | 'number' | 'boolean' | 'date' | 'uuid' | 'json' | 'enum'

export interface DataQualityFieldMapping {
  dbColumn: string
  type: DataQualityFieldType
  nullable?: boolean
  enumValues?: string[]
}

export interface DataQualityTarget {
  /** Unique entity identifier, e.g. "catalog:products" */
  entityId: string
  /** Human-readable label */
  label: string
  /** Features required to access this target */
  requiredFeatures?: string[]
  /** Database table name */
  tableName: string
  /** Primary key column */
  idColumn: string
  /** Tenant/org scope columns */
  scopeColumns: {
    tenantId: string
    organizationId: string
  }
  /** Field name → DB column mapping */
  fieldMappings: Record<string, DataQualityFieldMapping>
  /** URL template for linking to records, e.g. "/backend/catalog/products/{id}" */
  recordLink?: string
  /** Field name to use as record display label */
  labelField?: string
}

export interface DataQualityModuleConfig {
  targets: DataQualityTarget[]
}

/** Aggregated registry type produced by the generator */
export interface DataQualityGeneratedRegistry {
  targets: DataQualityTarget[]
}
