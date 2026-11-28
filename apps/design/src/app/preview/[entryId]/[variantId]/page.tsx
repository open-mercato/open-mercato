import { notFound } from 'next/navigation'
import { PreviewRenderer } from '@/components/PreviewRenderer'
import { allEntries, findEntry } from '@/lib/manifest'

type Params = { entryId: string; variantId: string }

export const dynamicParams = false

export const metadata = { robots: { index: false } }

export function generateStaticParams(): Params[] {
  return allEntries().flatMap((entry) => entry.variants.map((variant) => ({ entryId: entry.id, variantId: variant.id })))
}

export default async function PreviewPage({ params }: { params: Promise<Params> }) {
  const { entryId, variantId } = await params
  const entry = findEntry(entryId)
  if (!entry || !entry.variants.some((variant) => variant.id === variantId)) notFound()
  return <PreviewRenderer familyId={entry.family} entryId={entryId} variantId={variantId} />
}
