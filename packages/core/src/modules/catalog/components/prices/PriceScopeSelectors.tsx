"use client"

import * as React from 'react'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('catalog').child({ component: 'PriceScopeSelectors' })

type RemoteItem = Record<string, unknown>

function pickString(item: RemoteItem, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.length) return value
  }
  return ''
}

async function loadOptions(
  path: string,
  params: Record<string, string>,
  mapItem: (item: RemoteItem) => ComboboxOption | null,
): Promise<ComboboxOption[]> {
  try {
    const search = new URLSearchParams(params)
    const payload = await readApiResultOrThrow<{ items?: RemoteItem[] }>(
      `${path}?${search.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items.map(mapItem).filter((option): option is ComboboxOption => option !== null)
  } catch (err) {
    logger.error('catalog.prices.scopeSelect.load', { err, path })
    return []
  }
}

async function resolveOne(
  path: string,
  idParam: string,
  id: string,
  mapItem: (item: RemoteItem) => ComboboxOption | null,
): Promise<string> {
  const options = await loadOptions(path, { [idParam]: id, pageSize: '1' }, mapItem)
  return options[0]?.label ?? id
}

export function PriceProductSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const t = useT()
  const mapItem = React.useCallback((item: RemoteItem): ComboboxOption | null => {
    const id = pickString(item, 'id')
    if (!id) return null
    const title = pickString(item, 'title', 'name') || id
    const sku = pickString(item, 'sku')
    return { value: id, label: sku ? `${title} (${sku})` : title }
  }, [])
  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      disabled={disabled}
      allowCustomValues={false}
      clearable
      placeholder={t('catalog.prices.select.product.placeholder', 'Search products…')}
      loadSuggestions={(query) => loadOptions('/api/catalog/products', { search: query ?? '', pageSize: '10' }, mapItem)}
      resolveLabel={(id) => resolveOne('/api/catalog/products', 'id', id, mapItem)}
    />
  )
}

export function PriceVariantSelect({
  productId,
  value,
  onChange,
}: {
  productId: string
  value: string
  onChange: (next: string) => void
}) {
  const t = useT()
  const mapItem = React.useCallback((item: RemoteItem): ComboboxOption | null => {
    const id = pickString(item, 'id')
    if (!id) return null
    const name = pickString(item, 'name') || id
    const sku = pickString(item, 'sku')
    return { value: id, label: sku ? `${name} (${sku})` : name }
  }, [])
  const disabled = !productId
  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      disabled={disabled}
      allowCustomValues={false}
      clearable
      placeholder={
        disabled
          ? t('catalog.prices.form.field.product', 'Product')
          : t('catalog.prices.select.product.placeholder', 'Search products…')
      }
      loadSuggestions={(query) =>
        disabled
          ? Promise.resolve([])
          : loadOptions('/api/catalog/variants', { productId, search: query ?? '', pageSize: '10' }, mapItem)
      }
      resolveLabel={(id) => resolveOne('/api/catalog/variants', 'id', id, mapItem)}
    />
  )
}

export function PriceCustomerSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const t = useT()
  const mapItem = React.useCallback((item: RemoteItem): ComboboxOption | null => {
    const id = pickString(item, 'id')
    if (!id) return null
    const name = pickString(item, 'displayName', 'display_name', 'name') || id
    const email = pickString(item, 'primaryEmail', 'primary_email')
    return { value: id, label: name, description: email || null }
  }, [])
  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      allowCustomValues={false}
      clearable
      placeholder={t('catalog.prices.select.customer.placeholder', 'Search customers…')}
      loadSuggestions={(query) => loadOptions('/api/customers/people', { search: query ?? '', pageSize: '10' }, mapItem)}
      resolveLabel={(id) => resolveOne('/api/customers/people', 'id', id, mapItem)}
    />
  )
}

export function PriceChannelSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const t = useT()
  const mapItem = React.useCallback((item: RemoteItem): ComboboxOption | null => {
    const id = pickString(item, 'id')
    if (!id) return null
    const name = pickString(item, 'name') || id
    const code = pickString(item, 'code')
    return { value: id, label: code ? `${name} (${code})` : name }
  }, [])
  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      allowCustomValues={false}
      clearable
      placeholder={t('catalog.prices.select.channel.placeholder', 'Select a channel…')}
      loadSuggestions={(query) => loadOptions('/api/sales/channels', { search: query ?? '', pageSize: '50' }, mapItem)}
      resolveLabel={(id) => resolveOne('/api/sales/channels', 'id', id, mapItem)}
    />
  )
}

export function PricePriceKindSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const t = useT()
  const mapItem = React.useCallback((item: RemoteItem): ComboboxOption | null => {
    const id = pickString(item, 'id')
    if (!id) return null
    const title = pickString(item, 'title') || id
    const code = pickString(item, 'code')
    return { value: id, label: code ? `${title} (${code})` : title }
  }, [])
  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      allowCustomValues={false}
      placeholder={t('catalog.prices.select.priceKind.placeholder', 'Select a price kind…')}
      loadSuggestions={(query) => loadOptions('/api/catalog/price-kinds', { search: query ?? '', pageSize: '20' }, mapItem)}
      resolveLabel={(id) => resolveOne('/api/catalog/price-kinds', 'id', id, mapItem)}
    />
  )
}

export function PriceCurrencySelect({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const t = useT()
  const mapItem = React.useCallback((item: RemoteItem): ComboboxOption | null => {
    const code = pickString(item, 'value')
    if (!code) return null
    const label = pickString(item, 'label') || code
    return { value: code, label: label === code ? code : `${code} — ${label}` }
  }, [])
  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      allowCustomValues={false}
      placeholder={t('catalog.prices.select.currency.placeholder', 'Select a currency…')}
      loadSuggestions={(query) => loadOptions('/api/currencies/currencies/options', { search: query ?? '', limit: '20' }, mapItem)}
      resolveLabel={(id) => resolveOne('/api/currencies/currencies/options', 'search', id, mapItem)}
    />
  )
}
