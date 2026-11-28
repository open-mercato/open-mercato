import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { EntryIndex } from '@/components/EntryIndex'
import { designDictionary } from '@/lib/design-dictionary'
import { ENTRY_GROUPS, GROUP_LABEL_FALLBACKS, isEntryGroup } from '@/lib/groups'
import { entryHref } from '@/lib/links'
import { entriesForGroup } from '@/lib/manifest'
import { entryDescription } from '@/lib/server-text'

type Params = { group: string }

export const dynamicParams = false

export function generateStaticParams(): Params[] {
  return ENTRY_GROUPS.map((group) => ({ group }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { group } = await params
  return { title: designDictionary[`design.nav.${group}`] ?? (isEntryGroup(group) ? GROUP_LABEL_FALLBACKS[group] : group) }
}

export default async function GroupIndexPage({ params }: { params: Promise<Params> }) {
  const { group } = await params
  if (!isEntryGroup(group)) notFound()
  const cards = entriesForGroup(group).map((entry) => ({
    id: entry.id,
    title: entry.title,
    href: entryHref(group, entry.id),
    description: entryDescription(entry.descriptionKey),
    importPath: entry.importPath,
    family: entry.family,
    exampleCount: entry.variants.length,
  }))
  return <EntryIndex group={group} cards={cards} />
}
