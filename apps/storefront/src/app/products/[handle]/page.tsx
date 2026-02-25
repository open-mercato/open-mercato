import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { fetchProductDetail } from '@/lib/api'
import { ImageGallery } from '@/components/ImageGallery'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ProductGrid } from '@/components/ProductGrid'
import { ProductDetailClient } from './ProductDetailClient'

type Params = { handle: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { handle } = await params
  const data = await fetchProductDetail(handle).catch(() => null)
  if (!data) return { title: 'Product' }
  return {
    title: data.product.title,
    description: data.product.subtitle ?? data.product.description ?? undefined,
  }
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { handle } = await params
  const data = await fetchProductDetail(handle).catch(() => null)
  if (!data) notFound()

  const { product, effectiveLocale } = data
  const primaryCategory = product.categories[0]

  const breadcrumbs = [
    ...(primaryCategory
      ? [
          {
            label: primaryCategory.name,
            href: primaryCategory.slug
              ? `/categories/${primaryCategory.slug}`
              : `/?categoryId=${primaryCategory.id}`,
          },
        ]
      : []),
    { label: product.title },
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <Breadcrumbs items={breadcrumbs} />
      </div>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
        <ImageGallery
          title={product.title}
          defaultMediaUrl={product.defaultMediaUrl}
          media={product.media}
        />

        <ProductDetailClient product={product} locale={effectiveLocale} />
      </div>

      {product.relatedProducts.length > 0 && (
        <section className="mt-20">
          <h2 className="mb-6 text-2xl font-light tracking-tight text-gray-900">
            Related Products
          </h2>
          <ProductGrid
            products={product.relatedProducts.map((r) => ({
              id: r.id,
              handle: r.handle,
              title: r.title,
              subtitle: null,
              defaultMediaUrl: r.defaultMediaUrl,
              productType: '',
              isConfigurable: false,
              categories: [],
              tags: [],
              priceRange: r.priceRange,
              hasVariants: false,
              variantCount: 0,
            }))}
            locale={effectiveLocale}
          />
        </section>
      )}
    </div>
  )
}
