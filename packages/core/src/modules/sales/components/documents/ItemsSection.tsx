"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Pencil, Trash2 } from 'lucide-react'
import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@/lib/frontend/useOrganizationScope'
import { emitSalesDocumentTotalsRefresh } from '@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents'
import { LineItemDialog } from './LineItemDialog'
import type { SalesLineRecord } from './lineItemTypes'
import { formatMoney, normalizeNumber } from './lineItemUtils'
import type { SectionAction } from '@open-mercato/ui/backend/detail'

type SalesDocumentItemsSectionProps = {
  documentId: string
  kind: 'order' | 'quote'
  currencyCode: string | null | undefined
  organizationId?: string | null
  tenantId?: string | null
  onActionChange?: (action: SectionAction | null) => void
}

export function SalesDocumentItemsSection({
  documentId,
  kind,
  currencyCode,
  organizationId: orgFromProps,
  tenantId: tenantFromProps,
  onActionChange,
}: SalesDocumentItemsSectionProps) {
  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const resolvedOrganizationId = orgFromProps ?? organizationId ?? null
  const resolvedTenantId = tenantFromProps ?? tenantId ?? null
  const [items, setItems] = React.useState<SalesLineRecord[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [lineForEdit, setLineForEdit] = React.useState<SalesLineRecord | null>(null)

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
        const mapped: SalesLineRecord[] = response.result.items
          .map((item) => {
            const id = typeof item.id === 'string' ? item.id : null
            if (!id) return null
            const taxRate = normalizeNumber((item as any).tax_rate ?? (item as any).taxRate, 0)
            const rawCustomFields = Object.entries(item as Record<string, unknown>).reduce<Record<string, unknown>>(
              (acc, [key, value]) => {
                if (key.startsWith('cf_') || key.startsWith('cf:')) {
                  acc[key] = value
                }
                return acc
              },
              {},
            )
            const customFields = normalizeCustomFieldResponse(rawCustomFields) ?? null
            const name =
              typeof item.name === 'string'
                ? item.name
                : typeof item.catalog_snapshot === 'object' &&
                    item.catalog_snapshot &&
                    typeof (item.catalog_snapshot as any).name === 'string'
                  ? (item.catalog_snapshot as any).name
                  : null
            const quantity = normalizeNumber(item.quantity, 0)
            const unitPriceNetRaw = normalizeNumber((item as any).unit_price_net ?? (item as any).unitPriceNet, Number.NaN)
            const unitPriceGrossRaw = normalizeNumber(
              (item as any).unit_price_gross ?? (item as any).unitPriceGross,
              Number.NaN,
            )
            const unitPriceNet = Number.isFinite(unitPriceNetRaw)
              ? unitPriceNetRaw
              : Number.isFinite(unitPriceGrossRaw)
                ? unitPriceGrossRaw / (1 + taxRate / 100)
                : 0
            const unitPriceGross = Number.isFinite(unitPriceGrossRaw)
              ? unitPriceGrossRaw
              : Number.isFinite(unitPriceNetRaw)
                ? unitPriceNetRaw * (1 + taxRate / 100)
                : 0
            const totalNetRaw = normalizeNumber(
              (item as any).total_net_amount ?? (item as any).totalNetAmount,
              Number.NaN,
            )
            const totalGrossRaw = normalizeNumber(
              (item as any).total_gross_amount ?? (item as any).totalGrossAmount,
              Number.NaN,
            )
            const totalNet = Number.isFinite(totalNetRaw) ? totalNetRaw : unitPriceNet * quantity
            const totalGross = Number.isFinite(totalGrossRaw) ? totalGrossRaw : unitPriceGross * quantity
            const priceModeRaw =
              (item as any)?.metadata && typeof (item as any).metadata === 'object'
                ? ((item as any).metadata as Record<string, unknown>).priceMode
                : null
            const priceMode = priceModeRaw === 'net' ? 'net' : 'gross'
            return {
              id,
              name,
              productId: typeof item.product_id === 'string' ? item.product_id : null,
              productVariantId: typeof item.product_variant_id === 'string' ? item.product_variant_id : null,
              quantity,
              currencyCode:
                typeof item.currency_code === 'string'
                  ? item.currency_code
                  : typeof currencyCode === 'string'
                    ? currencyCode
                    : null,
              unitPriceNet,
              unitPriceGross,
              taxRate,
              totalNet,
              totalGross,
              priceMode,
              metadata: (item.metadata as Record<string, unknown> | null | undefined) ?? null,
              catalogSnapshot: (item.catalog_snapshot as Record<string, unknown> | null | undefined) ?? null,
              customFieldSetId:
                typeof (item as any).custom_field_set_id === 'string'
                  ? (item as any).custom_field_set_id
                  : typeof (item as any).customFieldSetId === 'string'
                    ? (item as any).customFieldSetId
                    : null,
              customFields,
            }
          })
          .filter((entry): entry is SalesLineRecord => Boolean(entry))
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

  const openCreate = React.useCallback(() => {
    setLineForEdit(null)
    setDialogOpen(true)
  }, [])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: t('sales.documents.items.add', 'Add item'),
      onClick: openCreate,
      disabled: false,
    })
    return () => onActionChange(null)
  }, [onActionChange, openCreate, t])

  const handleEdit = React.useCallback((line: SalesLineRecord) => {
    setLineForEdit(line)
    setDialogOpen(true)
  }, [])

  const resolveVariantInfo = React.useCallback((record: SalesLineRecord) => {
    const meta = (record.metadata as Record<string, unknown> | null | undefined) ?? null
    const snapshot = (record.catalogSnapshot as Record<string, unknown> | null | undefined) ?? null
    const variantSnapshot =
      snapshot && typeof (snapshot as any).variant === 'object' && (snapshot as any).variant
        ? ((snapshot as any).variant as Record<string, unknown>)
        : null
    const variantTitle =
      meta && typeof (meta as any).variantTitle === 'string'
        ? (meta as any).variantTitle
        : variantSnapshot && typeof (variantSnapshot as any).name === 'string'
          ? (variantSnapshot as any).name
          : null
    const variantSku =
      meta && typeof (meta as any).variantSku === 'string'
        ? (meta as any).variantSku
        : variantSnapshot && typeof (variantSnapshot as any).sku === 'string'
          ? (variantSnapshot as any).sku
          : null

    return { variantTitle, variantSku }
  }, [])

  const handleDelete = React.useCallback(
    async (line: SalesLineRecord) => {
      try {
        const result = await deleteCrud(resourcePath, {
          body: {
            id: line.id,
            [documentKey]: documentId,
            organizationId: resolvedOrganizationId ?? undefined,
            tenantId: resolvedTenantId ?? undefined,
          },
          errorMessage: t('sales.documents.items.errorDelete', 'Failed to delete line.'),
        })
        if (result.ok) {
          flash(t('sales.documents.items.deleted', 'Line removed.'), 'success')
          await loadItems()
          emitSalesDocumentTotalsRefresh({ documentId, kind })
        }
      } catch (err) {
        console.error('sales.document.items.delete', err)
        const normalized = normalizeCrudServerError(err)
        const fallback = t('sales.documents.items.errorDelete', 'Failed to delete line.')
        flash(normalized.message || fallback, 'error')
      }
    },
    [documentId, documentKey, kind, loadItems, resolvedOrganizationId, resourcePath, t, resolvedTenantId],
  )

  const renderImage = (record: SalesLineRecord) => {
    const meta = (record.metadata as Record<string, unknown> | null | undefined) ?? {}
    const snapshot = (record.catalogSnapshot as Record<string, unknown> | null | undefined) ?? {}
    const productSnapshot = typeof snapshot === 'object' && snapshot ? (snapshot as any).product ?? {} : {}
    const variantSnapshot = typeof snapshot === 'object' && snapshot ? (snapshot as any).variant ?? {} : {}
    const productThumb =
      (meta && typeof (meta as any).productThumbnail === 'string' && (meta as any).productThumbnail) ||
      (productSnapshot && typeof productSnapshot.thumbnailUrl === 'string' && productSnapshot.thumbnailUrl) ||
      null
    const variantThumb =
      (meta && typeof (meta as any).variantThumbnail === 'string' && (meta as any).variantThumbnail) ||
      (variantSnapshot && typeof variantSnapshot.thumbnailUrl === 'string' && variantSnapshot.thumbnailUrl) ||
      null
    const thumbnail = variantThumb ?? productThumb
    if (thumbnail) {
      return <img src={thumbnail} alt={record.name ?? record.id} className="h-10 w-10 rounded border object-cover" />
    }
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">
        N/A
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <LoadingMessage
          label={t('sales.documents.items.loading', 'Loading items…')}
          className="border-0 bg-transparent p-0 py-8 justify-center"
        />
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <TabEmptyState
          title={t('sales.documents.items.empty', 'No items yet.')}
          description={t(
            'sales.documents.items.subtitle',
            'Add products and configure pricing for this document.'
          )}
          action={{
            label: t('sales.documents.items.add', 'Add item'),
            onClick: openCreate,
          }}
        />
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
              {items.map((item) => {
                const meta = (item.metadata as Record<string, unknown> | null | undefined) ?? null
                const { variantTitle, variantSku } = resolveVariantInfo(item)
                const productSku = meta && typeof (meta as any).productSku === 'string' ? (meta as any).productSku : null
                const variantLabel = variantTitle ?? variantSku
                const variantSuffix = variantSku && variantLabel && variantSku !== variantLabel ? ` • ${variantSku}` : ''
                const showProductSku = productSku && productSku !== variantSku ? productSku : null

                return (
                  <tr
                    key={item.id}
                    className="border-t hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => handleEdit(item)}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        {renderImage(item)}
                        <div className="min-w-0">
                          <div className="truncate font-medium">{item.name ?? t('sales.documents.items.untitled', 'Untitled')}</div>
                          {variantLabel ? (
                            <div className="text-xs text-muted-foreground truncate">
                              {variantLabel}
                              {variantSuffix}
                            </div>
                          ) : null}
                          {showProductSku ? (
                            <div className="text-xs text-muted-foreground truncate">{showProductSku}</div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">{item.quantity}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-sm">
                          {formatMoney(item.unitPriceGross, item.currencyCode ?? currencyCode ?? undefined)}{' '}
                          <span className="text-xs text-muted-foreground">
                            {t('sales.documents.items.table.gross', 'gross')}
                          </span>
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatMoney(item.unitPriceNet, item.currencyCode ?? currencyCode ?? undefined)}{' '}
                          {t('sales.documents.items.table.net', 'net')}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold">
                      <div className="flex flex-col gap-0.5">
                        <span>
                          {formatMoney(item.totalGross, item.currencyCode ?? currencyCode ?? undefined)}{' '}
                          <span className="text-xs font-normal text-muted-foreground">
                            {t('sales.documents.items.table.gross', 'gross')}
                          </span>
                        </span>
                        <span className="text-xs font-medium text-muted-foreground">
                          {formatMoney(item.totalNet, item.currencyCode ?? currencyCode ?? undefined)} {t('sales.documents.items.table.net', 'net')}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleEdit(item)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleDelete(item)
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <LineItemDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next)
          if (!next) setLineForEdit(null)
        }}
        kind={kind}
        documentId={documentId}
        currencyCode={currencyCode}
        organizationId={resolvedOrganizationId}
        tenantId={resolvedTenantId}
        initialLine={lineForEdit}
        onSaved={async () => {
          await loadItems()
          emitSalesDocumentTotalsRefresh({ documentId, kind })
        }}
      />
    </div>
  )
}
