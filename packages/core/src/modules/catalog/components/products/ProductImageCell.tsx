"use client"

import * as React from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { buildAttachmentImageUrl, type ImageCropType } from '@open-mercato/core/modules/attachments/lib/imageUrls'

type ProductImageCellProps = {
  mediaId?: string | null
  mediaUrl?: string | null
  title?: string | null
  cropType?: ImageCropType
}

const IMAGE_SIZE = 96

export function ProductImageCell({ mediaId, mediaUrl, title, cropType = 'cover' }: ProductImageCellProps) {
  const previewUrl = React.useMemo(() => {
    if (typeof mediaUrl === 'string' && mediaUrl.trim().length > 0) return mediaUrl
    if (typeof mediaId === 'string' && mediaId.trim().length > 0) {
      return buildAttachmentImageUrl(mediaId, { width: IMAGE_SIZE, height: IMAGE_SIZE, cropType })
    }
    return null
  }, [cropType, mediaId, mediaUrl])

  if (!previewUrl) {
    return (
      <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed text-muted-foreground">
        <ImageIcon className="h-4 w-4" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted/10">
      <img
        src={previewUrl}
        alt={title ?? ''}
        className={`h-full w-full ${cropType === 'contain' ? 'object-contain' : 'object-cover'}`}
      />
    </div>
  )
}
