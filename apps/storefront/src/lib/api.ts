import type {
  StorefrontContext,
  ProductListResponse,
  ProductDetailResponse,
  CategoryNode,
  CategoryDetail,
} from './types'

const API_BASE = process.env.NEXT_PUBLIC_STOREFRONT_API_URL ?? ''
const STORE_SLUG = process.env.NEXT_PUBLIC_STOREFRONT_SLUG ?? ''

class StorefrontApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'StorefrontApiError'
  }
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`${API_BASE}/api/ecommerce/storefront${path}`)
  if (STORE_SLUG) url.searchParams.set('storeSlug', STORE_SLUG)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return url.toString()
}

async function storefrontFetch<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = buildUrl(path, params)
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 60 },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new StorefrontApiError(res.status, text)
  }
  return res.json() as Promise<T>
}

export async function fetchStoreContext(): Promise<StorefrontContext | null> {
  try {
    return await storefrontFetch<StorefrontContext>('/context')
  } catch {
    return null
  }
}

export type ProductListParams = {
  page?: number
  pageSize?: number
  search?: string
  categoryId?: string
  tagIds?: string
  priceMin?: string
  priceMax?: string
  sort?: string
  locale?: string
}

export async function fetchProducts(params?: ProductListParams): Promise<ProductListResponse> {
  return storefrontFetch<ProductListResponse>('/products', params as Record<string, string | number | boolean | undefined>)
}

export async function fetchProductDetail(idOrHandle: string, locale?: string): Promise<ProductDetailResponse | null> {
  try {
    return await storefrontFetch<ProductDetailResponse>(`/products/${idOrHandle}`, locale ? { locale } : undefined)
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null
    throw err
  }
}

export async function fetchCategories(): Promise<CategoryNode[]> {
  const data = await storefrontFetch<{ categories: CategoryNode[] }>('/categories')
  return data.categories
}

export async function fetchCategoryBySlug(slug: string, params?: ProductListParams): Promise<CategoryDetail | null> {
  try {
    return await storefrontFetch<CategoryDetail>(`/categories/${slug}`, params as Record<string, string | number | boolean | undefined>)
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null
    throw err
  }
}
