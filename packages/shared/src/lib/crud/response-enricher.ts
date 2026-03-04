/**
 * Response Enricher Contract
 *
 * Allows modules to enrich other modules' API responses without touching core code.
 * Similar to GraphQL Federation's @extends — modules can add computed fields to
 * any entity's API response by declaring enrichers.
 *
 * Enrichers run AFTER CrudHooks.afterList and BEFORE HTTP response serialization.
 * They are additive-only: enriched data lives under a `_<module>` namespace prefix.
 */

/**
 * Context available to enrichers during execution.
 * The EntityManager is read-only — enrichers MUST NOT perform writes.
 */
export interface EnricherContext {
  organizationId: string
  tenantId: string
  userId: string
  em: unknown
  container: unknown
  requestedFields?: string[]
  userFeatures?: string[]
}

/**
 * Query-engine opt-in configuration for response enrichers.
 * When set, the enricher can also run inside query-engine pipelines
 * (BasicQueryEngine / HybridQueryEngine), not only during API response shaping.
 */
export interface EnricherQueryEngineConfig {
  /** When true, this enricher participates in query-engine pipelines. */
  enabled: boolean
  /** Which engines this enricher applies to. Default: both. */
  engines?: Array<'basic' | 'hybrid'>
  /** Which query shapes to enrich. Default: ['list', 'detail']. */
  applyOn?: Array<'list' | 'detail'>
}

/**
 * Response enricher definition.
 *
 * @template TRecord - The shape of the record being enriched
 * @template TEnriched - Additional fields added by this enricher
 *
 * Rules:
 * - `enrichMany` MUST be implemented for list endpoints (N+1 prevention)
 * - Enrichers MUST NOT modify or remove existing fields (additive only)
 * - Enriched data MUST be namespaced under `_<module>` prefix
 * - Enrichers MUST NOT perform writes via EntityManager
 */
export interface ResponseEnricher<TRecord = any, TEnriched = any> {
  /** Unique identifier: `<module>.<enricher-name>` */
  id: string

  /** Target entity to enrich: `<module>.<entity>` (e.g., 'customers.person') */
  targetEntity: string

  /** ACL features required for this enricher to run */
  features?: string[]

  /** Execution priority (higher = runs first). Default: 0 */
  priority?: number

  /** Maximum execution time in ms before the enricher is skipped. Default: 2000 */
  timeout?: number

  /** Fallback value to merge into the record when the enricher times out or throws */
  fallback?: Record<string, unknown>

  /** If true, enricher errors propagate as HTTP errors. Default: false */
  critical?: boolean

  /** Tenant IDs where this enricher should be disabled. */
  disabledTenantIds?: string[]

  /** Optional cache configuration for read-through enrichment results. */
  cache?: {
    strategy: 'read-through'
    ttl: number
    tags?: string[]
    invalidateOn?: string[]
  }

  /**
   * Query-engine opt-in. When provided and `enabled: true`, this enricher
   * also runs inside query-engine pipelines (BasicQueryEngine / HybridQueryEngine).
   * Omit to keep API-only behavior (backward compatible default).
   */
  queryEngine?: EnricherQueryEngineConfig

  /** Enrich a single record. Used for detail endpoints. */
  enrichOne(record: TRecord, context: EnricherContext): Promise<TRecord & TEnriched>

  /**
   * Enrich multiple records in a single batch call.
   * MUST be implemented for list endpoints to prevent N+1 queries.
   * Use batch queries (e.g., `$in` with all record IDs) instead of per-record queries.
   */
  enrichMany?(records: TRecord[], context: EnricherContext): Promise<(TRecord & TEnriched)[]>
}

/**
 * Registered enricher entry with module context.
 */
export interface EnricherRegistryEntry {
  moduleId: string
  enricher: ResponseEnricher
}

/**
 * Result of applying enrichers to a set of records.
 */
export interface EnrichmentResult<T = any> {
  items: T[]
  _meta: {
    enrichedBy: string[]
    enricherErrors?: string[]
  }
}

/**
 * Result of applying enrichers to a single record.
 */
export interface SingleEnrichmentResult<T = any> {
  record: T
  _meta: {
    enrichedBy: string[]
    enricherErrors?: string[]
  }
}
