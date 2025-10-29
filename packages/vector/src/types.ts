import type { EntityId } from '@open-mercato/shared/modules/entities'
import type {
  VectorDriverId,
  VectorIndexSource,
  VectorModuleConfig,
  VectorEntityConfig,
  VectorLinkDescriptor,
  VectorResultPresenter,
  VectorSearchHit,
  VectorQueryRequest,
} from '@open-mercato/shared/modules/vector'

export type { VectorDriverId, VectorIndexSource, VectorModuleConfig, VectorEntityConfig, VectorLinkDescriptor, VectorResultPresenter, VectorSearchHit, VectorQueryRequest }

export type VectorDriverDocument = {
  entityId: EntityId
  recordId: string
  tenantId: string
  organizationId?: string | null
  checksum: string
  embedding: number[]
  url?: string | null
  presenter?: VectorResultPresenter | null
  links?: VectorLinkDescriptor[] | null
  payload?: Record<string, unknown> | null
  driverId: VectorDriverId
}

export type VectorDriverQuery = {
  vector: number[]
  limit?: number
  filter?: {
    entityIds?: EntityId[]
    organizationId?: string | null
    tenantId: string
  }
}

export type VectorDriverQueryResult = {
  entityId: EntityId
  recordId: string
  score: number
  checksum: string
  url?: string | null
  presenter?: VectorResultPresenter | null
  links?: VectorLinkDescriptor[] | null
  payload?: Record<string, unknown> | null
}

export interface VectorDriver {
  readonly id: VectorDriverId
  ensureReady(): Promise<void>
  upsert(doc: VectorDriverDocument): Promise<void>
  delete(entityId: EntityId, recordId: string, tenantId: string): Promise<void>
  query(input: VectorDriverQuery): Promise<VectorDriverQueryResult[]>
  getChecksum(entityId: EntityId, recordId: string, tenantId: string): Promise<string | null>
  purge?(entityId: EntityId, tenantId: string): Promise<void>
}
