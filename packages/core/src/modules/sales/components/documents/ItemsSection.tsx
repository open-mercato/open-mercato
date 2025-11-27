"use client"

import * as React from 'react'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useT } from '@/lib/i18n/context'

type ItemRecord = {
  id: string
  name: string | null
  productId: string | null
  productVariantId: string | null
  quantity: number
  currencyCode: string | null
  unitPriceNet: number
  unitPriceGross: number
  taxRate: number
  totalGross: number
  metadata?: Record<string, unknown> | null
  catalogSnapshot?: Record<string, unknown> | null
}

type ProductOption = {
  id: string
  title: string
  sku: string | null
  thumbnailUrl: string | null
}

type VariantOption = {
  id: string
  title: string
  sku: string | null
  thumbnailUrl: string | null
}

type PriceOption = {
  id: string
  amountNet: number | null
  amountGross: number | null
  currencyCode: string | null
  displayMode: 'including-tax' | 'excluding-tax' | null
  taxRate: number | null
  label: string
  priceKindId?: string | null
  priceKindTitle?: string | null
  priceKindCode?: string | null
}

type LineFormState = {
  productId: string | null
  variantId: string | null
  quantity: string
  priceId: string | null
  priceMode: 'net' | 'gross'
  unitPrice: string
  taxRate: number | null
  name: string
  currencyCode: string | null
  catalogSnapshot?: Record<string, unknown> | null
}

type SalesDocumentItemsSectionProps = {
  documentId: string
  kind: 'order' | 'quote'
  currencyCode: string | null | undefined
}

const defaultForm = (currencyCode?: string | null): LineFormState => ({
  productId: null,
  variantId: null,
  quantity: '1',
  priceId: null,
  priceMode: 'gross',
  unitPrice: '',
  taxRate: null,
  name: '',
  currencyCode: currencyCode ?? null,
  catalogSnapshot: null,
})

function normalizeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

function formatMoney(value: number, currency: string | null | undefined): string {
  if (!currency) return value.toFixed(2)
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

export function SalesDocumentItemsSection({ documentId, kind, currencyCode }: SalesDocumentItemsSectionProps) {
  const t = useT()
  const [items, setItems] = React.useState<ItemRecord[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<LineFormState>(() => defaultForm(currencyCode))
  const [productOption, setProductOption] = React.useState<ProductOption | null>(null)
  const [variantOption, setVariantOption] = React.useState<VariantOption | null>(null)
  const [priceOptions, setPriceOptions] = React.useState<PriceOption[]>([])
  const [priceLoading, setPriceLoading] = React.useState(false)
  const productOptionsRef = React.useRef<Map<string, ProductOption>>(new Map())
  const variantOptionsRef = React.useRef<Map<string, VariantOption>>(new Map())

  const resourcePath = React.useMemo(
    () => (kind === 'order' ? 'sales/order-lines' : 'sales/quote-lines'),
    [kind],
  )
  const documentKey = kind === 'order' ? 'orderId' : 'quoteId'

  const loadItems = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '200', [documentKey]: documentId })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/${resourcePath}?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      if (response.ok && Array.isArray(response.result?.items)) {
        const mapped: ItemRecord[] = response.result.items
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id : null,
            name:
              typeof item.name === 'string'
                ? item.name
                : typeof item.catalog_snapshot === 'object' &&
                    item.catalog_snapshot &&
                    typeof (item.catalog_snapshot as any).name === 'string'
                  ? (item.catalog_snapshot as any).name
                  : null,
            productId: typeof item.product_id === 'string' ? item.product_id : null,
            productVariantId: typeof item.product_variant_id === 'string' ? item.product_variant_id : null,
            quantity: normalizeNumber(item.quantity, 0),
            currencyCode:
              typeof item.currency_code === 'string'
                ? item.currency_code
                : typeof currencyCode === 'string'
                  ? currencyCode
                  : null,
            unitPriceNet: normalizeNumber(item.unit_price_net, 0),
            unitPriceGross: normalizeNumber(item.unit_price_gross, 0),
            taxRate: normalizeNumber(item.tax_rate, 0),
            totalGross: normalizeNumber(item.total_gross_amount, 0),
            metadata: (item.metadata as Record<string, unknown> | null | undefined) ?? null,
            catalogSnapshot: (item.catalog_snapshot as Record<string, unknown> | null | undefined) ?? null,
          }))
          .filter((entry): entry is ItemRecord => Boolean(entry.id))
        setItems(mapped)
      } else {
        setItems([])
      }
    } catch (err) {
      console.error('sales.document.items.load', err)
      setError(t('sales.documents.items.errorLoad', 'Failed to load items.'))
    } finally {
      setLoading(false)
    }
  }, [currencyCode, documentId, documentKey, resourcePath, t])

  React.useEffect(() => {
    void loadItems()
  }, [loadItems])

  const resetForm = React.useCallback(() => {
    setForm(defaultForm(currencyCode))
    setProductOption(null)
    setVariantOption(null)
    setPriceOptions([])
    setEditingId(null)
  }, [currencyCode])

  const openCreate = React.useCallback(() => {
    resetForm()
    setDialogOpen(true)
  }, [resetForm])

  const onCloseDialog = React.useCallback(() => {
    setDialogOpen(false)
    resetForm()
  }, [resetForm])

  const loadProductOptions = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const params = new URLSearchParams({ pageSize: '8' })
      if (query && query.trim().length) params.set('search', query.trim())
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/catalog/products?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(response.result?.items) ? response.result?.items ?? [] : []
      return items
        .map((item) => {
          const id = typeof item.id === 'string' ? item.id : null
          if (!id) return null
          const title =
            typeof item.title === 'string'
              ? item.title
              : typeof (item as any).name === 'string'
                ? (item as any).name
                : id
          const sku = typeof (item as any).sku === 'string' ? (item as any).sku : null
          const thumbnail =
            typeof (item as any).default_media_url === 'string'
              ? (item as any).default_media_url
              : typeof (item as any).defaultMediaUrl === 'string'
                ? (item as any).defaultMediaUrl
                : null
          return {
            id,
            title,
            subtitle: sku ?? undefined,
            icon: thumbnail ? <img src={thumbnail} alt={title} className="h-8 w-8 rounded object-cover" /> : undefined,
            option: { id, title, sku, thumbnailUrl: thumbnail } satisfies ProductOption,
          } as LookupSelectItem & { option: ProductOption }
        })
        .filter((entry): entry is LookupSelectItem & { option: ProductOption } => Boolean(entry))
        .map((entry) => {
          productOptionsRef.current.set(entry.option.id, entry.option)
          return entry
        })
    },
    [],
  )

  const loadVariantOptions = React.useCallback(
    async (productId: string): Promise<LookupSelectItem[]> => {
      if (!productId) return []
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/catalog/variants?productId=${encodeURIComponent(productId)}&pageSize=50`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      return items
        .map((item) => {
          const id = typeof item.id === 'string' ? item.id : null
          if (!id) return null
          const title = typeof item.name === 'string' ? item.name : id
          const sku = typeof (item as any).sku === 'string' ? (item as any).sku : null
          const thumbnail =
            typeof (item as any).default_media_url === 'string'
              ? (item as any).default_media_url
              : typeof (item as any).thumbnailUrl === 'string'
                ? (item as any).thumbnailUrl
                : null
          return {
            id,
            title,
            subtitle: sku ?? undefined,
            icon: thumbnail ? <img src={thumbnail} alt={title} className="h-8 w-8 rounded object-cover" /> : undefined,
            option: { id, title, sku, thumbnailUrl: thumbnail } satisfies VariantOption,
          } as LookupSelectItem & { option: VariantOption }
        })
        .filter((entry): entry is LookupSelectItem & { option: VariantOption } => Boolean(entry))
        .map((entry) => {
          variantOptionsRef.current.set(entry.option.id, entry.option)
          return entry
        })
    },
    [],
  )

  const loadPrices = React.useCallback(
    async (productId: string | null, variantId: string | null) => {
      if (!productId) {
        setPriceOptions([])
        return []
      }
      setPriceLoading(true)
      try {
        const params = new URLSearchParams({ productId, pageSize: '20' })
        if (variantId) params.set('variantId', variantId)
        const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/catalog/prices?${params.toString()}`,
          undefined,
          { fallback: { items: [] } },
        )
        const items = Array.isArray(response.result?.items) ? response.result.items : []
        const mapped: PriceOption[] = items
          .map((item) => {
            const id = typeof item.id === 'string' ? item.id : null
            if (!id) return null
            const amountNet = normalizeNumber((item as any).unit_price_net, null as any)
            const amountGross = normalizeNumber((item as any).unit_price_gross, null as any)
            const currency =
              typeof (item as any).currency_code === 'string'
                ? (item as any).currency_code
                : typeof (item as any).currencyCode === 'string'
                  ? (item as any).currencyCode
                  : null
            const displayMode =
              (item as any).display_mode === 'including-tax' || (item as any).display_mode === 'excluding-tax'
                ? (item as any).display_mode
                : (item as any).displayMode === 'including-tax' || (item as any).displayMode === 'excluding-tax'
                  ? (item as any).displayMode
                  : null
            const taxRate = normalizeNumber((item as any).tax_rate, null as any)
            const priceKindId =
              typeof (item as any).price_kind_id === 'string'
                ? (item as any).price_kind_id
                : typeof (item as any).priceKindId === 'string'
                  ? (item as any).priceKindId
                  : null
            const priceKindTitle =
              typeof (item as any).price_kind_title === 'string'
                ? (item as any).price_kind_title
                : typeof (item as any).priceKindTitle === 'string'
                  ? (item as any).priceKindTitle
                  : typeof (item as any).price_kind === 'object' &&
                      item &&
                      typeof (item as any).price_kind?.title === 'string'
                    ? (item as any).price_kind.title
                    : null
            const priceKindCode =
              typeof (item as any).price_kind_code === 'string'
                ? (item as any).price_kind_code
                : typeof (item as any).priceKindCode === 'string'
                  ? (item as any).priceKindCode
                  : typeof (item as any).price_kind === 'object' &&
                      item &&
                      typeof (item as any).price_kind?.code === 'string'
                    ? (item as any).price_kind.code
                    : null
            const labelParts = [
              displayMode === 'including-tax' && amountGross !== null && currency
                ? formatMoney(amountGross, currency)
                : null,
              displayMode === 'excluding-tax' && amountNet !== null && currency
                ? formatMoney(amountNet, currency)
                : null,
              displayMode
                ? displayMode === 'including-tax'
                  ? t('sales.documents.items.priceGross', 'Gross')
                  : t('sales.documents.items.priceNet', 'Net')
                : null,
              priceKindTitle ?? priceKindCode ?? null,
            ].filter(Boolean)
            const label =
              labelParts.length > 0
                ? labelParts.join(' • ')
                : amountGross !== null && currency
                  ? formatMoney(amountGross, currency)
                  : amountNet !== null && currency
                    ? formatMoney(amountNet, currency)
                    : id
            return {
              id,
              amountNet: amountNet ?? null,
              amountGross: amountGross ?? null,
              currencyCode: currency,
              displayMode: displayMode as PriceOption['displayMode'],
              taxRate: Number.isFinite(taxRate) ? taxRate : null,
              label,
              priceKindId,
              priceKindTitle: priceKindTitle ?? null,
              priceKindCode: priceKindCode ?? null,
            } as PriceOption
          })
          .filter((entry): entry is PriceOption => Boolean(entry))
        setPriceOptions(mapped)
        return mapped
      } catch (err) {
        console.error('sales.document.items.loadPrices', err)
        return []
      } finally {
        setPriceLoading(false)
      }
    },
    [t],
  )

  const handleSubmit = React.useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      const quantity = Math.max(normalizeNumber(form.quantity ?? '', 1), 0)
      const resolvedName =
        (form.name ?? '').trim() ||
        variantOption?.title ||
        productOption?.title ||
        undefined
      const payload: Record<string, unknown> = {
        [documentKey]: documentId,
        productId: form.productId,
        productVariantId: form.variantId,
        quantity,
        currencyCode: form.currencyCode ?? currencyCode,
        priceId: form.priceId,
        priceMode: form.priceMode,
        taxRate: form.taxRate ?? undefined,
        catalogSnapshot: form.catalogSnapshot ?? null,
        metadata: {
          ...(form.catalogSnapshot ?? {}),
          ...(form.priceId ? { priceId: form.priceId } : {}),
          ...(form.priceMode ? { priceMode: form.priceMode } : {}),
          ...(productOption
            ? {
                productTitle: productOption.title,
                productSku: productOption.sku ?? null,
                productThumbnail: productOption.thumbnailUrl ?? null,
              }
            : {}),
          ...(variantOption
            ? {
                variantTitle: variantOption.title,
                variantSku: variantOption.sku ?? null,
                variantThumbnail: variantOption.thumbnailUrl ?? productOption?.thumbnailUrl ?? null,
              }
            : {}),
        },
      }
      if (resolvedName) {
        payload.name = resolvedName
      }
      if (form.priceMode === 'gross') {
        payload.unitPriceGross = normalizeNumber(form.unitPrice, 0)
      } else {
        payload.unitPriceNet = normalizeNumber(form.unitPrice, 0)
      }
      const action = editingId ? updateCrud : createCrud
      const result = await action(resourcePath, editingId ? { id: editingId, ...payload } : payload, {
        successMessage: editingId
          ? t('sales.documents.items.updated', 'Line updated.')
          : t('sales.documents.items.created', 'Line added.'),
        errorMessage: t('sales.documents.items.errorSave', 'Failed to save line.'),
      })
      if (result.ok) {
        await loadItems()
        setDialogOpen(false)
        resetForm()
      }
    } catch (err) {
      console.error('sales.document.items.save', err)
    } finally {
      setSaving(false)
    }
  }, [
    currencyCode,
    documentId,
    documentKey,
    editingId,
    form.catalogSnapshot,
    form.currencyCode,
    form.name,
    form.priceId,
    form.priceMode,
    form.productId,
    form.unitPrice,
    form.variantId,
    form.taxRate,
    form.quantity,
    loadItems,
    productOption,
    resetForm,
    resourcePath,
    saving,
    t,
    variantOption,
  ])

  const handleEdit = React.useCallback(
    (line: ItemRecord) => {
      setEditingId(line.id)
      const nextForm = defaultForm(line.currencyCode ?? currencyCode)
      nextForm.productId = line.productId
      nextForm.variantId = line.productVariantId
      nextForm.quantity = line.quantity.toString()
      nextForm.unitPrice = line.unitPriceGross.toString()
      nextForm.priceMode = 'gross'
      nextForm.taxRate = line.taxRate
      nextForm.name = line.name ?? ''
      nextForm.catalogSnapshot = line.catalogSnapshot ?? null
      const meta = line.metadata ?? {}
      if (typeof meta === 'object' && meta) {
        const mode = (meta as any).priceMode
        if (mode === 'net' || mode === 'gross') {
          nextForm.priceMode = mode
          nextForm.unitPrice =
            mode === 'net' ? line.unitPriceNet.toString() : line.unitPriceGross.toString()
        }
        nextForm.priceId =
          typeof (meta as any).priceId === 'string' ? ((meta as any).priceId as string) : null
        const productTitle = typeof (meta as any).productTitle === 'string' ? (meta as any).productTitle : line.name
        const productSku = typeof (meta as any).productSku === 'string' ? (meta as any).productSku : null
        const productThumbnail =
          typeof (meta as any).productThumbnail === 'string' ? (meta as any).productThumbnail : null
        if (productTitle) {
          setProductOption({ id: line.productId ?? '', title: productTitle, sku: productSku, thumbnailUrl: productThumbnail })
        }
        const variantTitle = typeof (meta as any).variantTitle === 'string' ? (meta as any).variantTitle : null
        const variantSku = typeof (meta as any).variantSku === 'string' ? (meta as any).variantSku : null
        const variantThumb =
          typeof (meta as any).variantThumbnail === 'string' ? (meta as any).variantThumbnail : productThumbnail
        if (variantTitle && line.productVariantId) {
          setVariantOption({
            id: line.productVariantId,
            title: variantTitle,
            sku: variantSku,
            thumbnailUrl: variantThumb ?? null,
          })
        }
      }
      setForm(nextForm)
      setDialogOpen(true)
    },
    [currencyCode],
  )

  const handleDelete = React.useCallback(
    async (line: ItemRecord) => {
      try {
        await deleteCrud(resourcePath, { id: line.id, [documentKey]: documentId }, {
          successMessage: t('sales.documents.items.deleted', 'Line removed.'),
          errorMessage: t('sales.documents.items.errorDelete', 'Failed to delete line.'),
        })
        await loadItems()
      } catch (err) {
        console.error('sales.document.items.delete', err)
      }
    },
    [documentId, documentKey, loadItems, resourcePath, t],
  )

  const renderImage = (record: ItemRecord) => {
    const meta = (record.metadata as Record<string, unknown> | null | undefined) ?? {}
    const thumbnail =
      (meta && typeof meta.productThumbnail === 'string' && meta.productThumbnail) ||
      (meta && typeof (meta as any).variantThumbnail === 'string' && (meta as any).variantThumbnail) ||
      null
    if (thumbnail) {
      return <img src={thumbnail} alt={record.name ?? record.id} className="h-10 w-10 rounded border object-cover" />
    }
    return <div className="flex h-10 w-10 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">N/A</div>
  }

  const onPriceSelect = React.useCallback(
    (price: PriceOption | null) => {
      if (!price) return
      setForm((prev) => ({
        ...prev,
        priceId: price.id,
        priceMode: price.displayMode === 'excluding-tax' ? 'net' : 'gross',
        unitPrice:
          price.displayMode === 'excluding-tax'
            ? (price.amountNet ?? price.amountGross ?? 0).toString()
            : (price.amountGross ?? price.amountNet ?? 0).toString(),
        taxRate: price.taxRate,
        currencyCode: price.currencyCode ?? prev.currencyCode ?? currencyCode ?? null,
      }))
    },
    [currencyCode],
  )

  const dialogTitle = editingId
    ? t('sales.documents.items.editTitle', 'Edit line')
    : t('sales.documents.items.addTitle', 'Add line')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{t('sales.documents.items.title', 'Items')}</p>
          <p className="text-xs text-muted-foreground">
            {t('sales.documents.items.subtitle', 'Add products and configure pricing for this document.')}
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {t('sales.documents.items.add', 'Add item')}
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4 animate-spin" />
          {t('sales.documents.items.loading', 'Loading items…')}
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('sales.documents.items.empty', 'No items yet.')}</p>
      ) : (
        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{t('sales.documents.items.table.product', 'Product')}</th>
                <th className="px-3 py-2 font-medium">{t('sales.documents.items.table.quantity', 'Qty')}</th>
                <th className="px-3 py-2 font-medium">{t('sales.documents.items.table.unit', 'Unit price')}</th>
                <th className="px-3 py-2 font-medium">{t('sales.documents.items.table.total', 'Total')}</th>
                <th className="px-3 py-2 font-medium sr-only">{t('sales.documents.items.table.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      {renderImage(item)}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{item.name ?? t('sales.documents.items.untitled', 'Untitled')}</div>
                        {item.metadata && typeof (item.metadata as any).productSku === 'string' ? (
                          <div className="text-xs text-muted-foreground">{(item.metadata as any).productSku}</div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">{item.quantity}</td>
                  <td className="px-3 py-3">
                    {formatMoney(item.unitPriceGross, item.currencyCode ?? currencyCode ?? undefined)}{' '}
                    <span className="text-xs text-muted-foreground">
                      {t('sales.documents.items.table.gross', 'gross')}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-semibold">
                    {formatMoney(item.totalGross, item.currencyCode ?? currencyCode ?? undefined)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleEdit(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => void handleDelete(item)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : onCloseDialog())}>
        <DialogContent
          className="sm:max-w-2xl"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void handleSubmit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onCloseDialog()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
              <Label>{t('sales.documents.items.product', 'Product')}</Label>
              <LookupSelect
                value={form.productId}
                onChange={(next) => {
                  const selectedOption = next ? productOptionsRef.current.get(next) ?? null : null
                  setProductOption(selectedOption)
                  setForm((prev) => {
                    const shouldSetName = !(prev.name ?? '').trim().length
                    return {
                      ...prev,
                      productId: next,
                      variantId: null,
                      priceId: null,
                      unitPrice: '',
                      name: shouldSetName ? selectedOption?.title ?? prev.name : prev.name,
                      catalogSnapshot: next
                        ? {
                            product: {
                              id: next,
                              title: selectedOption?.title ?? prev.catalogSnapshot?.product?.['title'] ?? null,
                              sku: selectedOption?.sku ?? null,
                              thumbnailUrl: selectedOption?.thumbnailUrl ?? null,
                            },
                          }
                        : null,
                    }
                  })
                  if (next) {
                    void loadPrices(next, null)
                  } else {
                    setPriceOptions([])
                  }
                  }}
                  fetchItems={loadProductOptions}
                  searchPlaceholder={t('sales.documents.items.productSearch', 'Search product')}
                  selectedHintLabel={(id) => t('sales.documents.items.selectedProduct', 'Selected {{id}}', { id })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('sales.documents.items.variant', 'Variant')}</Label>
                <LookupSelect
                  value={form.variantId}
                  onChange={(next) => {
                    const selectedOption = next ? variantOptionsRef.current.get(next) ?? null : null
                    setVariantOption(selectedOption)
                    setForm((prev) => {
                      const shouldSetName = !(prev.name ?? '').trim().length
                      return {
                        ...prev,
                        variantId: next,
                        name: shouldSetName
                          ? selectedOption?.title ?? prev.name ?? productOption?.title ?? ''
                          : prev.name,
                        catalogSnapshot: next
                          ? {
                              ...(prev.catalogSnapshot ?? {}),
                              variant: {
                                id: next,
                                title: selectedOption?.title ?? null,
                                sku: selectedOption?.sku ?? null,
                                thumbnailUrl: selectedOption?.thumbnailUrl ?? null,
                              },
                            }
                          : prev.catalogSnapshot,
                      }
                    })
                    void loadPrices(form.productId, next)
                  }}
                  fetchItems={async (query) => {
                    if (!form.productId) return []
                    const options = await loadVariantOptions(form.productId)
                    const needle = query?.trim().toLowerCase() ?? ''
                    return needle.length
                      ? options.filter((option) => option.title.toLowerCase().includes(needle))
                      : options
                  }}
                  searchPlaceholder={t('sales.documents.items.variantSearch', 'Search variant')}
                  minQuery={0}
                  disabled={!form.productId}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{t('sales.documents.items.price', 'Price')}</Label>
                <LookupSelect
                  value={form.priceId}
                  onChange={(next) => {
                    const selected = priceOptions.find((entry) => entry.id === next) ?? null
                    if (selected) {
                      onPriceSelect(selected)
                    } else {
                      setForm((prev) => ({ ...prev, priceId: null }))
                    }
                  }}
                  fetchItems={async (query) => {
                    const prices = await loadPrices(form.productId, form.variantId)
                    const needle = query?.trim().toLowerCase() ?? ''
                    return prices
                      .filter((price) => {
                        if (!needle.length) return true
                        const haystack = [
                          price.label,
                          price.priceKindTitle,
                          price.priceKindCode,
                          price.currencyCode,
                        ]
                          .filter(Boolean)
                          .join(' ')
                          .toLowerCase()
                        return haystack.includes(needle)
                      })
                      .map<LookupSelectItem>((price) => ({
                        id: price.id,
                        title: price.label,
                        subtitle:
                          price.displayMode === 'including-tax'
                            ? t('sales.documents.items.priceGross', 'Gross')
                            : price.displayMode === 'excluding-tax'
                              ? t('sales.documents.items.priceNet', 'Net')
                              : undefined,
                        rightLabel: price.priceKindTitle ?? price.priceKindCode ?? undefined,
                      }))
                  }}
                  minQuery={0}
                  loading={priceLoading}
                  searchPlaceholder={t('sales.documents.items.priceSearch', 'Select price')}
                  disabled={!form.productId}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('sales.documents.items.unitPrice', 'Unit price')}</Label>
                <div className="flex gap-2">
                  <Input
                    value={form.unitPrice}
                    onChange={(event) => setForm((prev) => ({ ...prev, unitPrice: event.target.value }))}
                    placeholder="0.00"
                  />
                  <select
                    className="w-32 rounded border px-2 text-sm"
                    value={form.priceMode}
                    onChange={(event) => {
                      const mode = event.target.value === 'net' ? 'net' : 'gross'
                      setForm((prev) => ({ ...prev, priceMode: mode }))
                    }}
                  >
                    <option value="gross">{t('sales.documents.items.priceGross', 'Gross')}</option>
                    <option value="net">{t('sales.documents.items.priceNet', 'Net')}</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('sales.documents.items.quantity', 'Quantity')}</Label>
                <Input
                  value={form.quantity}
                  onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
                  placeholder="1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('sales.documents.items.name', 'Name')}</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder={t('sales.documents.items.namePlaceholder', 'Optional line name')}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={onCloseDialog} type="button">
              {t('sales.documents.items.cancel', 'Cancel')}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving} type="button">
              {saving ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingId ? t('sales.documents.items.save', 'Save changes') : t('sales.documents.items.addLine', 'Add item')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
