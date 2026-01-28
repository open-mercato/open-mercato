/**
 * Entity Schema Index
 *
 * Indexes database entity schemas in Meilisearch for discovery
 * via the discover_schema MCP tool.
 */

import type { SearchService } from '@open-mercato/search/service'
import type { IndexableRecord } from '@open-mercato/search/types'
import type { EntityGraph } from './entity-graph'
import { inferModuleFromEntity } from './entity-graph'
import {
  entityToIndexableRecord,
  computeEntitiesChecksum,
  type IndexedEntity,
} from './entity-index-config'

/**
 * Checksum from last indexing operation
 */
let lastIndexChecksum: string | null = null

/**
 * Index entity schemas for search discovery using hybrid search strategies.
 * Uses checksum-based change detection to avoid unnecessary re-indexing.
 *
 * @param searchService - The search service to use for indexing
 * @param graph - The entity graph containing all entities and relationships
 * @param force - Force re-indexing even if checksum hasn't changed
 * @returns Object with count of indexed entities
 */
export async function indexEntitiesForSearch(
  searchService: SearchService,
  graph: EntityGraph,
  force = false
): Promise<{ count: number }> {
  if (graph.nodes.length === 0) {
    console.error('[Entity Index] No entities to index')
    return { count: 0 }
  }

  // Build indexed entity records from graph
  const indexedEntities: IndexedEntity[] = graph.nodes.map((node) => {
    // Find all outgoing relationships for this entity
    const relationships = graph.edges
      .filter((edge) => edge.source === node.className)
      .map((edge) => ({
        relationship: edge.relationship,
        target: edge.target,
        property: edge.property,
        nullable: edge.nullable,
      }))

    return {
      className: node.className,
      tableName: node.tableName,
      module: inferModuleFromEntity(node.className, node.tableName),
      fields: node.properties,
      relationships,
    }
  })

  // Compute checksum to detect changes
  const checksum = computeEntitiesChecksum(
    indexedEntities.map((e) => ({
      className: e.className,
      tableName: e.tableName,
      fieldCount: e.fields.length,
    }))
  )

  // Skip if checksum matches and not forced
  if (!force && lastIndexChecksum === checksum) {
    console.error(`[Entity Index] Skipping indexing - ${indexedEntities.length} entities unchanged`)
    return { count: 0 }
  }

  // Convert to indexable records
  const records: IndexableRecord[] = indexedEntities.map((entity) =>
    entityToIndexableRecord(entity)
  )

  try {
    console.error(`[Entity Index] Starting bulk index of ${records.length} entities...`)

    // Bulk index using all available strategies (fulltext + vector)
    // Use Promise.race with timeout to prevent hanging
    const timeoutMs = 60000 // 60 second timeout
    const indexPromise = searchService.bulkIndex(records)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Bulk index timed out after ${timeoutMs}ms`)), timeoutMs)
    )

    await Promise.race([indexPromise, timeoutPromise])
    lastIndexChecksum = checksum
    console.error(`[Entity Index] Indexed ${records.length} entity schemas for hybrid search`)
    return { count: records.length }
  } catch (error) {
    console.error('[Entity Index] Failed to index entities:', error)
    // Still update checksum - some strategies may have succeeded
    lastIndexChecksum = checksum
    return { count: records.length }
  }
}

/**
 * Clear entity index cache (for testing)
 */
export function clearEntityIndexCache(): void {
  lastIndexChecksum = null
}
