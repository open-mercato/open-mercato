'use client'

import * as React from 'react'
import { SourceIcon } from '@open-mercato/ui/assets/source-icons'
import type { GalleryEntry } from '../types'
import { representativeVariantIds } from '../presentation'
import { getCompactEntrySpecimen } from './CompactEntrySpecimen'

export function FamilyEntryPreview({ entry }: { entry: GalleryEntry }) {
  const compact = getCompactEntrySpecimen(entry.id)
  if (compact !== undefined) return compact

  if (entry.id === 'button') return <>{entry.variants.filter(variant => ['default', 'outline', 'ghost'].includes(variant.id)).map(variant => <React.Fragment key={variant.id}>{variant.render()}</React.Fragment>)}</>

  if (entry.id === 'icon-registry') return <div className="grid grid-cols-4 gap-6">{(['activity', 'arrow-right', 'bell', 'calendar', 'check', 'house', 'plus', 'search'] as const).map(name => <SourceIcon key={name} name={name} aria-hidden="true" className="size-6" />)}</div>

  const overviewVariant = [representativeVariantIds[entry.id], 'default']
    .map(id => entry.variants.find(variant => variant.id === id))
    .find(Boolean) ?? entry.variants[0]
  if (entry.id === 'table') return <div className="w-full min-w-0 overflow-x-auto">{overviewVariant?.render()}</div>
  return overviewVariant?.render() ?? null
}
