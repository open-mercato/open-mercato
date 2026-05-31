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

export interface DataQualityTargetEntry {
  moduleId: string
  targets: DataQualityTarget[]
}

// =============================================================================
// Global target registry — populated during bootstrap
// =============================================================================

let _dataQualityTargetEntries: DataQualityTargetEntry[] | null = null

/**
 * Register data quality target entries globally.
 * Called during app bootstrap with entries from data-quality.generated.ts.
 */
export function registerDataQualityTargetEntries(entries: DataQualityTargetEntry[]): void {
  if (_dataQualityTargetEntries !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Data quality target entries re-registered (this may occur during HMR)')
  }
  _dataQualityTargetEntries = entries
}

/**
 * Get registered data quality target entries.
 * Returns empty array if not registered.
 */
export function getDataQualityTargetEntries(): DataQualityTargetEntry[] {
  return _dataQualityTargetEntries ?? []
}

/**
 * Load the full data quality target registry from registered entries.
 * Deduplicates by entityId:tableName.
 */
export function loadDataQualityTargetRegistry(): DataQualityGeneratedRegistry {
  const seen = new Set<string>()
  const targets: DataQualityTarget[] = []

  for (const entry of getDataQualityTargetEntries()) {
    for (const target of entry.targets) {
      const key = `${target.entityId}:${target.tableName}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push(target)
    }
  }

  return { targets }
}
