"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@/lib/frontend/useOrganizationScope'
import { LineItemDialog } from './LineItemDialog'
import type { SalesLineRecord } from './lineItemTypes'
import { formatMoney, normalizeNumber } from './lineItemUtils'

type SalesDocumentItemsSectionProps = {
  documentId: string
  kind: 'order' | 'quote'
  currencyCode: string | null | undefined
  organizationId?: string | null
  tenantId?: string | null
}

export function SalesDocumentItemsSection({
  documentId,
  kind,
  currencyCode,
  organizationId: orgFromProps,
  tenantId: tenantFromProps,
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
            const customFields = normalizeCustomFieldResponse(item as Record<string, unknown>) ?? null
            const name =
              typeof item.name === 'string'
                ? item.name
                : typeof item.catalog_snapshot === 'object' &&
                    item.catalog_snapshot &&
                    typeof (item.catalog_snapshot as any).name === 'string'
                  ? (item.catalog_snapshot as any).name
                  : null
            return {
              id,
              name,
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

  const handleEdit = React.useCallback((line: SalesLineRecord) => {
    setLineForEdit(line)
    setDialogOpen(true)
  }, [])

  const handleDelete = React.useCallback(
    async (line: SalesLineRecord) => {
      try {
        await deleteCrud(resourcePath, {
          body: {
            id: line.id,
            [documentKey]: documentId,
            organizationId: resolvedOrganizationId ?? undefined,
            tenantId: resolvedTenantId ?? undefined,
          },
          errorMessage: t('sales.documents.items.errorDelete', 'Failed to delete line.'),
        })
        await loadItems()
      } catch (err) {
        console.error('sales.document.items.delete', err)
      }
    },
    [documentId, documentKey, loadItems, resolvedOrganizationId, resourcePath, t, resolvedTenantId],
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

  const showHeader = !loading && !error && items.length > 0

  return (
    <div className="space-y-4">
      {showHeader ? (
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
      ) : null}
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
        onSaved={loadItems}
      />
    </div>
  )
}
