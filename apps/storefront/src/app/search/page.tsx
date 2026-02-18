import type { Metadata } from 'next'
import { fetchProducts } from '@/lib/api'
import { ProductListingClient } from '@/app/ProductListingClient'

type SearchParams = {
  search?: string
  categoryId?: string
  tagId?: string | string[]
  priceMin?: string
  priceMax?: string
  sort?: string
  page?: string
}

export const metadata: Metadata = {
  title: 'Search',
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const tagIds = Array.isArray(params.tagId) ? params.tagId : params.tagId ? [params.tagId] : []

  const data = await fetchProducts({
    page: Number(params.page ?? '1') || 1,
    pageSize: 24,
    search: params.search,
    categoryId: params.categoryId,
    tagIds: tagIds.join(',') || undefined,
    priceMin: params.priceMin,
    priceMax: params.priceMax,
    sort: params.sort,
  }).catch(() => null)

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-4xl font-light tracking-tight text-gray-900">
          {params.search ? (
            <>
              Search results for{' '}
              <span className="text-gray-500">&ldquo;{params.search}&rdquo;</span>
            </>
          ) : (
            'Search'
          )}
        </h1>
        {data && <p className="mt-1 text-sm text-gray-500">{data.total} results</p>}
      </div>

      <ProductListingClient data={data} searchParamsSnapshot={params} />
    </div>
  )
}
