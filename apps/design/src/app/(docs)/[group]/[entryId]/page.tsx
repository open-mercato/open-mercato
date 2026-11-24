import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { EntryView } from '@/components/EntryView'
import type { EntryViewData } from '@/components/entry-types'
import { contractForEntry } from '@/lib/contracts'
import { isEntryGroup } from '@/lib/groups'
import { allEntries, findEntry } from '@/lib/manifest'
import { entryDescription, serverT, variantTitle } from '@/lib/server-text'

type Params = { group: string; entryId: string }

export const dynamicParams = false

export function generateStaticParams(): Params[] {
  return allEntries().map((entry) => ({ group: entry.group, entryId: entry.id }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { entryId } = await params
  const entry = findEntry(entryId)
  if (!entry) return {}
  return { title: entry.title, description: entryDescription(entry.descriptionKey) }
}

export default async function EntryPage({ params }: { params: Promise<Params> }) {
  const { group, entryId } = await params
  const entry = findEntry(entryId)
  if (!entry || !isEntryGroup(group) || entry.group !== group) notFound()
  const contract = contractForEntry(entry.id)
  const data: EntryViewData = {
    id: entry.id,
    title: entry.title,
    group: entry.group,
    importPath: entry.importPath,
    description: entryDescription(entry.descriptionKey),
    usage: {
      do: (entry.usage?.do ?? []).map((rule, index) => serverT(`design_system.gallery.usage.${entry.id}.do.${index}`, rule)),
      dont: (entry.usage?.dont ?? []).map((rule, index) => serverT(`design_system.gallery.usage.${entry.id}.dont.${index}`, rule)),
    },
    variants: entry.variants.map((variant) => ({ id: variant.id, title: variantTitle(variant.title), code: variant.code })),
    contract,
    sources: {
      ...(entry.sourceFile ? { component: entry.sourceFile } : {}),
      ...(contract ? { contract: contract.file } : {}),
      gallery: entry.galleryFile,
    },
  }
  return <EntryView data={data} />
}
