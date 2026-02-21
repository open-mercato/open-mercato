'use client'

import * as React from 'react'
import Image from 'next/image'
import type { ProductMedia } from '@/lib/types'

type ImageGalleryProps = {
  title: string
  defaultMediaUrl: string | null
  media: ProductMedia[]
}

export function ImageGallery({ title, defaultMediaUrl, media }: ImageGalleryProps) {
  const allImages = React.useMemo(() => {
    const items: Array<{ id: string; url: string; alt: string | null }> = []
    if (defaultMediaUrl && !media.some((m) => m.url === defaultMediaUrl)) {
      items.push({ id: 'default', url: defaultMediaUrl, alt: title })
    }
    items.push(...media)
    return items
  }, [defaultMediaUrl, media, title])

  const [activeIndex, setActiveIndex] = React.useState(0)
  const activeImage = allImages[activeIndex]

  if (allImages.length === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-2xl bg-gray-50 text-gray-200">
        <svg className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-gray-50">
        {activeImage && (
          <Image
            src={activeImage.url}
            alt={activeImage.alt ?? title}
            fill
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        )}
      </div>

      {allImages.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {allImages.map((img, index) => (
            <button
              key={img.id}
              onClick={() => setActiveIndex(index)}
              className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                index === activeIndex ? 'border-gray-900' : 'border-transparent hover:border-gray-300'
              }`}
            >
              <Image
                src={img.url}
                alt={img.alt ?? `Image ${index + 1}`}
                fill
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
