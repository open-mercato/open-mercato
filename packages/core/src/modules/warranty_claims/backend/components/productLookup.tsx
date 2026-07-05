"use client"

import * as React from 'react'
import type { JSX } from 'react'
import { X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { computeWarrantyEntitlementPreview, type WarrantyEntitlementPreview } from '../../lib/warrantyPreview'

export type ClaimProductPick = {
  productId: string
  variantId: string | null
  sku: string | null
  productName: string
}

type ProductOption = {
  id: string
  title: string
  sku: string | null
  thumbnailUrl: string | null
  isConfigurable: boolean
}

type VariantOption = {
  id: string
  title: string
  sku: string | null
  thumbnailUrl: string | null
}

type LookupItemWithOption<TOption> = LookupSelectItem & {
  option: TOption
}

type ApiProductItem = Record<string, unknown> & {
  name?: string | null
  sku?: string | null
  default_media_url?: string | null
  defaultMediaUrl?: string | null
  is_configurable?: boolean | null
  isConfigurable?: boolean | null
}

type ApiVariantItem = Record<string, unknown> & {
  name?: string | null
  sku?: string | null
  default_media_url?: string | null
  defaultMediaUrl?: string | null
  thumbnailUrl?: string | null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function mapProductOption(item: Record<string, unknown>): ProductOption | null {
  const id = readString(item.id)
  if (!id) return null
  const product = item as ApiProductItem
  const title = readString(item.title) ?? readString(product.name) ?? id
  return {
    id,
    title,
    sku: readString(product.sku),
    thumbnailUrl: readString(product.default_media_url) ?? readString(product.defaultMediaUrl),
    isConfigurable: readBoolean(product.is_configurable ?? product.isConfigurable),
  }
}

function mapVariantOption(item: Record<string, unknown>, fallbackThumbnail: string | null): VariantOption | null {
  const id = readString(item.id)
  if (!id) return null
  const variant = item as ApiVariantItem
  const title = readString(variant.name) ?? readString(item.title) ?? id
  return {
    id,
    title,
    sku: readString(variant.sku),
    thumbnailUrl:
      readString(variant.default_media_url) ??
      readString(variant.defaultMediaUrl) ??
      readString(variant.thumbnailUrl) ??
      fallbackThumbnail,
  }
}

function buildPlaceholder(label?: string | null): JSX.Element {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded border border-border bg-muted text-xs uppercase text-muted-foreground">
      {(label ?? '').slice(0, 2) || '?'}
    </div>
  )
}

function productToLookupItem(option: ProductOption): LookupItemWithOption<ProductOption> {
  return {
    id: option.id,
    title: option.title,
    subtitle: option.sku ?? undefined,
    icon: option.thumbnailUrl ? (
      <img src={option.thumbnailUrl} alt={option.title} className="h-8 w-8 rounded object-cover" />
    ) : (
      buildPlaceholder(option.title)
    ),
    option,
  }
}

function variantToLookupItem(option: VariantOption): LookupItemWithOption<VariantOption> {
  return {
    id: option.id,
    title: option.title,
    subtitle: option.sku ?? undefined,
    icon: option.thumbnailUrl ? (
      <img src={option.thumbnailUrl} alt={option.title} className="h-8 w-8 rounded object-cover" />
    ) : (
      buildPlaceholder(option.title)
    ),
    option,
  }
}

async function loadProductById(productId: string): Promise<ProductOption | null> {
  const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
    `/api/catalog/products?id=${encodeURIComponent(productId)}&pageSize=1`,
    undefined,
    { fallback: { items: [] } },
  )
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  const record = items.find((entry) => entry.id === productId) ?? items[0] ?? null
  return record ? mapProductOption(record) : null
}

async function loadProductOptions(query?: string): Promise<LookupItemWithOption<ProductOption>[]> {
  const params = new URLSearchParams({ pageSize: '8' })
  const trimmed = query?.trim()
  if (trimmed) params.set('search', trimmed)
  else params.set('sortField', 'title')
  const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
    `/api/catalog/products?${params.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  return items
    .map(mapProductOption)
    .filter((option): option is ProductOption => option !== null)
    .map(productToLookupItem)
}

async function loadVariants(productId: string, productThumbnail: string | null): Promise<VariantOption[]> {
  if (!productId) return []
  const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
    `/api/catalog/variants?productId=${encodeURIComponent(productId)}&pageSize=50`,
    undefined,
    { fallback: { items: [] } },
  )
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  return items
    .map((item) => mapVariantOption(item, productThumbnail))
    .filter((option): option is VariantOption => option !== null)
}

function createPick(product: ProductOption, variant: VariantOption | null): ClaimProductPick {
  return {
    productId: product.id,
    variantId: variant?.id ?? null,
    sku: variant?.sku ?? product.sku,
    productName: product.title,
  }
}

export function computeEntitlementPreview(
  purchaseDate: Date | null,
  warrantyMonths: number | null,
  now: Date = new Date(),
): WarrantyEntitlementPreview {
  return computeWarrantyEntitlementPreview(purchaseDate, warrantyMonths, now)
}

export function EntitlementChip(props: {
  status: 'in_warranty' | 'out_of_warranty' | 'unknown'
  t: (key: string) => string
}): JSX.Element | null {
  if (props.status === 'unknown') return null
  const variant = props.status === 'in_warranty' ? 'success' : 'error'
  const key = props.status === 'in_warranty'
    ? 'warranty_claims.form.entitlement.inWarranty'
    : 'warranty_claims.form.entitlement.outOfWarranty'
  return (
    <StatusBadge variant={variant} dot>
      {props.t(key)}
    </StatusBadge>
  )
}

export function ClaimLineProductPicker(props: {
  value: { productId?: string | null; variantId?: string | null; productName?: string | null; sku?: string | null }
  onPick: (pick: ClaimProductPick) => void
  onClear: () => void
  disabled?: boolean
}): JSX.Element {
  const t = useT()
  const productOptionsRef = React.useRef<Map<string, ProductOption>>(new Map())
  const variantOptionsRef = React.useRef<Map<string, VariantOption>>(new Map())
  const [productOption, setProductOption] = React.useState<ProductOption | null>(null)
  const [variantOption, setVariantOption] = React.useState<VariantOption | null>(null)
  const [variantOptions, setVariantOptions] = React.useState<VariantOption[]>([])
  const [variantsLoadedFor, setVariantsLoadedFor] = React.useState<string | null>(null)

  const productId = readString(props.value.productId)
  const variantId = readString(props.value.variantId)
  const fallbackProductName = readString(props.value.productName)
  const fallbackSku = readString(props.value.sku)

  React.useEffect(() => {
    let cancelled = false
    if (!productId) {
      setProductOption(null)
      setVariantOption(null)
      setVariantOptions([])
      setVariantsLoadedFor(null)
      return () => {
        cancelled = true
      }
    }
    const cached = productOptionsRef.current.get(productId)
    if (cached) {
      setProductOption(cached)
      return () => {
        cancelled = true
      }
    }
    void loadProductById(productId)
      .then((option) => {
        if (cancelled) return
        const resolved = option ?? {
          id: productId,
          title: fallbackProductName ?? productId,
          sku: fallbackSku,
          thumbnailUrl: null,
          isConfigurable: false,
        }
        productOptionsRef.current.set(resolved.id, resolved)
        setProductOption(resolved)
      })
      .catch(() => {
        if (!cancelled) {
          const fallback = {
            id: productId,
            title: fallbackProductName ?? productId,
            sku: fallbackSku,
            thumbnailUrl: null,
            isConfigurable: false,
          }
          productOptionsRef.current.set(fallback.id, fallback)
          setProductOption(fallback)
        }
      })
    return () => {
      cancelled = true
    }
  }, [fallbackProductName, fallbackSku, productId])

  React.useEffect(() => {
    let cancelled = false
    const selectedProduct = productOption
    if (!selectedProduct) {
      setVariantOptions([])
      setVariantsLoadedFor(null)
      return () => {
        cancelled = true
      }
    }
    if (variantsLoadedFor === selectedProduct.id) return () => {
      cancelled = true
    }
    void loadVariants(selectedProduct.id, selectedProduct.thumbnailUrl)
      .then((options) => {
        if (cancelled) return
        variantOptionsRef.current = new Map(options.map((option) => [option.id, option]))
        setVariantOptions(options)
        setVariantsLoadedFor(selectedProduct.id)
        if (variantId) setVariantOption(options.find((option) => option.id === variantId) ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          setVariantOptions([])
          setVariantsLoadedFor(selectedProduct.id)
        }
      })
    return () => {
      cancelled = true
    }
  }, [productOption, variantId, variantsLoadedFor])

  const fetchProductItems = React.useCallback(async (query: string) => {
    const items = await loadProductOptions(query)
    for (const item of items) productOptionsRef.current.set(item.option.id, item.option)
    return items
  }, [])

  const fetchVariantItems = React.useCallback(async (query: string) => {
    const needle = query.trim().toLowerCase()
    const options = variantOptions.length
      ? variantOptions
      : productOption
        ? await loadVariants(productOption.id, productOption.thumbnailUrl)
        : []
    for (const option of options) variantOptionsRef.current.set(option.id, option)
    const filtered = needle
      ? options.filter((option) => option.title.toLowerCase().includes(needle) || (option.sku ?? '').toLowerCase().includes(needle))
      : options
    return filtered.map(variantToLookupItem)
  }, [productOption, variantOptions])

  const clearProduct = React.useCallback(() => {
    setProductOption(null)
    setVariantOption(null)
    setVariantOptions([])
    setVariantsLoadedFor(null)
    props.onClear()
  }, [props])

  const selectedProductOption = productOption
    ? [productToLookupItem(productOption)]
    : productId
      ? [productToLookupItem({
        id: productId,
        title: fallbackProductName ?? productId,
        sku: fallbackSku,
        thumbnailUrl: null,
        isConfigurable: false,
      })]
      : undefined
  const selectedVariantOption = variantOption ? [variantToLookupItem(variantOption)] : undefined
  const showVariantPicker = Boolean(productOption && (productOption.isConfigurable || variantOptions.length > 1))

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>{t('warranty_claims.form.productLookup')}</Label>
          {productId ? (
            <Button type="button" variant="ghost" size="sm" className="h-auto px-2 py-1 text-xs" onClick={clearProduct} disabled={props.disabled}>
              <X className="size-3" aria-hidden="true" />
              {t('warranty_claims.form.productLookup.clear')}
            </Button>
          ) : null}
        </div>
        <LookupSelect
          value={productId}
          onChange={(next) => {
            if (!next) {
              clearProduct()
              return
            }
            const selected = productOptionsRef.current.get(next)
            if (!selected) {
              void loadProductById(next).then((option) => {
                if (!option) return
                productOptionsRef.current.set(option.id, option)
                setProductOption(option)
                setVariantOption(null)
                props.onPick(createPick(option, null))
              })
              return
            }
            setProductOption(selected)
            setVariantOption(null)
            setVariantOptions([])
            setVariantsLoadedFor(null)
            props.onPick(createPick(selected, null))
          }}
          fetchItems={fetchProductItems}
          options={selectedProductOption}
          minQuery={1}
          searchPlaceholder={t('warranty_claims.form.productLookup.search')}
          disabled={props.disabled}
        />
      </div>
      {showVariantPicker ? (
        <div className="space-y-2">
          <Label>{t('warranty_claims.form.variantLookup')}</Label>
          <LookupSelect
            key={productOption?.id ?? 'no-product'}
            value={variantId}
            onChange={(next) => {
              if (!productOption) return
              const selected = next ? variantOptionsRef.current.get(next) ?? null : null
              setVariantOption(selected)
              props.onPick(createPick(productOption, selected))
            }}
            fetchItems={fetchVariantItems}
            options={selectedVariantOption}
            minQuery={0}
            searchPlaceholder={t('warranty_claims.form.variantLookup.search')}
            disabled={props.disabled || !productOption}
          />
        </div>
      ) : null}
    </div>
  )
}
