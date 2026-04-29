"use client"

import * as React from 'react'
import { Package, Tag as TagIcon } from 'lucide-react'
import { KeyValueList, RecordCardShell, TagRow, statusToTagVariant } from './RecordCardShell'
import type { ProductRecordPayload } from './types'

function formatPrice(price: string | number | null | undefined, currency?: string | null): string | null {
  if (price === null || price === undefined || price === '') return null
  const value = typeof price === 'number' ? price : Number(price)
  if (!Number.isFinite(value)) {
    return typeof price === 'string' ? price : null
  }
  const code = currency && currency.length === 3 ? currency.toUpperCase() : undefined
  try {
    if (code) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(value)
    }
  } catch {
    // fall through
  }
  const formatted = new Intl.NumberFormat().format(value)
  return code ? `${formatted} ${code}` : formatted
}

export interface ProductCardProps extends ProductRecordPayload {}

export function ProductCard(props: ProductCardProps) {
  const status = props.status
    ? { label: props.status, variant: statusToTagVariant(props.status) }
    : null
  const price = formatPrice(props.price, props.currency)

  const leading = props.imageUrl ? (
    <div className="relative size-12 overflow-hidden rounded-md border border-border bg-muted">
      <img
        src={props.imageUrl}
        alt={props.name}
        className="size-full object-cover"
        loading="lazy"
      />
    </div>
  ) : (
    <div className="flex size-12 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground" aria-hidden>
      <Package className="size-5" />
    </div>
  )

  const items = [
    props.sku ? { label: 'SKU', value: <span className="font-mono text-[11px]">{props.sku}</span> } : null,
    price ? { label: 'Price', value: <span className="font-medium">{price}</span> } : null,
    props.category ? { label: 'Category', value: props.category } : null,
  ].filter(Boolean) as { label: string; value: React.ReactNode }[]

  return (
    <RecordCardShell
      kindLabel="Product"
      kindIcon={<Package className="size-4" aria-hidden />}
      leading={leading}
      title={props.name}
      subtitle={[props.sku, price].filter(Boolean).join(' • ') || undefined}
      status={status}
      href={props.href}
      id={props.id}
      className={props.className}
      dataKind="product"
    >
      <div className="space-y-2">
        <KeyValueList items={items} />
        {props.description ? (
          <p className="line-clamp-2 text-muted-foreground">{props.description}</p>
        ) : null}
        {props.tags && props.tags.length > 0 ? <TagRow tags={props.tags} /> : null}
      </div>
    </RecordCardShell>
  )
}

export default ProductCard

export { Package, TagIcon }
