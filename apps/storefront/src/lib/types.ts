export type StorefrontStore = {
  id: string
  code: string
  name: string
  slug: string
  status: string
  defaultLocale: string
  supportedLocales: string[]
  defaultCurrencyCode: string
  isPrimary: boolean
}

export type StorefrontContext = {
  store: StorefrontStore
  effectiveLocale: string
  channelBinding: {
    salesChannelId: string
    priceKindId: string | null
  } | null
}

export type PriceRange = {
  min: string
  max: string
  currencyCode: string
}

export type ProductCategory = {
  id: string
  name: string
  slug: string | null
}

export type ProductListItem = {
  id: string
  handle: string | null
  title: string
  subtitle: string | null
  defaultMediaUrl: string | null
  productType: string
  isConfigurable: boolean
  categories: ProductCategory[]
  tags: string[]
  priceRange: PriceRange | null
  hasVariants: boolean
  variantCount: number
}

export type FilterCategory = {
  id: string
  name: string
  slug: string | null
  count: number
}

export type FilterTag = {
  slug: string
  label: string
  count: number
}

export type FilterOption = {
  code: string
  label: string
  values: Array<{ code: string; label: string; count: number }>
}

export type FilterPriceRange = {
  min: number
  max: number
  currencyCode: string
}

export type ProductFiltersData = {
  categories: FilterCategory[]
  tags: FilterTag[]
  priceRange: FilterPriceRange | null
  options: FilterOption[]
}

export type ProductListResponse = {
  items: ProductListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  effectiveLocale: string
  filters: ProductFiltersData
}

export type ProductMedia = {
  id: string
  url: string
  alt: string | null
}

export type ProductPricing = {
  currencyCode: string
  unitPriceNet: string
  unitPriceGross: string
  displayMode: string
  isPromotion: boolean
  originalPrice: string | null
}

export type ProductVariant = {
  id: string
  name: string
  sku: string | null
  optionValues: Record<string, string>
  isDefault: boolean
  isActive: boolean
  pricing: ProductPricing | null
  dimensions: Record<string, unknown> | null
  weightValue: string | null
  weightUnit: string | null
}

export type RelatedProduct = {
  id: string
  handle: string | null
  title: string
  defaultMediaUrl: string | null
  priceRange: PriceRange | null
}

export type ProductDetail = {
  id: string
  handle: string | null
  title: string
  subtitle: string | null
  description: string | null
  sku: string | null
  productType: string
  isConfigurable: boolean
  defaultMediaUrl: string | null
  media: ProductMedia[]
  dimensions: Record<string, unknown> | null
  weightValue: string | null
  weightUnit: string | null
  categories: ProductCategory[]
  tags: string[]
  optionSchema: Record<string, unknown> | null
  variants: ProductVariant[]
  pricing: ProductPricing | null
  relatedProducts: RelatedProduct[]
}

export type ProductDetailResponse = {
  product: ProductDetail
  effectiveLocale: string
}

export type CategoryNode = {
  id: string
  name: string
  slug: string | null
  parentId: string | null
  productCount: number
  children: CategoryNode[]
}

export type CategoryDetail = {
  id: string
  name: string
  slug: string | null
  parentId: string | null
  description: string | null
  productCount: number
  children: CategoryNode[]
  products: ProductListResponse
}

export type StorefrontFilters = {
  search: string
  categoryId: string
  tagIds: string[]
  priceMin: string
  priceMax: string
  sort: string
  page: number
}

export type CartLine = {
  id: string
  productId: string
  variantId: string | null
  quantity: number
  unitPriceNet: string | null
  unitPriceGross: string | null
  currencyCode: string | null
  titleSnapshot: string | null
  skuSnapshot: string | null
  imageUrlSnapshot: string | null
}

export type CartDto = {
  id: string
  token: string
  status: string
  currencyCode: string
  locale: string | null
  lines: CartLine[]
  itemCount: number
  subtotalGross: string | null
}

export type CheckoutWorkflowState =
  | 'cart'
  | 'customer'
  | 'shipping'
  | 'review'
  | 'placing_order'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'

export type CheckoutSessionStatus =
  | 'active'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'

export type CheckoutSession = {
  id: string
  cartId: string
  cartToken: string
  workflowName: string
  workflowState: CheckoutWorkflowState
  status: CheckoutSessionStatus
  version: number
  customerInfo: Record<string, unknown> | null
  shippingInfo: Record<string, unknown> | null
  billingInfo: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  placedOrderId: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  allowedActions: string[]
}

export type CheckoutTransitionAction =
  | 'set_customer'
  | 'set_shipping'
  | 'review'
  | 'place_order'
  | 'cancel'
