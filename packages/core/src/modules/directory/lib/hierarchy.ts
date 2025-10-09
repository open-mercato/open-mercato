import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

export type ComputedOrganizationNode = {
  id: string
  tenantId: string
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

export type ComputedHierarchy = {
  map: Map<string, ComputedOrganizationNode>
  ordered: ComputedOrganizationNode[]
}

type InternalNode = {
  org: Organization
  parentId: string | null
  children: Set<string>
}

function normalizeUuid(value: unknown): string | null {
  if (!value) return null
  const v = String(value).trim()
  if (!v || v.toLowerCase() === 'null' || v.toLowerCase() === 'undefined') return null
  return v
}

export function computeHierarchyForOrganizations(organizations: Organization[], tenantId: string): ComputedHierarchy {
  const nodes = new Map<string, InternalNode>()

  for (const org of organizations) {
    const id = String(org.id)
    const node: InternalNode = {
      org,
      parentId: normalizeUuid(org.parentId),
      children: new Set<string>(),
    }
    nodes.set(id, node)
  }

  // Establish child relationships (ignore missing parents or self-references)
  for (const [id, node] of nodes) {
    const parentId = node.parentId
    if (!parentId || parentId === id) {
      node.parentId = null
      continue
    }
    const parent = nodes.get(parentId)
    if (!parent) {
      node.parentId = null
      continue
    }
    parent.children.add(id)
  }

  const computed = new Map<string, ComputedOrganizationNode>()
  const orderedIds: string[] = []
  const orderedSet = new Set<string>()
  const visited = new Set<string>()

  function walk(nodeId: string, ancestors: string[]): string[] {
    if (ancestors.includes(nodeId)) {
      // Cycle detected; break by treating as root
      const orgName = nodes.get(nodeId)?.org.name || ''
      computed.set(nodeId, {
        id: nodeId,
        tenantId,
        name: orgName,
        pathLabel: orgName,
        parentId: null,
        depth: 0,
        rootId: nodeId,
        treePath: nodeId,
        ancestorIds: [],
        childIds: [],
        descendantIds: [],
        isActive: nodes.get(nodeId)?.org.isActive ?? true,
      })
      if (!orderedSet.has(nodeId)) {
        orderedIds.push(nodeId)
        orderedSet.add(nodeId)
      }
      visited.add(nodeId)
      return []
    }

    const node = nodes.get(nodeId)
    if (!node) return []

    visited.add(nodeId)
    const org = node.org
    const id = String(org.id)
    const nextAncestors = [...ancestors, id]
    if (!orderedSet.has(id)) {
      orderedIds.push(id)
      orderedSet.add(id)
    }
    const childIds = Array.from(node.children)
      .filter((childId) => nodes.has(childId))
      .sort((a, b) => {
        const an = nodes.get(a)!.org.name.toLowerCase()
        const bn = nodes.get(b)!.org.name.toLowerCase()
        if (an === bn) return a.localeCompare(b)
        return an.localeCompare(b)
      })

    const descendantIds: string[] = []
    for (const childId of childIds) {
      const desc = walk(childId, nextAncestors)
      descendantIds.push(childId, ...desc)
    }

    const ancestorIds = ancestors
    const depth = ancestorIds.length
    const rootId = ancestorIds.length ? ancestorIds[0] : id
    const treePath = nextAncestors.join('/')
    const ancestorNames = ancestors
      .map((ancestorId) => nodes.get(ancestorId)?.org.name)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    const pathLabel = [...ancestorNames, org.name].join(' / ')

    const computedNode: ComputedOrganizationNode = {
      id,
      tenantId,
      name: org.name,
      pathLabel,
      parentId: node.parentId,
      depth,
      rootId,
      treePath,
      ancestorIds,
      childIds,
      descendantIds,
      isActive: !!org.isActive,
    }
    computed.set(id, computedNode)
    return descendantIds
  }

  // Walk roots first (nodes without parent or whose parent is missing)
  for (const [id, node] of nodes) {
    if (!node.parentId || !nodes.has(node.parentId)) {
      walk(id, [])
    }
  }
  // Handle orphaned nodes or cycles not reached above
  for (const id of nodes.keys()) {
    if (!visited.has(id)) {
      walk(id, [])
    }
  }

  const ordered = orderedIds
    .map((id) => computed.get(id))
    .filter((node): node is ComputedOrganizationNode => !!node)

  return { map: computed, ordered }
}

export async function rebuildHierarchyForTenant(em: EntityManager, tenantId: string): Promise<ComputedHierarchy> {
  const organizations = await em.find(Organization, { tenant: tenantId as any, deletedAt: null }, { orderBy: { name: 'ASC' } })
  const hierarchy = computeHierarchyForOrganizations(organizations, tenantId)
  const now = new Date()

  for (const org of organizations) {
    const computed = hierarchy.map.get(String(org.id))
    if (!computed) {
      org.parentId = null
      org.rootId = String(org.id)
      org.treePath = String(org.id)
      org.depth = 0
      org.ancestorIds = []
      org.childIds = []
      org.descendantIds = []
      org.updatedAt = now
      continue
    }
    org.parentId = computed.parentId
    org.rootId = computed.rootId
    org.treePath = computed.treePath
    org.depth = computed.depth
    org.ancestorIds = computed.ancestorIds
    org.childIds = computed.childIds
    org.descendantIds = computed.descendantIds
    org.updatedAt = now
  }

  await em.flush()
  return hierarchy
}
