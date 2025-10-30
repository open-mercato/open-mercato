import type { EntityId } from './entities'
import type { QueryEngine } from '../lib/query/types'

export type VectorDriverId = 'pgvector' | 'qdrant' | 'chromadb'

export type VectorLinkDescriptor = {
  href: string
  label?: string
  icon?: string
  kind?: 'primary' | 'secondary'
}

export type VectorResultPresenter = {
  title: string
  subtitle?: string
  icon?: string
  badge?: string
}

export type VectorIndexSource = {
  /**
   * Text or text chunks passed to the embedding model. Provide multiple chunks for larger payloads.
   */
  input: string | string[]
  /**
   * Optional metadata persisted alongside the embedding for quick display.
   */
  presenter?: VectorResultPresenter | null
  /**
   * Optional deep links rendered next to the result.
   */
  links?: VectorLinkDescriptor[] | null
  /**
   * Additional payload mirrored into the driver metadata column (JSONB).
   */
  payload?: Record<string, unknown> | null
  /**
   * Source object used when computing a checksum. Defaults to the combination of record and custom fields.
   */
  checksumSource?: unknown
}

export type VectorBuildContext = {
  record: Record<string, any>
  customFields: Record<string, any>
  organizationId?: string | null
  tenantId?: string | null
  queryEngine?: QueryEngine
  container?: unknown
}

export type VectorEntityConfig = {
  entityId: EntityId
  enabled?: boolean
  driverId?: VectorDriverId
  priority?: number
  /**
   * Optional builder that returns the string payload to embed plus supplemental metadata.
   * When omitted the service will stringify the record (including custom fields).
   */
  buildSource?: (ctx: VectorBuildContext) => Promise<VectorIndexSource | null> | VectorIndexSource | null
  /**
   * Resolve the primary admin URL for this record. When omitted the service expects a link inside `links`.
   */
  resolveUrl?: (ctx: VectorBuildContext) => Promise<string | null> | string | null
  /**
   * Format the presenter displayed inside global search overlays.
   */
  formatResult?: (ctx: VectorBuildContext) => Promise<VectorResultPresenter | null> | VectorResultPresenter | null
  /**
   * Provide extra deep links rendered next to the search result.
   */
  resolveLinks?: (ctx: VectorBuildContext) => Promise<VectorLinkDescriptor[] | null> | VectorLinkDescriptor[] | null
}

export type VectorModuleConfig = {
  defaultDriverId?: VectorDriverId
  entities: VectorEntityConfig[]
}

export type VectorQueryRequest = {
  query: string
  tenantId: string
  organizationId?: string | null
  limit?: number
  driverId?: VectorDriverId
}

export type VectorSearchHit = {
  entityId: EntityId
  recordId: string
  score: number
  url?: string | null
  presenter?: VectorResultPresenter | null
  links?: VectorLinkDescriptor[] | null
  driverId: VectorDriverId
  metadata?: Record<string, unknown> | null
}

export type VectorIndexEntry = {
  entityId: EntityId
  recordId: string
  driverId: VectorDriverId
  tenantId: string
  organizationId?: string | null
  checksum: string
  url?: string | null
  presenter?: VectorResultPresenter | null
  links?: VectorLinkDescriptor[] | null
  payload?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  resultTitle: string
  resultSubtitle?: string | null
  resultIcon?: string | null
  resultBadge?: string | null
  resultSnapshot?: string | null
  primaryLinkHref?: string | null
  primaryLinkLabel?: string | null
  createdAt: string
  updatedAt: string
  score?: number | null
}
