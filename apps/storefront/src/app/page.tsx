import type { Metadata } from 'next'
import { fetchProducts } from '@/lib/api'
import { ProductListingClient } from './ProductListingClient'

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
  title: 'Products',
}

export default async function HomePage({
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
    <ProductListingClient
      data={data}
      searchParamsSnapshot={params}
    />
  )
}
