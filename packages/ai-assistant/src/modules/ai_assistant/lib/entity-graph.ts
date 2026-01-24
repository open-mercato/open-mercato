/**
 * Entity Relationship Graph Extraction
 *
 * Extracts entity relationships from MikroORM metadata and provides
 * them in a format suitable for AI tools to query.
 */

import { ReferenceKind, type MikroORM } from '@mikro-orm/core'
import type { PostgreSqlDriver } from '@mikro-orm/postgresql'

/**
 * Relationship types mapped from MikroORM reference kinds.
 */
export type RelationshipType =
  | 'BELONGS_TO' // ManyToOne
  | 'HAS_MANY' // OneToMany
  | 'HAS_ONE' // OneToOne (owner)
  | 'BELONGS_TO_ONE' // OneToOne (inverse)
  | 'HAS_MANY_MANY' // ManyToMany (owner)
  | 'BELONGS_TO_MANY' // ManyToMany (inverse)

/**
 * A relationship triple representing a connection between two entities.
 */
export interface EntityTriple {
  source: string
  relationship: RelationshipType
  target: string
  property: string
  nullable?: boolean
}

/**
 * An entity node with its properties.
 */
export interface EntityNode {
  className: string
  tableName: string
  properties: Array<{ name: string; type: string; nullable: boolean }>
}

/**
 * The complete entity graph with nodes and edges.
 */
export interface EntityGraph {
  nodes: EntityNode[]
  edges: EntityTriple[]
  generatedAt: string
}

/**
 * In-memory cache for the entity graph.
 */
let cachedGraph: EntityGraph | null = null

/**
 * Map MikroORM ReferenceKind to our RelationshipType.
 */
function mapReferenceKind(kind: ReferenceKind, mappedBy?: string): RelationshipType {
  switch (kind) {
    case ReferenceKind.MANY_TO_ONE:
      return 'BELONGS_TO'
    case ReferenceKind.ONE_TO_MANY:
      return 'HAS_MANY'
    case ReferenceKind.ONE_TO_ONE:
      // If mappedBy is set, this is the inverse side
      return mappedBy ? 'BELONGS_TO_ONE' : 'HAS_ONE'
    case ReferenceKind.MANY_TO_MANY:
      // If mappedBy is set, this is the inverse side
      return mappedBy ? 'BELONGS_TO_MANY' : 'HAS_MANY_MANY'
    default:
      return 'BELONGS_TO'
  }
}

/**
 * Get a simple type name from MikroORM property type.
 */
function getSimpleTypeName(type: string | ((...args: unknown[]) => unknown) | undefined): string {
  if (!type) return 'unknown'
  if (typeof type === 'function') return type.name || 'unknown'
  return type
}

/**
 * Extract the entity graph from MikroORM metadata.
 */
export async function extractEntityGraph(orm: MikroORM<PostgreSqlDriver>): Promise<EntityGraph> {
  const metadata = orm.getMetadata()
  const allMetadata = metadata.getAll()

  const nodes: EntityNode[] = []
  const edges: EntityTriple[] = []

  for (const [, entityMeta] of Object.entries(allMetadata)) {
    // Skip abstract entities and embeddables
    if (entityMeta.abstract || entityMeta.embeddable) continue

    // Skip internal MikroORM entities
    if (entityMeta.className.startsWith('MikroORM')) continue

    const properties: Array<{ name: string; type: string; nullable: boolean }> = []

    for (const prop of entityMeta.props) {
      // Skip internal properties
      if (prop.name.startsWith('_')) continue

      // Handle relationships
      if (prop.kind !== undefined && prop.kind !== ReferenceKind.SCALAR) {
        // This is a relationship property
        const targetEntity = prop.type
        if (targetEntity && targetEntity !== entityMeta.className) {
          const relationship = mapReferenceKind(prop.kind, prop.mappedBy)

          edges.push({
            source: entityMeta.className,
            relationship,
            target: targetEntity,
            property: prop.name,
            nullable: prop.nullable ?? false,
          })
        }
      } else {
        // Regular scalar property
        properties.push({
          name: prop.name,
          type: getSimpleTypeName(prop.type),
          nullable: prop.nullable ?? false,
        })
      }
    }

    nodes.push({
      className: entityMeta.className,
      tableName: entityMeta.tableName,
      properties,
    })
  }

  // Sort for consistent output
  nodes.sort((a, b) => a.className.localeCompare(b.className))
  edges.sort((a, b) => {
    const sourceCompare = a.source.localeCompare(b.source)
    if (sourceCompare !== 0) return sourceCompare
    return a.property.localeCompare(b.property)
  })

  return {
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Format the entity graph as readable triples.
 *
 * Example output:
 *   (CustomerEntity)-[HAS_MANY:deals]->(CustomerDeal)
 *   (SalesOrder)-[BELONGS_TO:channel]->(SalesChannel)
 */
export function formatGraphAsTriples(graph: EntityGraph): string[] {
  return graph.edges.map((edge) => {
    const nullable = edge.nullable ? '?' : ''
    return `(${edge.source})-[${edge.relationship}${nullable}:${edge.property}]->(${edge.target})`
  })
}

/**
 * Cache the entity graph in memory.
 */
export function cacheEntityGraph(graph: EntityGraph): void {
  cachedGraph = graph
}

/**
 * Retrieve the cached entity graph.
 */
export function getCachedEntityGraph(): EntityGraph | null {
  return cachedGraph
}

/**
 * Filter graph edges by entity name (source or target).
 */
export function filterGraphByEntity(graph: EntityGraph, entityName: string): EntityTriple[] {
  const lowerEntity = entityName.toLowerCase()
  return graph.edges.filter(
    (edge) => edge.source.toLowerCase().includes(lowerEntity) || edge.target.toLowerCase().includes(lowerEntity)
  )
}

/**
 * Filter graph edges by module (inferred from table name prefix).
 */
export function filterGraphByModule(graph: EntityGraph, moduleName: string): EntityTriple[] {
  const lowerModule = moduleName.toLowerCase()

  // Find entities that belong to this module (by table name prefix or class name)
  const moduleEntities = new Set<string>()
  for (const node of graph.nodes) {
    if (node.tableName.startsWith(lowerModule) || node.className.toLowerCase().includes(lowerModule)) {
      moduleEntities.add(node.className)
    }
  }

  return graph.edges.filter((edge) => moduleEntities.has(edge.source) || moduleEntities.has(edge.target))
}

/**
 * Filter graph edges by relationship type.
 */
export function filterGraphByType(graph: EntityGraph, type: RelationshipType): EntityTriple[] {
  return graph.edges.filter((edge) => edge.relationship === type)
}

/**
 * Get entity fields for a specific entity.
 */
export function getEntityFields(graph: EntityGraph, entityName: string): EntityNode | undefined {
  const lowerEntity = entityName.toLowerCase()
  return graph.nodes.find((node) => node.className.toLowerCase() === lowerEntity)
}

/**
 * List all entities grouped by inferred module.
 */
export function listEntitiesByModule(graph: EntityGraph): Map<string, string[]> {
  const byModule = new Map<string, string[]>()

  for (const node of graph.nodes) {
    // Infer module from table name prefix (e.g., 'sales_orders' -> 'sales')
    const module = inferModuleFromEntity(node.className, node.tableName)

    const existing = byModule.get(module) ?? []
    existing.push(node.className)
    byModule.set(module, existing)
  }

  return byModule
}

/**
 * Infer module name from entity class name or table name.
 *
 * Patterns:
 * - Table prefix: 'sales_orders' → 'sales'
 * - Class prefix: 'SalesOrder' → 'sales' (PascalCase to module)
 * - Common mappings: CustomerEntity → 'customers', CatalogProduct → 'catalog'
 */
export function inferModuleFromEntity(className: string, tableName: string): string {
  // First try table name prefix (most reliable)
  const tableParts = tableName.split('_')
  if (tableParts.length > 1) {
    return tableParts[0]
  }

  // Try to extract from class name (e.g., SalesOrder → sales)
  // Handle common entity suffixes
  const nameWithoutSuffix = className
    .replace(/Entity$/, '')
    .replace(/Model$/, '')

  // Extract the first word from PascalCase
  const match = nameWithoutSuffix.match(/^([A-Z][a-z]+)/)
  if (match) {
    const prefix = match[1].toLowerCase()
    // Map common prefixes to module names
    const moduleMap: Record<string, string> = {
      sales: 'sales',
      customer: 'customers',
      catalog: 'catalog',
      product: 'catalog',
      order: 'sales',
      invoice: 'sales',
      quote: 'sales',
      auth: 'auth',
      user: 'auth',
      tenant: 'auth',
      organization: 'auth',
      workflow: 'workflows',
      config: 'configs',
      dictionary: 'dictionaries',
      entity: 'entities',
      search: 'search',
      attachment: 'attachments',
      audit: 'audit_logs',
      api: 'api_keys',
      dashboard: 'dashboards',
      widget: 'widgets',
      feature: 'feature_toggles',
      perspective: 'perspectives',
      currency: 'currencies',
      content: 'content',
      onboarding: 'onboarding',
    }
    if (moduleMap[prefix]) {
      return moduleMap[prefix]
    }
    return prefix
  }

  return 'core'
}

/**
 * Convert entity class name to expected API path pattern.
 *
 * Examples:
 * - SalesOrder → /api/sales/orders
 * - CatalogProduct → /api/catalog/products
 * - CustomerCompany → /api/customers/companies
 */
export function entityNameToApiPath(className: string, tableName: string): string {
  const module = inferModuleFromEntity(className, tableName)

  // Extract resource name from table (e.g., 'sales_orders' → 'orders')
  const tableParts = tableName.split('_')
  let resource: string

  if (tableParts.length > 1) {
    // Remove module prefix from table name
    resource = tableParts.slice(1).join('_').replace(/_/g, '-')
  } else {
    // Fallback: derive from class name
    const nameWithoutSuffix = className
      .replace(/Entity$/, '')
      .replace(/Model$/, '')

    // Convert PascalCase to kebab-case and pluralize
    resource = nameWithoutSuffix
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '')

    // Simple pluralization
    if (!resource.endsWith('s')) {
      resource += 's'
    }
  }

  return `/api/${module}/${resource}`
}

/**
 * Get both outgoing and incoming relationships for an entity.
 */
export function getEntityRelationships(
  graph: EntityGraph,
  entityName: string
): { outgoing: EntityTriple[]; incoming: EntityTriple[] } {
  const outgoing = graph.edges.filter(
    (edge) => edge.source.toLowerCase() === entityName.toLowerCase()
  )
  const incoming = graph.edges.filter(
    (edge) =>
      edge.target.toLowerCase() === entityName.toLowerCase() &&
      edge.source.toLowerCase() !== entityName.toLowerCase()
  )
  return { outgoing, incoming }
}

/**
 * Format a single relationship triple as a string.
 */
export function formatTriple(edge: EntityTriple): string {
  const nullable = edge.nullable ? '?' : ''
  return `(${edge.source})-[${edge.relationship}${nullable}:${edge.property}]->(${edge.target})`
}

/**
 * Get graph statistics.
 */
export function getGraphStats(graph: EntityGraph): {
  totalEntities: number
  totalRelationships: number
  modules: string[]
} {
  const byModule = listEntitiesByModule(graph)
  return {
    totalEntities: graph.nodes.length,
    totalRelationships: graph.edges.length,
    modules: Array.from(byModule.keys()).sort(),
  }
}
