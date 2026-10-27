"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'

export type CatalogCategoryOption = { id: string; name: string; depth: number; parentId: string | null }

export type CatalogProductOption = {
  id: string
  title: string
  use: 'leasable' | 'bookable' | null
  billingUnit: 'month' | 'hour' | 'day' | null
}

type CatalogOptionsResponse = { categories: CatalogCategoryOption[]; products: CatalogProductOption[] }

export function useCatalogCategories(): { categories: CatalogCategoryOption[]; loading: boolean } {
  const [categories, setCategories] = React.useState<CatalogCategoryOption[]>([])
  const [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    let cancelled = false
    apiCall<CatalogOptionsResponse>('/api/property_management/catalog-options')
      .then((call) => {
        if (!cancelled && call.ok && call.result) setCategories(call.result.categories)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return { categories, loading }
}

function useCategoryProducts(categoryId: string | null) {
  const [state, setState] = React.useState<{ categoryId: string | null; products: CatalogProductOption[] }>({ categoryId: null, products: [] })
  React.useEffect(() => {
    if (!categoryId) {
      setState({ categoryId: null, products: [] })
      return
    }
    let cancelled = false
    apiCall<CatalogOptionsResponse>(`/api/property_management/catalog-options?categoryId=${encodeURIComponent(categoryId)}`)
      .then((call) => {
        if (!cancelled) setState({ categoryId, products: call.ok && call.result ? call.result.products : [] })
      })
      .catch(() => {
        if (!cancelled) setState({ categoryId, products: [] })
      })
    return () => {
      cancelled = true
    }
  }, [categoryId])
  return { products: state.products, loaded: state.categoryId === categoryId }
}

export type UnitProductFieldProps = CrudCustomFieldRenderProps & {
  categoryName: string | null
  lockedReason: string | null
}

export function UnitProductField({ value, setValue, values, disabled, categoryName, lockedReason }: UnitProductFieldProps) {
  const t = useT()
  const categoryId = typeof values?.catalogCategoryId === 'string' && values.catalogCategoryId ? values.catalogCategoryId : null
  const { products, loaded } = useCategoryProducts(categoryId)
  const selected = typeof value === 'string' ? value : ''
  const product = products.find((item) => item.id === selected) ?? null

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
