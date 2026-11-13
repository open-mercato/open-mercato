'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SourceIconCatalogue } from '../demos/source-icons'
import { SourceArtworkCatalogue } from '../demos/source-artwork'
import { IconGrid } from '../demos/registered-icons'
import type { SourceArtworkGroup } from '@open-mercato/ui/assets/source-artwork'

const collections: { id: string; entryId: string; variantId: string; group?: SourceArtworkGroup }[] = [
  { id: 'icons', entryId: 'source-icons', variantId: 'catalogue' },
  { id: 'brands', entryId: 'source-artwork', variantId: 'brands', group: 'brand' },
  { id: 'flags', entryId: 'source-artwork', variantId: 'flags', group: 'country-flags' },
  { id: 'emoji', entryId: 'source-artwork', variantId: 'emoji', group: 'emojies' },
  { id: 'badges', entryId: 'source-artwork', variantId: 'store-badges', group: 'appstore-badges' },
  { id: 'thumbnails', entryId: 'source-artwork', variantId: 'thumbnails', group: 'thumbnails' },
  { id: 'cursors', entryId: 'source-artwork', variantId: 'cursors', group: 'others' },
  { id: 'registered', entryId: 'icon-registry', variantId: 'registry' },
]

export function IconsBrowser({ entryId, variantId, onNavigate }: {
  entryId?: string
  variantId?: string
  onNavigate: (entryId: string, variantId?: string) => void
}) {
  const t = useT()
  const collection = collections.find(item => item.entryId === entryId && item.variantId === variantId)
    ?? collections.find(item => item.entryId === entryId)
    ?? collections[0]
  const collectionControl = <Select value={collection.id} onValueChange={value => {
      const next = collections.find(item => item.id === value)
      if (next) onNavigate(next.entryId, next.variantId)
    }}>
      <SelectTrigger className="w-64 max-w-full" aria-label={t('design_system.gallery.assets.collection')}><SelectValue /></SelectTrigger>
      <SelectContent>{collections.map(item => <SelectItem key={item.id} value={item.id}>{t(`design_system.gallery.assets.${item.id}`)}</SelectItem>)}</SelectContent>
    </Select>
  return collection.group ? <SourceArtworkCatalogue key={collection.id} group={collection.group} collectionControl={collectionControl} />
    : collection.id === 'registered' ? <IconGrid collectionControl={collectionControl} /> : <SourceIconCatalogue collectionControl={collectionControl} />
}
