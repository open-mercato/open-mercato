import { slugifySidebarId } from '@open-mercato/shared/modules/navigation/sidebarPreferences'

export type SidebarItem = {
  id?: string
  href: string
  title: string
  defaultTitle?: string
  icon?: React.ReactNode
  iconName?: string
  iconMarkup?: string
  enabled?: boolean
  hidden?: boolean
  pageContext?: 'main' | 'admin' | 'settings' | 'profile'
  children?: SidebarItem[]
}

export type SidebarGroup = {
  id?: string
  name: string
  defaultName?: string
  items: SidebarItem[]
}

export type SidebarCustomizationDraft = {
  order: string[]
  groupLabels: Record<string, string>
  itemLabels: Record<string, string>
  hiddenItemIds: Record<string, boolean>
  /** Per-group ordered item keys. Missing items keep their natural position at the tail. */
  itemOrder: Record<string, string[]>
}

export type SidebarRoleTarget = {
  id: string
  name: string
  hasPreference: boolean
}

export function resolveGroupKey(group: SidebarGroup): string {
  if (group.id && group.id.length) return group.id
  if (group.defaultName && group.defaultName.length) return slugifySidebarId(group.defaultName)
  return slugifySidebarId(group.name)
}

export function resolveItemKey(item: { id?: string; href: string }): string {
  const candidate = item.id?.trim()
  if (candidate && candidate.length > 0) return candidate
  return item.href
}

export function cloneSidebarGroups(groups: SidebarGroup[]): SidebarGroup[] {
  const cloneItem = (item: SidebarItem): SidebarItem => ({
    id: item.id,
    href: item.href,
    title: item.title,
    defaultTitle: item.defaultTitle,
    icon: item.icon,
    iconName: item.iconName,
    iconMarkup: item.iconMarkup,
    enabled: item.enabled,
    hidden: item.hidden,
    pageContext: item.pageContext,
    children: item.children ? item.children.map((child) => cloneItem(child)) : undefined,
  })
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    defaultName: group.defaultName,
    items: group.items.map((item) => cloneItem(item)),
  }))
}

export function mergeGroupOrder(preferred: string[], current: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const id of preferred) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed) || !current.includes(trimmed)) continue
    seen.add(trimmed)
    merged.push(trimmed)
  }
  for (const id of current) {
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(id)
  }
  return merged
}

/** Reorders items by preferred keys; items missing from `preferred` keep their original
 *  relative order at the tail. Drops keys that no longer exist. */
export function applyItemOrder<T>(items: T[], keyOf: (item: T) => string, preferred: string[] | undefined): T[] {
  if (!preferred || preferred.length === 0) return items
  const byKey = new Map<string, T>()
  for (const item of items) byKey.set(keyOf(item), item)
  const seen = new Set<string>()
  const ordered: T[] = []
  for (const key of preferred) {
    if (seen.has(key)) continue
    const match = byKey.get(key)
    if (!match) continue
    ordered.push(match)
    seen.add(key)
  }
  for (const item of items) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    ordered.push(item)
    seen.add(key)
  }
  return ordered
}

function applyItemDraft(item: SidebarItem, draft: SidebarCustomizationDraft): SidebarItem {
  const itemKey = resolveItemKey(item)
  const baseTitle = item.defaultTitle ?? item.title
  const override = draft.itemLabels[itemKey]?.trim()
  const children = item.children
    ? item.children.map((child) => applyItemDraft(child, draft))
    : undefined
  const hidden = draft.hiddenItemIds[itemKey] === true
  return {
    ...item,
    title: override && override.length > 0 ? override : baseTitle,
    hidden,
    children,
  }
}

export function applyCustomizationDraft(
  baseGroups: SidebarGroup[],
  draft: SidebarCustomizationDraft,
): SidebarGroup[] {
  const clones = cloneSidebarGroups(baseGroups)
  const byId = new Map<string, SidebarGroup>()
  for (const group of clones) {
    byId.set(resolveGroupKey(group), group)
  }
  const orderedIds = mergeGroupOrder(draft.order, Array.from(byId.keys()))
  const seen = new Set<string>()
  const result: SidebarGroup[] = []
  for (const id of orderedIds) {
    if (seen.has(id)) continue
    const group = byId.get(id)
    if (!group) continue
    seen.add(id)
    const baseName = group.defaultName ?? group.name
    const override = draft.groupLabels[id]?.trim()
    const orderedItems = applyItemOrder(group.items, resolveItemKey, draft.itemOrder?.[id])
    result.push({
      ...group,
      name: override && override.length > 0 ? override : baseName,
      items: orderedItems.map((item) => applyItemDraft(item, draft)),
    })
  }
  return result
}

/**
 * Filters groups to include only main sidebar items.
 * Excludes items with pageContext 'settings' or 'profile' from customization.
 * Per SPEC-007: Sidebar customization applies only to the main sidebar.
 */
export function filterMainSidebarGroups(groups: SidebarGroup[]): SidebarGroup[] {
  const isMainItem = (item: SidebarItem): boolean => {
    if (item.pageContext && item.pageContext !== 'main') return false
    return true
  }

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(isMainItem).map((item) => ({
        ...item,
        children: item.children?.filter(isMainItem),
      })),
    }))
    .filter((group) => group.items.length > 0)
}

export function collectSidebarDefaults(groups: SidebarGroup[]) {
  const groupDefaults = new Map<string, string>()
  const itemDefaults = new Map<string, string>()

  const visitItems = (items: SidebarItem[]) => {
    for (const item of items) {
      const key = resolveItemKey(item)
      const baseTitle = item.defaultTitle ?? item.title
      itemDefaults.set(key, baseTitle)
      // Backward-compatible alias for legacy stored href-based preferences.
      itemDefaults.set(item.href, baseTitle)
      if (item.children && item.children.length > 0) visitItems(item.children)
    }
  }

  for (const group of groups) {
    const key = resolveGroupKey(group)
    groupDefaults.set(key, group.defaultName ?? group.name)
    visitItems(group.items)
  }

  return { groupDefaults, itemDefaults }
}
