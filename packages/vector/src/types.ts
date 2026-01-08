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
  VectorIndexEntry,
} from '@open-mercato/shared/modules/vector'

export type {
  VectorDriverId,
  VectorIndexSource,
  VectorModuleConfig,
  VectorEntityConfig,
  VectorLinkDescriptor,
  VectorResultPresenter,
  VectorSearchHit,
  VectorQueryRequest,
  VectorIndexEntry,
}

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
  resultTitle: string
  resultSubtitle?: string | null
  resultIcon?: string | null
  resultBadge?: string | null
  resultSnapshot?: string | null
  primaryLinkHref?: string | null
  primaryLinkLabel?: string | null
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
  organizationId?: string | null
  score: number
  checksum: string
  url?: string | null
  presenter?: VectorResultPresenter | null
  links?: VectorLinkDescriptor[] | null
  payload?: Record<string, unknown> | null
  resultTitle: string
  resultSubtitle?: string | null
  resultIcon?: string | null
  resultBadge?: string | null
  resultSnapshot?: string | null
  primaryLinkHref?: string | null
  primaryLinkLabel?: string | null
}

export type VectorDriverListParams = {
  tenantId: string
  organizationId?: string | null
  entityId?: EntityId
  limit?: number
  offset?: number
  orderBy?: 'created' | 'updated'
}

export type VectorDriverCountParams = {
  tenantId: string
  organizationId?: string | null
  entityId?: EntityId
}

export type VectorDriverRemoveOrphansParams = {
  entityId: EntityId
  tenantId?: string | null
  organizationId?: string | null
  olderThan: Date
}

export interface VectorDriver {
  readonly id: VectorDriverId
  ensureReady(): Promise<void>
  upsert(doc: VectorDriverDocument): Promise<void>
  delete(entityId: EntityId, recordId: string, tenantId: string): Promise<void>
  query(input: VectorDriverQuery): Promise<VectorDriverQueryResult[]>
  getChecksum(entityId: EntityId, recordId: string, tenantId: string): Promise<string | null>
  purge?(entityId: EntityId, tenantId: string): Promise<void>
  list?(params: VectorDriverListParams): Promise<VectorIndexEntry[]>
  count?(params: VectorDriverCountParams): Promise<number>
  removeOrphans?(params: VectorDriverRemoveOrphansParams): Promise<number | void>
  getTableDimension?(): Promise<number | null>
  recreateWithDimension?(newDimension: number): Promise<void>
}

// ============================================================================
// Embedding Provider Configuration Types
// ============================================================================

export type EmbeddingProviderId =
  | 'openai'
  | 'google'
  | 'mistral'
  | 'cohere'
  | 'bedrock'
  | 'ollama'

export type EmbeddingProviderConfig = {
  providerId: EmbeddingProviderId
  model: string
  dimension: number
  outputDimensionality?: number
  baseUrl?: string
  updatedAt: string
}

export type EmbeddingModelInfo = {
  id: string
  name: string
  dimension: number
  configurableDimension?: boolean
  minDimension?: number
  maxDimension?: number
}

export type EmbeddingProviderInfo = {
  name: string
  envKeyRequired: string
  defaultModel: string
  models: EmbeddingModelInfo[]
}

export const EMBEDDING_PROVIDERS: Record<EmbeddingProviderId, EmbeddingProviderInfo> = {
  openai: {
    name: 'OpenAI',
    envKeyRequired: 'OPENAI_API_KEY',
    defaultModel: 'text-embedding-3-small',
    models: [
      { id: 'text-embedding-3-small', name: 'text-embedding-3-small', dimension: 1536 },
      { id: 'text-embedding-3-large', name: 'text-embedding-3-large', dimension: 3072, configurableDimension: true, minDimension: 256, maxDimension: 3072 },
      { id: 'text-embedding-ada-002', name: 'text-embedding-ada-002', dimension: 1536 },
    ],
  },
  google: {
    name: 'Google Generative AI',
    envKeyRequired: 'GOOGLE_GENERATIVE_AI_API_KEY',
    defaultModel: 'text-embedding-004',
    models: [
      { id: 'text-embedding-004', name: 'text-embedding-004', dimension: 768, configurableDimension: true, minDimension: 1, maxDimension: 768 },
      { id: 'embedding-001', name: 'embedding-001', dimension: 768 },
    ],
  },
  mistral: {
    name: 'Mistral',
    envKeyRequired: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-embed',
    models: [
      { id: 'mistral-embed', name: 'mistral-embed', dimension: 1024 },
    ],
  },
  cohere: {
    name: 'Cohere',
    envKeyRequired: 'COHERE_API_KEY',
    defaultModel: 'embed-english-v3.0',
    models: [
      { id: 'embed-english-v3.0', name: 'embed-english-v3.0', dimension: 1024 },
      { id: 'embed-multilingual-v3.0', name: 'embed-multilingual-v3.0', dimension: 1024 },
      { id: 'embed-english-light-v3.0', name: 'embed-english-light-v3.0', dimension: 384 },
      { id: 'embed-multilingual-light-v3.0', name: 'embed-multilingual-light-v3.0', dimension: 384 },
    ],
  },
  bedrock: {
    name: 'Amazon Bedrock',
    envKeyRequired: 'AWS_ACCESS_KEY_ID',
    defaultModel: 'amazon.titan-embed-text-v2:0',
    models: [
      { id: 'amazon.titan-embed-text-v2:0', name: 'Titan Embed Text v2', dimension: 1024, configurableDimension: true, minDimension: 256, maxDimension: 1024 },
      { id: 'amazon.titan-embed-text-v1', name: 'Titan Embed Text v1', dimension: 1536 },
      { id: 'cohere.embed-english-v3', name: 'Cohere Embed English v3', dimension: 1024 },
      { id: 'cohere.embed-multilingual-v3', name: 'Cohere Embed Multilingual v3', dimension: 1024 },
    ],
  },
  ollama: {
    name: 'Ollama (Local)',
    envKeyRequired: 'OLLAMA_BASE_URL',
    defaultModel: 'nomic-embed-text',
    models: [
      { id: 'nomic-embed-text', name: 'nomic-embed-text', dimension: 768 },
      { id: 'mxbai-embed-large', name: 'mxbai-embed-large', dimension: 1024 },
      { id: 'all-minilm', name: 'all-minilm', dimension: 384 },
      { id: 'snowflake-arctic-embed', name: 'snowflake-arctic-embed', dimension: 1024 },
    ],
  },
}

export const EMBEDDING_CONFIG_KEY = 'embedding_provider'

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingProviderConfig = {
  providerId: 'openai',
  model: 'text-embedding-3-small',
  dimension: 1536,
  updatedAt: new Date().toISOString(),
}
