import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { EntityId } from './entities'

export type VectorSearchLink = {
  href: string
  label: string
  icon?: string | null
  relation?: string | null
}

export type VectorSearchBuildContext = {
  entity: EntityId
  recordId: string
  organizationId: string | null
  tenantId: string | null
  em: EntityManager
  knex: Knex
  indexDoc: Record<string, unknown> | null
}

export type VectorSearchBuildResult = {
  title: string
  lead?: string | null
  icon?: string | null
  url: string
  urlLabel?: string | null
  links?: VectorSearchLink[]
  text?: string | string[]
  extraTexts?: string[]
  metadata?: Record<string, unknown>
  searchTerms?: string[]
}

export type VectorSearchEntitySpec = {
  enabled?: boolean
  embeddingModel?: string
  embeddingDimensions?: number
  includeIndexDoc?: boolean
  build: (ctx: VectorSearchBuildContext) => Promise<VectorSearchBuildResult | null> | VectorSearchBuildResult | null
}

export type VectorSearchEntityConfig = VectorSearchEntitySpec & {
  entity: EntityId
}
