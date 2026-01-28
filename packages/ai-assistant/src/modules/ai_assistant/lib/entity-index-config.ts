/**
 * Entity Schema Index Configuration
 *
 * Defines how database entity schemas are indexed in Meilisearch
 * for discovery via the discover_schema MCP tool.
 */

import type {
  SearchEntityConfig,
  SearchResultPresenter,
  IndexableRecord,
} from '@open-mercato/search/types'
import type { EntityNode, EntityTriple } from './entity-graph'

/**
 * Entity ID for entity schemas in the search index.
 * Following the module:entity naming convention.
 */
export const ENTITY_SCHEMA_ENTITY_ID = 'ai_assistant:entity_schema' as const

/**
 * Tenant ID for global entity schemas.
 * Entity schemas are not tenant-scoped, so we use a special "system" UUID.
 * This is the nil UUID (all zeros) reserved for system-wide resources.
 */
export const GLOBAL_TENANT_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Default configuration for entity schema search.
 */
export const ENTITY_SCHEMA_SEARCH_CONFIG = {
  /** Maximum entities to return from search */
  defaultLimit: 10,
  /** Minimum relevance score (0-1) */
  minScore: 0.15,
  /** Strategies to use (in priority order) */
  strategies: ['fulltext', 'vector'] as const,
} as const

/**
 * Indexed entity structure with full schema information.
 */
export interface IndexedEntity {
  className: string
  tableName: string
  module: string
  fields: Array<{ name: string; type: string; nullable: boolean }>
  relationships: Array<{ relationship: string; target: string; property: string; nullable?: boolean }>
}

/**
 * Search entity configuration for entity schemas.
 * This configures how entities are indexed and searched.
 */
export const entitySchemaEntityConfig: SearchEntityConfig = {
  entityId: ENTITY_SCHEMA_ENTITY_ID,
  enabled: true,
  priority: 95, // High priority, above API endpoints

  /**
   * Build searchable content from an entity schema.
   */
  buildSource: (ctx) => {
    const entity = ctx.record as unknown as IndexedEntity
    const className = entity.className || ''
    const tableName = entity.tableName || ''
    const module = entity.module || ''
    const fields = entity.fields || []
    const relationships = entity.relationships || []

    // Build text content for embedding and fulltext search
    const textParts = [
      className,
      tableName.replace(/_/g, ' '),
      module,
      // Include field names for searchability
      ...fields.map((f) => f.name),
      // Include relationship targets for searchability
      ...relationships.map((r) => r.target),
    ]

    return {
      text: textParts.filter(Boolean).join(' | '),
      fields: {
        className,
        tableName,
        module,
        fieldCount: fields.length,
        relationshipCount: relationships.length,
        // Store full schema as JSON for retrieval
        schema: JSON.stringify({
          fields,
          relationships,
        }),
      },
      presenter: {
        title: className,
        subtitle: `${module} • ${fields.length} fields`,
        icon: 'lucide:database',
      },
      checksumSource: { className, tableName, fieldCount: fields.length },
    }
  },

  /**
   * Format result for display in search UI.
   */
  formatResult: (ctx) => {
    const entity = ctx.record as unknown as IndexedEntity
    return {
      title: entity.className,
      subtitle: `${entity.module} • ${entity.fields?.length ?? 0} fields`,
      icon: 'lucide:database',
    }
  },

  /**
   * Field policy for search strategies.
   */
  fieldPolicy: {
    searchable: ['className', 'tableName', 'module'],
    hashOnly: [],
    excluded: ['schema'], // Don't index the full JSON schema
  },
}

/**
 * Build search text from entity node and relationships.
 */
function buildSearchText(entity: IndexedEntity): string {
  const parts = [
    entity.className,
    entity.tableName.replace(/_/g, ' '),
    entity.module,
    // Include all field names
    ...entity.fields.map((f) => f.name),
    // Include relationship targets
    ...entity.relationships.map((r) => `${r.relationship} ${r.target}`),
  ]
  return parts.filter(Boolean).join(' | ')
}

/**
 * Convert an entity schema to an indexable record for search.
 *
 * @param entity - The entity with full schema info
 * @returns IndexableRecord ready for search indexing
 */
export function entityToIndexableRecord(entity: IndexedEntity): IndexableRecord {
  const presenter: SearchResultPresenter = {
    title: entity.className,
    subtitle: `${entity.module} • ${entity.fields.length} fields`,
    icon: 'lucide:database',
  }

  return {
    entityId: ENTITY_SCHEMA_ENTITY_ID,
    recordId: entity.className,
    tenantId: GLOBAL_TENANT_ID,
    organizationId: null,
    fields: {
      className: entity.className,
      tableName: entity.tableName,
      module: entity.module,
      fieldCount: entity.fields.length,
      relationshipCount: entity.relationships.length,
      // Store full schema as JSON for retrieval
      schema: JSON.stringify({
        fields: entity.fields,
        relationships: entity.relationships,
      }),
    },
    presenter,
    text: buildSearchText(entity),
    checksumSource: {
      className: entity.className,
      tableName: entity.tableName,
      fieldCount: entity.fields.length,
    },
  }
}

/**
 * Compute a simple checksum for entity definitions.
 * Used to detect changes and avoid unnecessary re-indexing.
 */
export function computeEntitiesChecksum(
  entities: Array<{ className: string; tableName: string; fieldCount: number }>
): string {
  const content = entities
    .map((e) => `${e.className}:${e.tableName}:${e.fieldCount}`)
    .sort()
    .join('|')

  // Simple hash using string code points
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return hash.toString(16)
}
