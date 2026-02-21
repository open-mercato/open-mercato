import * as React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { PriceDisplay } from './PriceDisplay'
import type { ProductListItem } from '@/lib/types'

type ProductCardProps = {
  product: ProductListItem
  locale?: string
}

export function ProductCard({ product, locale }: ProductCardProps) {
  const href = product.handle
    ? `/products/${product.handle}`
    : `/products/${product.id}`

  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white transition-all duration-200 hover:border-gray-200 hover:shadow-lg hover:shadow-gray-100"
    >
      <div className="relative aspect-square overflow-hidden bg-gray-50">
        {product.defaultMediaUrl ? (
          <Image
            src={product.defaultMediaUrl}
            alt={product.title}
            fill
            sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-200">
            <svg className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {product.isConfigurable && (
          <div className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-gray-600 backdrop-blur-sm">
            {product.variantCount} variants
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        {product.categories.length > 0 && (
          <span className="text-xs font-medium uppercase tracking-widest text-gray-400">
            {product.categories[0].name}
          </span>
        )}
        <h3 className="line-clamp-2 text-sm font-medium text-gray-900 group-hover:text-black">
          {product.title}
        </h3>
        {product.subtitle && (
          <p className="line-clamp-1 text-xs text-gray-500">{product.subtitle}</p>
        )}
        <div className="mt-auto pt-2">
          <PriceDisplay priceRange={product.priceRange} locale={locale} />
        </div>
      </div>
    </Link>
  )
}
