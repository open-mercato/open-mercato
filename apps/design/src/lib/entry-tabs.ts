import type { EntryGroup } from './groups'

export const ENTRY_TABS = ['examples', 'usage', 'api', 'source', 'states'] as const
export type EntryTab = (typeof ENTRY_TABS)[number]

export const DEFAULT_ENTRY_TAB: EntryTab = 'examples'
export const ENTRY_TAB_PARAM = 'tab'

export function tabsForGroup(group: EntryGroup): EntryTab[] {
  if (group === 'screens') return ENTRY_TABS.filter((tab) => tab !== 'api')
  return ENTRY_TABS.filter((tab) => tab !== 'states' || group === 'blocks')
}

export function resolveEntryTab(value: string | null | undefined, group: EntryGroup): EntryTab {
  const match = tabsForGroup(group).find((tab) => tab === value)
  return match ?? DEFAULT_ENTRY_TAB
}

export function parseEntryTab(search: string, group: EntryGroup): EntryTab {
  return resolveEntryTab(new URLSearchParams(search).get(ENTRY_TAB_PARAM), group)
}

export function entryTabSearch(search: string, tab: EntryTab): string {
  const query = new URLSearchParams(search)
  if (tab === DEFAULT_ENTRY_TAB) query.delete(ENTRY_TAB_PARAM)
  else query.set(ENTRY_TAB_PARAM, tab)
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

export const USAGE_ANCHORS: readonly string[] = ['when-to-use', 'accessibility', 'faq']

export function tabForHash(hash: string): EntryTab | null {
  const anchor = hash.replace(/^#/, '')
  if (!anchor) return null
  if (USAGE_ANCHORS.includes(anchor) || anchor.startsWith('faq-')) return 'usage'
  if (anchor === 'examples' || anchor.startsWith('variant-')) return 'examples'
  return null
}
