import type {
  StorefrontContext,
  ProductListResponse,
  ProductDetailResponse,
  CategoryNode,
  CategoryDetail,
  CartDto,
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

async function storefrontPost<T>(
  path: string,
  body: unknown,
  cartToken?: string | null,
): Promise<T> {
  const url = buildUrl(path)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (cartToken) headers['X-Cart-Token'] = cartToken
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new StorefrontApiError(res.status, text)
  }
  return res.json() as Promise<T>
}

async function storefrontPut<T>(
  path: string,
  body: unknown,
  cartToken?: string | null,
): Promise<T> {
  const url = buildUrl(path)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (cartToken) headers['X-Cart-Token'] = cartToken
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new StorefrontApiError(res.status, text)
  }
  return res.json() as Promise<T>
}

async function storefrontDelete<T>(path: string, cartToken?: string | null): Promise<T> {
  const url = buildUrl(path)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (cartToken) headers['X-Cart-Token'] = cartToken
  const res = await fetch(url, { method: 'DELETE', headers })
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new StorefrontApiError(res.status, text)
  }
  return res.json() as Promise<T>
}

export async function getCart(cartToken: string | null): Promise<CartDto | null> {
  if (!cartToken) return null
  try {
    const data = await storefrontFetch<{ cart: CartDto | null }>('/cart', { cartToken })
    return data.cart
  } catch {
    return null
  }
}

export async function createCart(): Promise<{ token: string; cart: CartDto }> {
  return storefrontPost<{ token: string; cart: CartDto }>('/cart', {})
}

export async function addToCart(
  cartToken: string,
  productId: string,
  variantId: string | null,
  quantity: number,
): Promise<CartDto> {
  const data = await storefrontPost<{ cart: CartDto }>(
    '/cart/lines',
    { cartToken, productId, variantId, quantity },
    cartToken,
  )
  return data.cart
}

export async function updateCartLine(
  cartToken: string,
  lineId: string,
  quantity: number,
): Promise<CartDto> {
  const data = await storefrontPut<{ cart: CartDto }>(
    `/cart/lines/${lineId}`,
    { quantity },
    cartToken,
  )
  return data.cart
}

export async function removeCartLine(cartToken: string, lineId: string): Promise<CartDto> {
  const data = await storefrontDelete<{ cart: CartDto }>(`/cart/lines/${lineId}`, cartToken)
  return data.cart
}

export async function checkout(
  cartToken: string,
  customerInfo: { name: string; email: string; phone?: string; address?: string },
): Promise<{ orderId: string }> {
  return storefrontPost<{ orderId: string }>(
    '/cart/checkout',
    { cartToken, customerInfo },
    cartToken,
  )
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
