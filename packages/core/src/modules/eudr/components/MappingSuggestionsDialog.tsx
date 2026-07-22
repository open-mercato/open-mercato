"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  EUDR_COMMODITIES,
  type EudrCommodity,
} from '../data/validators'

type MappingSuggestion = {
  productId: string
  name: string
  sku: string | null
  hsCode: string
  suggestedCommodity: EudrCommodity
}

type SuggestionsResponse = {
  items: MappingSuggestion[]
}

type ApplyResponse = {
  created: number
  failed: Array<{ productId: string; errorKey: string }>
}

type ApplyItem = {
  productId: string
  commodity: EudrCommodity
  hsCode: string
}

type MappingSuggestionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied?: () => void
}

const commoditySet = new Set<string>(EUDR_COMMODITIES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isEudrCommodity(value: unknown): value is EudrCommodity {
  return typeof value === 'string' && commoditySet.has(value)
}

function normalizeSuggestion(value: unknown): MappingSuggestion | null {
  if (!isRecord(value)) return null
  const { productId, name, sku, hsCode, suggestedCommodity } = value
  if (
    typeof productId !== 'string'
    || typeof name !== 'string'
    || typeof hsCode !== 'string'
    || !isEudrCommodity(suggestedCommodity)
  ) {
    return null
  }
  return {
    productId,
    name,
    sku: typeof sku === 'string' ? sku : null,
    hsCode,
    suggestedCommodity,
  }
}

function normalizeSuggestionsResponse(value: SuggestionsResponse | null): MappingSuggestion[] {
  const rawItems = Array.isArray((value as { items?: unknown[] } | null)?.items)
    ? (value as { items: unknown[] }).items
    : []
  return rawItems
    .map(normalizeSuggestion)
    .filter((item): item is MappingSuggestion => item !== null)
}

function formatProductLabel(item: MappingSuggestion): string {
  return item.sku ? `${item.name} (${item.sku})` : item.name
}

export function MappingSuggestionsDialog({
  open,
  onOpenChange,
  onApplied,
}: MappingSuggestionsDialogProps) {
  const t = useT()
  const [items, setItems] = React.useState<MappingSuggestion[]>([])
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [applying, setApplying] = React.useState(false)
  const [failures, setFailures] = React.useState<ApplyResponse['failed']>([])
  const appliedDuringSessionRef = React.useRef(false)
  const mutationContextId = 'eudr-product-mapping-suggestions:apply'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked'),
  })

  const closeDialog = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen && appliedDuringSessionRef.current) {
      onApplied?.()
      appliedDuringSessionRef.current = false
    }
    onOpenChange(nextOpen)
  }, [onApplied, onOpenChange])

  React.useEffect(() => {
    if (!open) return
    appliedDuringSessionRef.current = false
    setFailures([])
    setSelectedIds(new Set<string>())

    let cancelled = false
    async function loadSuggestions() {
      setLoading(true)
      setError(null)
      try {
        const fallback: SuggestionsResponse = { items: [] }
        const call = await apiCall<SuggestionsResponse>(
          '/api/eudr/product-mappings/suggestions',
          undefined,
          { fallback },
        )
        if (!call.ok) {
          setError(t('eudr.suggestions.loadError'))
          return
        }
        const nextItems = normalizeSuggestionsResponse(call.result ?? fallback)
        if (cancelled) return
        setItems(nextItems)
        setSelectedIds(new Set(nextItems.map((item) => item.productId)))
      } catch {
        if (!cancelled) setError(t('eudr.suggestions.loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSuggestions()
    return () => {
      cancelled = true
    }
  }, [open, t])

  const selectedItems = React.useMemo(() => {
    return items.filter((item) => selectedIds.has(item.productId))
  }, [items, selectedIds])

  const selectedCount = selectedItems.length
  const allSelected = items.length > 0 && selectedCount === items.length
  const partiallySelected = selectedCount > 0 && selectedCount < items.length
  const canApply = selectedCount > 0 && !applying && !loading

  const toggleAll = React.useCallback((checked: boolean | 'indeterminate') => {
    if (checked) {
      setSelectedIds(new Set(items.map((item) => item.productId)))
    } else {
      setSelectedIds(new Set<string>())
    }
  }, [items])

  const toggleOne = React.useCallback((productId: string, checked: boolean | 'indeterminate') => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(productId)
      else next.delete(productId)
      return next
    })
  }, [])

  const columns = React.useMemo<ColumnDef<MappingSuggestion>[]>(() => [
    {
      id: 'select',
      header: () => (
        <Checkbox
          aria-label={t('eudr.suggestions.selectAll')}
          checked={allSelected ? true : partiallySelected ? 'indeterminate' : false}
          onCheckedChange={toggleAll}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={t('eudr.suggestions.selectRow', { product: formatProductLabel(row.original) })}
          checked={selectedIds.has(row.original.productId)}
          onCheckedChange={(checked) => toggleOne(row.original.productId, checked)}
        />
      ),
      enableSorting: false,
      size: 48,
    },
    {
      accessorKey: 'name',
      header: t('eudr.suggestions.columns.product'),
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.name}</p>
          {row.original.sku ? (
            <p className="truncate text-xs text-muted-foreground">{row.original.sku}</p>
          ) : null}
        </div>
      ),
      meta: { maxWidth: '260px', truncate: true },
    },
    {
      accessorKey: 'hsCode',
      header: t('eudr.suggestions.columns.hsCode'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.hsCode}</span>,
    },
    {
      accessorKey: 'suggestedCommodity',
      header: t('eudr.suggestions.columns.suggestedCommodity'),
      cell: ({ row }) => (
        <Tag variant="success">
          {t(`eudr.commodity.${row.original.suggestedCommodity}`)}
        </Tag>
      ),
    },
  ], [allSelected, partiallySelected, selectedIds, t, toggleAll, toggleOne])

  const handleApply = React.useCallback(async () => {
    if (!canApply) return
    setApplying(true)
    setFailures([])
    try {
      const payloadItems: ApplyItem[] = selectedItems.map((item) => ({
        productId: item.productId,
        commodity: item.suggestedCommodity,
        hsCode: item.hsCode,
      }))
      const call = await runMutation({
        operation: () => apiCallOrThrow<ApplyResponse>(
          '/api/eudr/product-mappings/suggestions/apply',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: payloadItems }),
          },
          { errorMessage: t('eudr.suggestions.applyError') },
        ),
        context: {
          formId: mutationContextId,
          resourceKind: 'eudr.product_mapping',
          resourceId: 'bulk-suggestions',
          retryLastMutation,
        },
        mutationPayload: { items: payloadItems },
      })
      const result = call.result ?? { created: 0, failed: [] }
      appliedDuringSessionRef.current = true
      flash(t('eudr.suggestions.applySuccess', { count: result.created }), result.created > 0 ? 'success' : 'warning')
      setFailures(Array.isArray(result.failed) ? result.failed : [])
      if (!result.failed.length) {
        closeDialog(false)
      } else {
        setSelectedIds(new Set(result.failed.map((failure) => failure.productId)))
      }
    } catch {
      flash(t('eudr.suggestions.applyError'), 'error')
    } finally {
      setApplying(false)
    }
  }, [canApply, closeDialog, mutationContextId, retryLastMutation, runMutation, selectedItems, t])

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent
        size="xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeDialog(false)
            return
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void handleApply()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('eudr.suggestions.title')}</DialogTitle>
        </DialogHeader>

        <div className="min-h-64">
          {error ? (
            <ErrorMessage label={error} />
          ) : loading ? (
            <LoadingMessage label={t('eudr.suggestions.loading')} />
          ) : items.length === 0 ? (
            <EmptyState
              size="sm"
              variant="subtle"
              title={t('eudr.suggestions.empty')}
            />
          ) : (
            <div className="space-y-3">
              <DataTable<MappingSuggestion>
                title={t('eudr.suggestions.tableTitle')}
                columns={columns}
                data={items}
                emptyState={(
                  <EmptyState
                    size="sm"
                    variant="subtle"
                    title={t('eudr.suggestions.empty')}
                  />
                )}
                perspective={{ tableId: 'eudr.product_mapping_suggestions.dialog' }}
                disableRowClick
              />
              {failures.length > 0 ? (
                <div className="rounded-md border border-status-error-border bg-status-error-bg p-3 text-sm text-status-error-text">
                  <p className="font-medium">{t('eudr.suggestions.failuresTitle')}</p>
                  <ul className="mt-2 space-y-1">
                    {failures.map((failure) => {
                      const item = items.find((candidate) => candidate.productId === failure.productId)
                      return (
                        <li key={failure.productId}>
                          <span className="font-medium">
                            {item ? formatProductLabel(item) : t('eudr.common.recordUnavailable')}
                          </span>
                          {': '}
                          <span>{t(failure.errorKey)}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto text-sm text-muted-foreground">
            {t('eudr.suggestions.selectedCount', { count: selectedCount })}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => closeDialog(false)}
          >
            {t('eudr.suggestions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleApply()}
            disabled={!canApply}
          >
            {applying ? t('eudr.suggestions.applying') : t('eudr.suggestions.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default MappingSuggestionsDialog
