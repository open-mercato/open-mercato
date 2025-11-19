import * as React from 'react'

type Translator = (key: string, fallback: string, vars?: Record<string, unknown>) => string

export type OfferPriceRow = {
  id?: string
  priceKindId?: string | null
  priceKindCode?: string | null
  priceKindTitle?: string | null
  currencyCode?: string | null
  unitPriceNet?: string | null
  unitPriceGross?: string | null
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
  productChannelPrice: OfferPriceRow | null
  isActive: boolean
  updatedAt: string | null
}

export function mapOfferRow(item: Record<string, unknown>): OfferRow {
  const product = item.product && typeof item.product === 'object'
    ? item.product as Record<string, unknown>
    : null
  const prices = Array.isArray(item.prices) ? item.prices as Array<Record<string, unknown>> : []
  const productChannelPriceSource =
    item.productChannelPrice && typeof item.productChannelPrice === 'object'
      ? item.productChannelPrice
      : item.product_channel_price && typeof item.product_channel_price === 'object'
        ? item.product_channel_price
        : null
  return {
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
    productMediaUrl: typeof product?.defaultMediaUrl === 'string'
      ? product.defaultMediaUrl
      : typeof product?.default_media_url === 'string'
        ? product.default_media_url
        : null,
    prices: prices.map((row) => ({
      id: typeof row.id === 'string' ? row.id : undefined,
      priceKindId: typeof row.priceKindId === 'string'
        ? row.priceKindId
        : typeof row.price_kind_id === 'string'
          ? row.price_kind_id
          : null,
      priceKindCode: typeof row.priceKindCode === 'string'
        ? row.priceKindCode
        : typeof row.price_kind_code === 'string'
          ? row.price_kind_code
          : null,
      priceKindTitle: typeof row.priceKindTitle === 'string'
        ? row.priceKindTitle
        : typeof row.price_kind_title === 'string'
          ? row.price_kind_title
          : null,
      currencyCode: typeof row.currencyCode === 'string'
        ? row.currencyCode
        : typeof row.currency_code === 'string'
          ? row.currency_code
          : null,
      unitPriceNet: typeof row.unitPriceNet === 'string'
        ? row.unitPriceNet
        : typeof row.unit_price_net === 'string'
          ? row.unit_price_net
          : null,
      unitPriceGross: typeof row.unitPriceGross === 'string'
        ? row.unitPriceGross
        : typeof row.unit_price_gross === 'string'
          ? row.unit_price_gross
          : null,
      displayMode: typeof row.displayMode === 'string'
        ? row.displayMode
        : typeof row.display_mode === 'string'
          ? row.display_mode
          : null,
    })),
    productChannelPrice: mapPriceSummary(productChannelPriceSource),
    isActive: item.isActive === true || item.is_active === true,
    updatedAt: typeof item.updatedAt === 'string'
      ? item.updatedAt
      : typeof item.updated_at === 'string'
        ? item.updated_at
        : null,
  }
}

export function renderOfferPriceSummary(
  row: OfferRow,
  t: Translator,
): React.ReactNode {
  if (!row.prices.length) {
    if (row.productChannelPrice) {
      return (
        <span className="text-xs text-muted-foreground">
          {t('sales.channels.offers.table.channelPrice', 'Channel price {{price}}', {
            price: formatPriceValue(row.productChannelPrice),
          })}
        </span>
      )
    }
    return <span className="text-xs text-muted-foreground">{t('sales.channels.offers.table.noOverrides', 'No overrides')}</span>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {row.prices.map((price) => {
        const label = price.priceKindTitle || price.priceKindCode || t('sales.channels.offers.table.price', 'Price')
        const numeric = price.displayMode === 'including-tax'
          ? price.unitPriceGross ?? price.unitPriceNet
          : price.unitPriceNet ?? price.unitPriceGross
        return (
          <div key={`${price.id ?? 'price'}-${label}`} className="rounded border px-2 py-1 text-xs">
            <div className="font-medium">{label}</div>
            <div className="text-muted-foreground">
              {price.currencyCode ?? ''} {numeric ?? '—'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function mapPriceSummary(source: Record<string, unknown> | null): OfferPriceRow | null {
  if (!source) return null
  return {
    currencyCode: typeof source.currencyCode === 'string'
      ? source.currencyCode
      : typeof source.currency_code === 'string'
        ? source.currency_code
        : null,
    unitPriceNet: typeof source.unitPriceNet === 'string'
      ? source.unitPriceNet
      : typeof source.unit_price_net === 'string'
        ? source.unit_price_net
        : null,
    unitPriceGross: typeof source.unitPriceGross === 'string'
      ? source.unitPriceGross
      : typeof source.unit_price_gross === 'string'
        ? source.unit_price_gross
        : null,
    displayMode: typeof source.displayMode === 'string'
      ? source.displayMode
      : typeof source.display_mode === 'string'
        ? source.display_mode
        : null,
  }
}

function formatPriceValue(price: OfferPriceRow | null): string {
  if (!price) return '—'
  const amount = price.displayMode === 'including-tax'
    ? price.unitPriceGross ?? price.unitPriceNet
    : price.unitPriceNet ?? price.unitPriceGross
  if (!amount) return price.currencyCode ?? '—'
  return `${price.currencyCode ?? ''} ${amount}`
}
