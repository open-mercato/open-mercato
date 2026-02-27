import * as React from 'react'
import { withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'

type Translator = (key: string, fallback: string, vars?: Record<string, unknown>) => string

export type OfferPriceRow = {
  id?: string
  priceKindId?: string | null
  priceKindCode?: string | null
  priceKindTitle?: string | null
  currencyCode?: string | null
  unitPriceNet?: string | number | null
  unitPriceGross?: string | number | null
  displayMode?: string | null
}

export type OfferRow = {
  id: string
  channelId?: string | null
  title: string
  description: string | null
  productId: string | null
  productTitle: string | null
  productSku: string | null
  productMediaUrl: string | null
  prices: OfferPriceRow[]
  productDefaultPrices: OfferPriceRow[]
  productChannelPrice: OfferPriceRow | null
  isActive: boolean
  updatedAt: string | null
}

export function mapOfferRow(item: Record<string, unknown>): OfferRow {
  const product = item.product && typeof item.product === 'object'
    ? item.product as Record<string, unknown>
    : null
  const prices = Array.isArray(item.prices) ? item.prices as Array<Record<string, unknown>> : []
  const productDefaultPrices = Array.isArray(item.productDefaultPrices)
    ? item.productDefaultPrices as Array<Record<string, unknown>>
    : Array.isArray(item.product_default_prices)
      ? item.product_default_prices as Array<Record<string, unknown>>
      : []
  const productChannelPriceSource =
    item.productChannelPrice && typeof item.productChannelPrice === 'object'
      ? item.productChannelPrice as Record<string, unknown>
      : item.product_channel_price && typeof item.product_channel_price === 'object'
        ? item.product_channel_price as Record<string, unknown>
        : null
  return withDataTableNamespaces({
    id: typeof item.id === 'string' ? item.id : '',
    channelId: typeof item.channelId === 'string'
      ? item.channelId
      : typeof item.channel_id === 'string'
        ? item.channel_id
        : null,
    title: typeof item.title === 'string' && item.title.length ? item.title : 'Untitled offer',
    description: typeof item.description === 'string' ? item.description : null,
    productId: typeof item.productId === 'string'
      ? item.productId
      : typeof item.product_id === 'string'
        ? item.product_id
        : null,
    productTitle: typeof product?.title === 'string' ? product.title : null,
    productSku: typeof product?.sku === 'string' ? product.sku : null,
    productMediaUrl:
      typeof item.defaultMediaUrl === 'string'
        ? item.defaultMediaUrl
        : typeof item.default_media_url === 'string'
          ? item.default_media_url
          : typeof product?.defaultMediaUrl === 'string'
            ? product.defaultMediaUrl
            : typeof product?.default_media_url === 'string'
              ? product.default_media_url
              : null,
    prices: prices.map(mapPriceRow),
    productDefaultPrices: productDefaultPrices.map(mapPriceRow),
    productChannelPrice: mapPriceSummary(productChannelPriceSource),
    isActive: item.isActive === true || item.is_active === true,
    updatedAt: typeof item.updatedAt === 'string'
      ? item.updatedAt
      : typeof item.updated_at === 'string'
        ? item.updated_at
        : null,
  }, item)
}

export function renderOfferPriceSummary(
  row: OfferRow,
  t: Translator,
): React.ReactNode {
  if (!row.prices.length) {
    if (row.productDefaultPrices.length) {
      return (
        <div className="flex flex-wrap gap-2">
          {row.productDefaultPrices.map((price) => renderPriceBadge(price, t, true))}
        </div>
      )
    }
    if (row.productChannelPrice) {
      return (
        <span className="text-xs text-muted-foreground">
          {t('sales.channels.offers.table.channelPrice', 'Original product price {{price}}', {
            price: formatPriceValue(row.productChannelPrice),
          })}
        </span>
      )
    }
    return <span className="text-xs text-muted-foreground">{t('sales.channels.offers.table.noOverrides', 'No overrides')}</span>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {row.prices.map((price) => renderPriceBadge(price, t))}
    </div>
  )
}

function mapPriceSummary(source: Record<string, unknown> | null): OfferPriceRow | null {
  if (!source) return null
  return mapPriceRow(source)
}

function formatPriceValue(price: OfferPriceRow | null): string {
  if (!price) return '—'
  const amount = price.displayMode === 'including-tax'
    ? price.unitPriceGross ?? price.unitPriceNet
    : price.unitPriceNet ?? price.unitPriceGross
  if (amount === null || amount === undefined) return price.currencyCode ?? '—'
  return `${price.currencyCode ?? ''} ${String(amount)}`
}

function mapPriceRow(source: Record<string, unknown>): OfferPriceRow {
  return {
    id: readString(source.id) ?? undefined,
    priceKindId: readString(source.priceKindId ?? source.price_kind_id),
    priceKindCode: readString(source.priceKindCode ?? source.price_kind_code),
    priceKindTitle: readString(source.priceKindTitle ?? source.price_kind_title),
    currencyCode: readString(source.currencyCode ?? source.currency_code),
    unitPriceNet: readPriceValue(source.unitPriceNet ?? source.unit_price_net),
    unitPriceGross: readPriceValue(source.unitPriceGross ?? source.unit_price_gross),
    displayMode: readString(source.displayMode ?? source.display_mode),
  }
}

function readPriceValue(value: unknown): string | number | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  return null
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value.toString()
  return null
}

function renderPriceBadge(price: OfferPriceRow, t: Translator, muted?: boolean) {
  const label = price.priceKindTitle || price.priceKindCode || t('sales.channels.offers.table.price', 'Price')
  const numeric = price.displayMode === 'including-tax'
    ? price.unitPriceGross ?? price.unitPriceNet
    : price.unitPriceNet ?? price.unitPriceGross
  const amount = numeric === null || numeric === undefined ? '—' : String(numeric)
  const className = ['rounded border px-2 py-1 text-xs', muted ? 'bg-muted' : null].filter(Boolean).join(' ')
  return (
    <div key={`${price.id ?? 'price'}-${label}`} className={className}>
      <div className="font-medium">{label}</div>
      <div className="text-muted-foreground">
        {price.currencyCode ?? ''} {amount}
      </div>
    </div>
  )
}
