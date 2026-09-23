// Pure helpers shared by the create/edit `CustomerGroup` admin pages and widgets: list
// item → summary mapping, the depth-warning threshold (spec §5.1 caps nesting at depth
// 5), and the "another group is already default" lookup used by the isDefault conflict
// notice. No React here so any consumer can reuse it without a component import.

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

// The `/api/customer_groups/customer-groups` list route returns the query-index column projection
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

// Spec §5.1: hierarchy depth is capped at 5. A candidate parent whose own ancestor
// chain is already 4+ levels deep would put the group being created/edited at depth 5
// or deeper — surfaced as a non-blocking warning (the spec says "warns", not "prevents").
export const CUSTOMER_GROUP_DEPTH_WARNING_THRESHOLD = 4

// The tenant's current default group, if any, excluding the group being edited.
export function findDefaultConflict(
  groups: CustomerGroupSummary[],
  excludeId?: string | null,
): CustomerGroupSummary | null {
  return groups.find((group) => group.isDefault && group.id !== excludeId) ?? null
}
