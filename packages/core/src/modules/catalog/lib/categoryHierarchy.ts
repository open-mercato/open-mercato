import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductCategory } from '../data/entities'

export type ComputedCategoryNode = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  pathLabel: string
  parentId: string | null
  depth: number
  rootId: string
  treePath: string
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
  isActive: boolean
}

export type ComputedCategoryHierarchy = {
  map: Map<string, ComputedCategoryNode>
  ordered: ComputedCategoryNode[]
}

type InternalNode = {
  category: CatalogProductCategory
  parentId: string | null
  children: Set<string>
}

function normalizeId(value: unknown): string | null {
  if (!value) return null
  const normalized = String(value).trim()
  if (!normalized || normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'undefined') {
    return null
  }
  return normalized
}

export function computeHierarchyForCategories(categories: CatalogProductCategory[]): ComputedCategoryHierarchy {
  const nodes = new Map<string, InternalNode>()

  for (const category of categories) {
    const id = String(category.id)
    nodes.set(id, {
      category,
      parentId: normalizeId(category.parentId),
      children: new Set<string>(),
    })
  }

  for (const [id, node] of nodes) {
    const parentId = node.parentId
    if (!parentId || parentId === id || !nodes.has(parentId)) {
      node.parentId = null
      continue
    }
    nodes.get(parentId)!.children.add(id)
  }

  const computed = new Map<string, ComputedCategoryNode>()
  const orderedIds: string[] = []
  const orderedSet = new Set<string>()
  const visited = new Set<string>()

  function walk(nodeId: string, ancestors: string[]): string[] {
    if (ancestors.includes(nodeId)) {
      const cyclic = nodes.get(nodeId)
      if (cyclic) {
        const entry: ComputedCategoryNode = {
          id: nodeId,
          tenantId: cyclic.category.tenantId,
          organizationId: cyclic.category.organizationId,
          name: cyclic.category.name,
          pathLabel: cyclic.category.name,
          parentId: null,
          depth: 0,
          rootId: nodeId,
          treePath: nodeId,
          ancestorIds: [],
          childIds: [],
          descendantIds: [],
          isActive: !!cyclic.category.isActive,
        }
        computed.set(nodeId, entry)
        if (!orderedSet.has(nodeId)) {
          orderedIds.push(nodeId)
          orderedSet.add(nodeId)
        }
      }
      visited.add(nodeId)
      return []
    }

    const node = nodes.get(nodeId)
    if (!node) return []

    visited.add(nodeId)
    const category = node.category
    const id = String(category.id)
    const nextAncestors = [...ancestors, id]
    if (!orderedSet.has(id)) {
      orderedIds.push(id)
      orderedSet.add(id)
    }

    const childIds = Array.from(node.children)
      .filter((childId) => nodes.has(childId))
      .sort((a, b) => {
        const an = nodes.get(a)!.category.name.toLowerCase()
        const bn = nodes.get(b)!.category.name.toLowerCase()
        return an === bn ? a.localeCompare(b) : an.localeCompare(b)
      })

    const descendantIds: string[] = []
    for (const childId of childIds) {
      const desc = walk(childId, nextAncestors)
      descendantIds.push(childId, ...desc)
    }

    const ancestorIds = ancestors
    const depth = ancestorIds.length
    const rootId = ancestorIds.length ? ancestorIds[0]! : id
    const treePath = nextAncestors.join('/')
    const ancestorNames = ancestors
      .map((ancestorId) => nodes.get(ancestorId)?.category.name)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    const pathLabel = [...ancestorNames, category.name].join(' / ')

    const computedNode: ComputedCategoryNode = {
      id,
      tenantId: category.tenantId,
      organizationId: category.organizationId,
      name: category.name,
      pathLabel,
      parentId: node.parentId,
      depth,
      rootId,
      treePath,
      ancestorIds,
      childIds,
      descendantIds,
      isActive: !!category.isActive,
    }
    computed.set(id, computedNode)
    return descendantIds
  }

  for (const [id, node] of nodes) {
    if (!node.parentId || !nodes.has(node.parentId)) {
      walk(id, [])
    }
  }

  for (const id of nodes.keys()) {
    if (!visited.has(id)) {
      walk(id, [])
    }
  }

  const ordered = orderedIds
    .map((id) => computed.get(id))
    .filter((node): node is ComputedCategoryNode => !!node)

  return { map: computed, ordered }
}

export async function rebuildCategoryHierarchyForOrganization(
  em: EntityManager,
  organizationId: string,
  tenantId: string
): Promise<ComputedCategoryHierarchy> {
  const categories = await em.find(
    CatalogProductCategory,
    { organizationId, tenantId, deletedAt: null },
    { orderBy: { name: 'ASC' } }
  )
  const hierarchy = computeHierarchyForCategories(categories)
  const now = new Date()
  for (const category of categories) {
    const computed = hierarchy.map.get(String(category.id))
    if (!computed) {
      category.parentId = null
      category.rootId = String(category.id)
      category.treePath = String(category.id)
      category.depth = 0
      category.ancestorIds = []
      category.childIds = []
      category.descendantIds = []
      category.updatedAt = now
      continue
    }
    category.parentId = computed.parentId
    category.rootId = computed.rootId
    category.treePath = computed.treePath
    category.depth = computed.depth
    category.ancestorIds = computed.ancestorIds
    category.childIds = computed.childIds
    category.descendantIds = computed.descendantIds
    category.updatedAt = now
  }
  await em.flush()
  return hierarchy
}
