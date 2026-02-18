'use client'

import * as React from 'react'
import { VariantSelector } from '@/components/VariantSelector'
import { PriceDisplay } from '@/components/PriceDisplay'
import type { ProductDetail, ProductVariant } from '@/lib/types'

type ProductDetailClientProps = {
  product: ProductDetail
  locale: string
}

export function ProductDetailClient({ product, locale }: ProductDetailClientProps) {
  const defaultVariant =
    product.variants.find((v) => v.isDefault && v.isActive) ??
    product.variants.find((v) => v.isActive) ??
    product.variants[0] ??
    null

  const [selectedVariant, setSelectedVariant] = React.useState<ProductVariant | null>(defaultVariant)

  const activePricing = selectedVariant?.pricing ?? product.pricing

  return (
    <div className="flex flex-col gap-6">
      {product.categories.length > 0 && (
        <span className="text-xs font-medium uppercase tracking-widest text-gray-400">
          {product.categories.map((c) => c.name).join(' · ')}
        </span>
      )}

      <div>
        <h1 className="text-3xl font-light tracking-tight text-gray-900">{product.title}</h1>
        {product.subtitle && (
          <p className="mt-1 text-lg text-gray-500">{product.subtitle}</p>
        )}
      </div>

      <PriceDisplay pricing={activePricing} locale={locale} className="py-2" />

      {product.isConfigurable && (
        <VariantSelector
          optionSchema={product.optionSchema}
          variants={product.variants}
          selectedVariant={selectedVariant}
          onVariantChange={setSelectedVariant}
        />
      )}

      {product.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {product.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-gray-100 px-2.5 py-0.5 text-xs text-gray-500"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {product.description && (
        <div className="prose prose-sm prose-gray max-w-none border-t border-gray-100 pt-6 text-gray-600">
          {product.description}
        </div>
      )}

      {(product.sku ?? selectedVariant?.sku) && (
        <p className="text-xs text-gray-400">
          SKU: {selectedVariant?.sku ?? product.sku}
        </p>
      )}

      {(product.weightValue ?? selectedVariant?.weightValue) && (
        <p className="text-xs text-gray-400">
          Weight: {selectedVariant?.weightValue ?? product.weightValue}{' '}
          {selectedVariant?.weightUnit ?? product.weightUnit}
        </p>
      )}
    </div>
  )
}
