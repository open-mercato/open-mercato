"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CatalogLoadError } from './CatalogLoadError'

export type CatalogCategoryOption = { id: string; name: string; depth: number; parentId: string | null }

export type CatalogProductOption = {
  id: string
  title: string
  use: 'leasable' | 'bookable' | null
  billingUnit: 'month' | 'hour' | 'day' | null
}

type CatalogOptionsResponse = {
  categories: CatalogCategoryOption[]
  products: CatalogProductOption[]
  hasMoreCategories?: boolean
  hasMoreProducts?: boolean
}

export const CATALOG_OPTIONS_LIMIT = 100

const SEARCH_DEBOUNCE_MS = 300

export function catalogOptionsUrl(params: { categoryId?: string | null; productId?: string | null; search?: string | null }): string {
  const query = new URLSearchParams({ limit: String(CATALOG_OPTIONS_LIMIT) })
  if (params.categoryId) query.set('categoryId', params.categoryId)
  if (params.productId) query.set('productId', params.productId)
  const search = params.search?.trim()
  if (search) query.set('search', search)
  return `/api/property_management/catalog-options?${query.toString()}`
}

export function useCatalogCategories(currentCategoryId: string | null = null): {
  categories: CatalogCategoryOption[]
  hasMore: boolean
  loading: boolean
  failedStatus: number | null
  retry: () => void
} {
  const [state, setState] = React.useState<{ categories: CatalogCategoryOption[]; hasMore: boolean }>({ categories: [], hasMore: false })
  const [loading, setLoading] = React.useState(true)
  const [failedStatus, setFailedStatus] = React.useState<number | null>(null)
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailedStatus(null)
    apiCall<CatalogOptionsResponse>(catalogOptionsUrl({ categoryId: currentCategoryId }))
      .then((call) => {
        if (cancelled) return
        if (call.ok && call.result) {
          setState({ categories: call.result.categories, hasMore: Boolean(call.result.hasMoreCategories) })
        } else {
          setFailedStatus(call.status)
        }
      })
      .catch((err) => {
        getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.catalog_categories_load_failed' })
        if (!cancelled) setFailedStatus(0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [attempt, currentCategoryId])
  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  return { categories: state.categories, hasMore: state.hasMore, loading, failedStatus, retry }
}

function useDebouncedValue(value: string): string {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

type ProductsState = { key: string | null; products: CatalogProductOption[]; hasMore: boolean; failedStatus: number | null }

export function useCategoryProducts(categoryId: string | null, selectedId: string, search: string) {
  const [state, setState] = React.useState<ProductsState>({ key: null, products: [], hasMore: false, failedStatus: null })
  const [attempt, setAttempt] = React.useState(0)
  const selectedRef = React.useRef(selectedId)
  selectedRef.current = selectedId
  const key = categoryId ? `${categoryId}\u0000${search}\u0000${attempt}` : null
  React.useEffect(() => {
    if (!categoryId || !key) {
      setState({ key: null, products: [], hasMore: false, failedStatus: null })
      return
    }
    let cancelled = false
    apiCall<CatalogOptionsResponse>(catalogOptionsUrl({ categoryId, productId: selectedRef.current || null, search }))
      .then((call) => {
        if (cancelled) return
        if (call.ok && call.result) setState({ key, products: call.result.products, hasMore: Boolean(call.result.hasMoreProducts), failedStatus: null })
        else setState({ key, products: [], hasMore: false, failedStatus: call.status })
      })
      .catch((err) => {
        getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.catalog_products_load_failed' })
        if (!cancelled) setState({ key, products: [], hasMore: false, failedStatus: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [categoryId, key, search])
  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  const loaded = state.key === key
  return {
    products: state.products,
    hasMore: state.hasMore,
    loaded: loaded && state.failedStatus === null,
    failedStatus: loaded ? state.failedStatus : null,
    retry,
  }
}

export type UnitProductFieldProps = CrudCustomFieldRenderProps & {
  categoryName: string | null
  lockedReason: string | null
}

export function UnitProductField({ value, setValue, values, disabled, categoryName, lockedReason }: UnitProductFieldProps) {
  const t = useT()
  const categoryId = typeof values?.catalogCategoryId === 'string' && values.catalogCategoryId ? values.catalogCategoryId : null
  const selected = typeof value === 'string' ? value : ''
  const [searchInput, setSearchInput] = React.useState('')
  const search = useDebouncedValue(searchInput.trim())
  const { products, hasMore, loaded, failedStatus, retry } = useCategoryProducts(categoryId, selected, search)
  const product = products.find((item) => item.id === selected) ?? null
  const showSearch = Boolean(categoryId) && (hasMore || searchInput.length > 0)

  React.useEffect(() => {
    setSearchInput('')
  }, [categoryId])

  React.useEffect(() => {
    if (!loaded || !selected) return
    if (!products.some((item) => item.id === selected)) setValue('')
  }, [loaded, products, selected, setValue])

  const useLabel = product?.use
    ? product.use === 'bookable'
      ? t('property_management.units.form.useBookable', 'Bookable — per {unit}', {
          unit: t(`property_management.units.billingUnit.${product.billingUnit ?? 'hour'}`, product.billingUnit ?? 'hour'),
        })
      : t('property_management.units.use.leasable', 'Leasable')
    : t('property_management.units.form.useUnknown', 'Choose a product')

  return (
    <div className="space-y-2">
      {showSearch ? (
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          disabled={disabled || Boolean(lockedReason)}
          placeholder={t('property_management.units.form.productSearch', 'Search products')}
          aria-label={t('property_management.units.form.productSearch', 'Search products')}
        />
      ) : null}
      <Select value={selected} onValueChange={(next) => setValue(next)} disabled={disabled || Boolean(lockedReason) || !categoryId}>
        <SelectTrigger aria-label={t('property_management.units.form.product', 'Product')}>
          <SelectValue placeholder={t('property_management.units.form.productPlaceholder', 'Choose a product')} />
        </SelectTrigger>
        <SelectContent>
          {products.map((item) => (
            <SelectItem key={item.id} value={item.id} disabled={!item.use}>
              {item.use ? item.title : t('property_management.units.form.productNoUse', '{title} (not leasable or bookable)', { title: item.title })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <CatalogLoadError status={failedStatus} kind="products" onRetry={retry} />
      {hasMore ? (
        <p className="text-xs text-muted-foreground">
          {t('property_management.units.form.productMore', 'Only the first {count} matching products are listed — search to find others.', { count: CATALOG_OPTIONS_LIMIT })}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {lockedReason
          ?? (categoryName
            ? t('property_management.units.form.productScope', 'Only products in the {category} category are listed.', { category: categoryName })
            : t('property_management.units.form.productNeedsType', 'Choose the type first.'))}
      </p>
      <p className="text-sm">
        <span className="text-muted-foreground">{t('property_management.units.form.use', 'Use')}: </span>
        <span data-testid="unit-use">{useLabel}</span>
        <span className="text-xs text-muted-foreground"> · {t('property_management.units.form.useHint', 'Set by the product.')}</span>
      </p>
    </div>
  )
}
