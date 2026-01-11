'use client'

import * as React from 'react'
import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, Eye, ChevronRight } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import {
  DynamicTable,
  TableSkeleton,
  TableEvents,
  dispatch,
  useEventHandlers,
} from '@open-mercato/ui/backend/dynamic-table'
import type {
  CellEditSaveEvent,
  CellSaveStartEvent,
  CellSaveSuccessEvent,
  CellSaveErrorEvent,
  ColumnDef,
} from '@open-mercato/ui/backend/dynamic-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { OfferDetailDrawer } from '../../../components/OfferDetailDrawer'
import type { FmsOfferStatus } from '../../../data/types'

interface FmsOfferRow {
  id: string
  offerNumber: string
  version: number
  status: FmsOfferStatus
  quoteId?: string
  quoteNumber?: string | null
  clientName?: string | null
  originPortCode?: string | null
  destinationPortCode?: string | null
  validUntil?: string | null
  currencyCode: string
  totalAmount: string
  paymentTerms?: string | null
  createdAt: string
  quote?: {
    id: string
    quoteNumber?: string | null
    clientName?: string | null
    originPortCode?: string | null
    destinationPortCode?: string | null
  }
}

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    sent: 'bg-blue-100 text-blue-800',
    accepted: 'bg-green-100 text-green-800',
    declined: 'bg-red-100 text-red-800',
    expired: 'bg-orange-100 text-orange-800',
    superseded: 'bg-purple-100 text-purple-600 italic',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

const StatusRenderer = ({ value }: { value: string }) => {
  if (!value) return <span>-</span>
  return (
    <span
      className={`px-2 py-0.5 inline-flex text-xs leading-4 font-semibold rounded-full ${getStatusColor(value)}`}
    >
      {value.toUpperCase()}
    </span>
  )
}

const VersionRenderer = ({ value }: { value: number }) => {
  return <span className="text-xs text-muted-foreground">v{value}</span>
}

const RouteRenderer = ({ value, rowData }: { value: string; rowData: FmsOfferRow }) => {
  const origin = rowData.quote?.originPortCode || '-'
  const dest = rowData.quote?.destinationPortCode || '-'
  if (origin === '-' && dest === '-') return <span>-</span>
  return (
    <span className="flex items-center gap-1 text-sm">
      <span>{origin}</span>
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
      <span>{dest}</span>
    </span>
  )
}

const AmountRenderer = ({ value, rowData }: { value: string; rowData: FmsOfferRow }) => {
  const amount = parseFloat(value) || 0
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: rowData.currencyCode || 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
  return <span className="font-medium">{formatted}</span>
}

const DateRenderer = ({ value }: { value: string }) => {
  if (!value) return <span>-</span>
  const date = new Date(value)
  const now = new Date()
  const isExpired = date < now
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <span className={isExpired ? 'text-red-600' : ''}>{formatted}</span>
  )
}

export default function OffersListPage() {
  const tableRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null)
  const [offerToDelete, setOfferToDelete] = useState<FmsOfferRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', String(limit))
    return params.toString()
  }, [page, limit])

  const { data, isLoading } = useQuery({
    queryKey: ['fms_offers', queryParams],
    queryFn: async () => {
      const call = await apiCall<{ items: FmsOfferRow[]; total: number; totalPages?: number }>(
        `/api/fms_quotes/offers?${queryParams}`
      )
      if (!call.ok) throw new Error('Failed to load offers')
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const tableData = useMemo(() => {
    return (data?.items ?? []).map((offer) => ({
      id: offer.id,
      offerNumber: offer.offerNumber,
      version: offer.version,
      status: offer.status,
      quoteNumber: offer.quote?.quoteNumber || `#${offer.quote?.id?.slice(0, 8) || '...'}`,
      clientName: offer.quote?.clientName || '-',
      route: '', // Computed in renderer
      totalAmount: offer.totalAmount,
      currencyCode: offer.currencyCode,
      validUntil: offer.validUntil,
      paymentTerms: offer.paymentTerms || '-',
      createdAt: offer.createdAt,
      quote: offer.quote,
    }))
  }, [data?.items])

  const handleOfferClick = useCallback((offerId: string) => {
    setSelectedOfferId(offerId)
  }, [])

  const columns = useMemo((): ColumnDef[] => [
    {
      data: 'offerNumber',
      title: 'Offer',
      width: 110,
      type: 'text',
      readOnly: true,
      renderer: (value: string, rowData: FmsOfferRow) => (
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleOfferClick(rowData.id)
          }}
          className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
        >
          {value}
        </button>
      ),
    },
    {
      data: 'version',
      title: 'Ver',
      width: 50,
      type: 'numeric',
      readOnly: true,
      renderer: (value) => <VersionRenderer value={value} />,
    },
    {
      data: 'quoteNumber',
      title: 'Quote',
      width: 100,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'clientName',
      title: 'Client',
      width: 140,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'route',
      title: 'Route',
      width: 110,
      type: 'text',
      readOnly: true,
      renderer: (value, rowData) => <RouteRenderer value={value} rowData={rowData} />,
    },
    {
      data: 'totalAmount',
      title: 'Total',
      width: 100,
      type: 'numeric',
      readOnly: true,
      renderer: (value, rowData) => <AmountRenderer value={value} rowData={rowData} />,
    },
    {
      data: 'validUntil',
      title: 'Valid Until',
      width: 90,
      type: 'date',
      readOnly: true,
      renderer: (value) => <DateRenderer value={value} />,
    },
    {
      data: 'status',
      title: 'Status',
      width: 100,
      type: 'text',
      readOnly: true,
      renderer: (value) => <StatusRenderer value={value} />,
    },
    {
      data: 'createdAt',
      title: 'Created',
      width: 90,
      type: 'date',
      readOnly: true,
      renderer: (value) => <DateRenderer value={value} />,
    },
  ], [handleOfferClick])

  const handleConfirmDelete = useCallback(async () => {
    if (!offerToDelete) return

    setIsDeleting(true)
    try {
      const response = await apiCall<{ error?: string }>(`/api/fms_quotes/offers/${offerToDelete.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        flash('Offer deleted', 'success')
        queryClient.invalidateQueries({ queryKey: ['fms_offers'] })
        setOfferToDelete(null)
      } else {
        flash(response.result?.error || 'Failed to delete offer', 'error')
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to delete offer', 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [offerToDelete, queryClient])

  const actionsRenderer = useCallback((rowData: FmsOfferRow, _rowIndex: number) => {
    if (!rowData.id) return null
    const canDelete = rowData.status === 'draft'
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setSelectedOfferId(rowData.id)
          }}
          className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
          title="View"
        >
          <Eye className="h-4 w-4" />
        </button>
        {canDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setOfferToDelete(rowData)
            }}
            className="p-1 text-gray-400 hover:text-red-600 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }, [])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_START, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
        } as CellSaveStartEvent)

        try {
          const response = await apiCall<{ error?: string }>(`/api/fms_quotes/offers/${payload.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [payload.prop]: payload.newValue }),
          })

          if (response.ok) {
            flash('Offer updated', 'success')
            dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_SUCCESS, {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
            } as CellSaveSuccessEvent)
          } else {
            const error = response.result?.error || 'Update failed'
            flash(error, 'error')
            dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
              error,
            } as CellSaveErrorEvent)
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            colIndex: payload.colIndex,
            error: errorMessage,
          } as CellSaveErrorEvent)
        }
      },
    },
    tableRef as React.RefObject<HTMLElement>
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <TableSkeleton rows={10} columns={9} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <DynamicTable
          tableRef={tableRef}
          data={tableData}
          columns={columns}
          tableName="Freight Offers"
          idColumnName="id"
          height="calc(100vh - 110px)"
          colHeaders={true}
          rowHeaders={true}
          stretchColumns={true}
          actionsRenderer={actionsRenderer}
          uiConfig={{
            hideAddRowButton: true,
            enableFullscreen: true,
          }}
          pagination={{
            currentPage: page,
            totalPages: Math.ceil((data?.total || 0) / limit),
            limit,
            limitOptions: [25, 50, 100],
            onPageChange: setPage,
            onLimitChange: (l) => {
              setLimit(l)
              setPage(1)
            },
          }}
        />

        {/* Delete confirmation dialog */}
        <Dialog open={!!offerToDelete} onOpenChange={(open) => !open && setOfferToDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Offer</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete offer &quot;{offerToDelete?.offerNumber}&quot;? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOfferToDelete(null)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Offer detail drawer */}
        <OfferDetailDrawer
          offerId={selectedOfferId}
          open={!!selectedOfferId}
          onClose={() => setSelectedOfferId(null)}
          onDelete={() => {
            queryClient.invalidateQueries({ queryKey: ['fms_offers'] })
          }}
          onCreateNewVersion={(newOfferId) => {
            queryClient.invalidateQueries({ queryKey: ['fms_offers'] })
            setSelectedOfferId(newOfferId)
          }}
        />
      </PageBody>
    </Page>
  )
}
