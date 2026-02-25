import type { InjectionMenuItem } from '@open-mercato/shared/modules/widgets/injection'
import { insertByInjectionPlacement } from '@open-mercato/shared/modules/widgets/injection-position'

export type MergedMenuItem = {
  id: string
  label?: string
  labelKey?: string
  icon?: string
  href?: string
  onClick?: () => void
  separator?: boolean
  badge?: string | number
  groupId?: string
  groupLabel?: string
  groupLabelKey?: string
  groupOrder?: number
  children?: Omit<InjectionMenuItem, 'children'>[]
  source: 'built-in' | 'injected'
}

type BuiltInMenuItem = {
  id: string
  [key: string]: unknown
}

function toMergedInjectedItem(item: InjectionMenuItem): MergedMenuItem {
  return {
    id: item.id,
    label: item.label,
    labelKey: item.labelKey,
    icon: item.icon,
    href: item.href,
    onClick: item.onClick,
    separator: item.separator,
    badge: item.badge,
    groupId: item.groupId,
    groupLabel: item.groupLabel,
    groupLabelKey: item.groupLabelKey,
    groupOrder: item.groupOrder,
    children: item.children,
    source: 'injected',
  }
}

export function mergeMenuItems(
  builtIn: BuiltInMenuItem[],
  injected: InjectionMenuItem[],
): MergedMenuItem[] {
  let merged: MergedMenuItem[] = builtIn.map((item) => ({
    ...(item as Record<string, unknown>),
    id: item.id,
    source: 'built-in',
  })) as MergedMenuItem[]

  for (const item of injected) {
    const nextItem = toMergedInjectedItem(item)
    if (!item.placement && item.groupId) {
      const existingGroupIndexes = merged
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.groupId === item.groupId)
      if (existingGroupIndexes.length > 0) {
        const insertAfter = existingGroupIndexes[existingGroupIndexes.length - 1]?.index ?? -1
        merged.splice(insertAfter + 1, 0, nextItem)
        continue
      }
    }
    merged = insertByInjectionPlacement(merged, nextItem, item.placement, (entry) => entry.id)
  }

  return merged
}
