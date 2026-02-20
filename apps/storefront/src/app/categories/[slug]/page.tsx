import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { fetchCategoryBySlug } from '@/lib/api'
import { ProductListingClient } from '@/app/ProductListingClient'
import { Breadcrumbs } from '@/components/Breadcrumbs'

type Params = { slug: string }
type SearchParams = {
  search?: string
  priceMin?: string
  priceMax?: string
  sort?: string
  page?: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await fetchCategoryBySlug(slug).catch(() => null)
  return { title: data?.name ?? 'Category' }
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<SearchParams>
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])

  const data = await fetchCategoryBySlug(slug, {
    page: Number(sp.page ?? '1') || 1,
    pageSize: 24,
    search: sp.search,
    priceMin: sp.priceMin,
    priceMax: sp.priceMax,
    sort: sp.sort,
  }).catch(() => null)

  if (!data) notFound()

  const breadcrumbs = [{ label: data.name }]

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 space-y-3">
        <Breadcrumbs items={breadcrumbs} />
        <h1 className="text-4xl font-light tracking-tight text-gray-900">{data.name}</h1>
        {data.description && (
          <p className="text-gray-500">{data.description}</p>
        )}
      </div>

      {(data.children ?? []).length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          {(data.children ?? []).map((child) => (
            <Link
              key={child.id}
              href={child.slug ? `/categories/${child.slug}` : `/?categoryId=${child.id}`}
              className="rounded-full border border-gray-200 px-4 py-1.5 text-sm text-gray-700 transition-colors hover:border-gray-400 hover:text-gray-900"
            >
              {child.name}
              {child.productCount > 0 && (
                <span className="ml-1.5 text-gray-400">({child.productCount})</span>
              )}
            </Link>
          ))}
        </div>
      )}

      <ProductListingClient data={data.products} searchParamsSnapshot={sp} />
    </div>
  )
}
