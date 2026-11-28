import manifestJson from '../generated/registry-manifest.json'
import { ENTRY_GROUPS, type EntryGroup } from './groups'
import { entryHref } from './links'
import type { ManifestEntry, RegistryManifest } from './manifest-types'

const manifest = manifestJson as RegistryManifest

export function allEntries(): ManifestEntry[] {
  return manifest.entries
}

export function entriesForGroup(group: EntryGroup): ManifestEntry[] {
  return manifest.entries
    .filter((entry) => entry.group === group)
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title))
}

export function findEntry(entryId: string): ManifestEntry | undefined {
  return manifest.entries.find((entry) => entry.id === entryId)
}

export type NavItem = { id: string; title: string; href: string }
export type NavGroup = { group: EntryGroup; items: NavItem[] }

export function navigationGroups(): NavGroup[] {
  return ENTRY_GROUPS.map((group) => ({
    group,
    items: entriesForGroup(group).map((entry) => ({ id: entry.id, title: entry.title, href: entryHref(group, entry.id) })),
  }))
}
