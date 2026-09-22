// Pure helpers shared by the create/edit `CustomerGroup` admin pages: parent-picker
// cycle prevention (self + descendant exclusion), the depth-warning heuristic (spec
// §5.1 caps nesting at depth 5), and the "another group is already default" lookup
// used by the isDefault conflict notice. No React here so both pages (and any future
// consumer, e.g. the list page's orphan banner) can reuse it without a component import.

export type CustomerGroupSummary = {
  id: string
  code: string
  name: string
  parentId: string | null
  isDefault: boolean
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// The `/api/customer-groups` list route returns the query-index column projection
// (snake_case keys, e.g. `parent_id`, `is_default`) rather than the camelCase shape
// other CRUD routes normalize to — see `api/customer-groups/crud.ts` `customerGroupListFields`.
// Accept both spellings so this helper keeps working if that ever changes.
function readNullableId(record: Record<string, unknown>, camelKey: string, snakeKey: string): string | null {
  const camel = record[camelKey]
  if (typeof camel === 'string' && camel.length) return camel
  const snake = record[snakeKey]
  if (typeof snake === 'string' && snake.length) return snake
  return null
}

function readBoolean(record: Record<string, unknown>, camelKey: string, snakeKey: string): boolean {
  return record[camelKey] === true || record[snakeKey] === true
}

export function mapListItemToSummary(item: unknown): CustomerGroupSummary | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const id = readString(record.id)
  if (!id) return null
  return {
    id,
    code: readString(record.code),
    name: readString(record.name),
    parentId: readNullableId(record, 'parentId', 'parent_id'),
    isDefault: readBoolean(record, 'isDefault', 'is_default'),
  }
}

export function mapListItemsToSummaries(items: unknown): CustomerGroupSummary[] {
  if (!Array.isArray(items)) return []
  return items.reduce<CustomerGroupSummary[]>((acc, item) => {
    const summary = mapListItemToSummary(item)
    if (summary) acc.push(summary)
    return acc
  }, [])
}

// BFS over `parentId` edges — used to exclude a group's own descendants from its
// parent picker so an edit can never introduce a cycle in the hierarchy.
export function collectDescendantIds(rootId: string, groups: CustomerGroupSummary[]): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  for (const group of groups) {
    if (!group.parentId) continue
    const list = childrenByParent.get(group.parentId) ?? []
    list.push(group.id)
    childrenByParent.set(group.parentId, list)
  }
  const result = new Set<string>()
  const queue: string[] = [rootId]
  while (queue.length) {
    const current = queue.shift() as string
    const children = childrenByParent.get(current) ?? []
    for (const childId of children) {
      if (result.has(childId)) continue
      result.add(childId)
      queue.push(childId)
    }
  }
  return result
}

// Length of the candidate parent's own ancestor chain (parent + its ancestors, up to
// root). A `visited` guard keeps this safe even against already-corrupt cyclical data.
export function ancestorChainLength(parentId: string | null, groups: CustomerGroupSummary[]): number {
  if (!parentId) return 0
  const byId = new Map(groups.map((group) => [group.id, group]))
  const visited = new Set<string>()
  let current: string | null = parentId
  let length = 0
  while (current && !visited.has(current)) {
    visited.add(current)
    length += 1
    const group = byId.get(current)
    current = group?.parentId ?? null
  }
  return length
}

// Spec §5.1: hierarchy depth is capped at 5. A candidate parent whose own ancestor
// chain is already 4+ levels deep would put the group being created/edited at depth 5
// or deeper — surfaced as a non-blocking warning (the spec says "warns", not "prevents").
export const CUSTOMER_GROUP_DEPTH_WARNING_THRESHOLD = 4

export function wouldExceedRecommendedDepth(parentId: string | null, groups: CustomerGroupSummary[]): boolean {
  return ancestorChainLength(parentId, groups) >= CUSTOMER_GROUP_DEPTH_WARNING_THRESHOLD
}

// The tenant's current default group, if any, excluding the group being edited.
export function findDefaultConflict(
  groups: CustomerGroupSummary[],
  excludeId?: string | null,
): CustomerGroupSummary | null {
  return groups.find((group) => group.isDefault && group.id !== excludeId) ?? null
}
