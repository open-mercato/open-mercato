"use client"

import * as React from 'react'
import Link from 'next/link'
import { Image as ImageIcon, ExternalLink, Star } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import type { ProductMediaItem } from './ProductMediaManager'

export type VariantMediaGroup = {
  variantId: string
  variantName: string
  defaultMediaId: string | null
  items: ProductMediaItem[]
  editUrl: string
}

type Props = {
  groups: VariantMediaGroup[]
}

export function VariantMediaReadonlyGallery({ groups }: Props) {
  const t = useT()

  const nonEmptyGroups = groups.filter((group) => group.items.length > 0)

  if (!nonEmptyGroups.length) {
    return null
  }

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-muted-foreground">
        {t('catalog.products.variantMedia.title', 'Variant media')}
      </label>
      {nonEmptyGroups.map((group) => (
        <div key={group.variantId} className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{group.variantName}</span>
            <Link
              href={group.editUrl}
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              <span>{t('catalog.products.variantMedia.editVariant', 'Edit variant')}</span>
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {group.items.map((item) => {
              const isDefault = group.defaultMediaId === item.id
              const slug = slugifyAttachmentFileName(item.fileName)
              const thumbnail =
                item.thumbnailUrl || buildAttachmentImageUrl(item.id, { width: 360, height: 360, slug })
              return (
                <div key={item.id} className="flex flex-col rounded-md border bg-card">
                  <div className="relative aspect-square overflow-hidden rounded-t-md bg-muted">
                    {thumbnail ? (
                      <img src={thumbnail} alt={item.fileName} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-8 w-8" />
                      </div>
                    )}
                    {isDefault ? (
                      <div className="absolute right-1 top-1">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                          <Star className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="p-2">
                    <p className="line-clamp-1 text-xs text-muted-foreground">{item.fileName}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
