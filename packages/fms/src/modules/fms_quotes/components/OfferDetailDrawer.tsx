'use client'

import * as React from 'react'
import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, ChevronRight, Send, Check, XCircle, Copy, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { FmsOfferStatus } from '../data/types'

type OfferLine = {
  id: string
  lineNumber: number
  productName?: string | null
  chargeCode?: string | null
  containerSize?: string | null
  quantity: string
  unitPrice: string
  amount: string
  currencyCode: string
}

type Offer = {
  id: string
  offerNumber: string
  version: number
  status: FmsOfferStatus
  validUntil?: string | null
  paymentTerms?: string | null
  specialTerms?: string | null
  customerNotes?: string | null
  currencyCode: string
  totalAmount: string
  supersededById?: string | null
  createdAt: string
  updatedAt: string
  quote?: {
    id: string
    quoteNumber?: string | null
    clientName?: string | null
    originPortCode?: string | null
    destinationPortCode?: string | null
  }
  lines?: OfferLine[]
}

type OfferDetailDrawerProps = {
  offerId: string | null
  open: boolean
  onClose: () => void
  onDelete?: () => void
  onCreateNewVersion?: (newOfferId: string) => void
}

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    sent: 'bg-blue-100 text-blue-800',
    accepted: 'bg-green-100 text-green-800',
    declined: 'bg-red-100 text-red-800',
    expired: 'bg-orange-100 text-orange-800',
    superseded: 'bg-purple-100 text-purple-600',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isExpired(dateString: string | null | undefined): boolean {
  if (!dateString) return false
  return new Date(dateString) < new Date()
}

export function OfferDetailDrawer({
  offerId,
  open,
  onClose,
  onDelete,
  onCreateNewVersion,
}: OfferDetailDrawerProps) {
  const queryClient = useQueryClient()
  const [isUpdating, setIsUpdating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showStatusDialog, setShowStatusDialog] = useState<{
    status: FmsOfferStatus
    title: string
    description: string
  } | null>(null)

  const { data: offer, isLoading, refetch } = useQuery({
    queryKey: ['fms_offer', offerId],
    queryFn: async () => {
      if (!offerId) return null
      const response = await apiCall<Offer>(`/api/fms_quotes/offers/${offerId}`)
      if (!response.ok) throw new Error('Failed to load offer')
      return response.result
    },
    enabled: !!offerId && open,
  })

  const handleStatusChange = useCallback(async (newStatus: FmsOfferStatus) => {
    if (!offer) return

    setIsUpdating(true)
    try {
      const response = await apiCall<Offer>(`/api/fms_quotes/offers/${offer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      if (response.ok) {
        flash(`Offer marked as ${newStatus}`, 'success')
        refetch()
        queryClient.invalidateQueries({ queryKey: ['fms_offers'] })
        setShowStatusDialog(null)
      } else {
        flash('Failed to update offer', 'error')
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : 'An error occurred', 'error')
    } finally {
      setIsUpdating(false)
    }
  }, [offer, refetch, queryClient])

  const handleDelete = useCallback(async () => {
    if (!offer) return

    setIsDeleting(true)
    try {
      const response = await apiCall(`/api/fms_quotes/offers/${offer.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        flash('Offer deleted', 'success')
        queryClient.invalidateQueries({ queryKey: ['fms_offers'] })
        setShowDeleteDialog(false)
        onDelete?.()
        onClose()
      } else {
        flash('Failed to delete offer', 'error')
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : 'An error occurred', 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [offer, queryClient, onDelete, onClose])

  const handleCreateNewVersion = useCallback(async () => {
    if (!offer) return

    setIsUpdating(true)
    try {
      const response = await apiCall<{ id: string; offerNumber: string }>('/api/fms_quotes/offers/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: offer.id }),
      })

      if (response.ok && response.result) {
        flash(`New version ${response.result.offerNumber} created`, 'success')
        queryClient.invalidateQueries({ queryKey: ['fms_offers'] })
        onCreateNewVersion?.(response.result.id)
      } else {
        flash('Failed to create new version', 'error')
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : 'An error occurred', 'error')
    } finally {
      setIsUpdating(false)
    }
  }, [offer, queryClient, onCreateNewVersion])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    },
    [onClose]
  )

  if (!open) return null

  const lines = offer?.lines || []
  const total = parseFloat(offer?.totalAmount || '0')
  const expired = offer ? isExpired(offer.validUntil) : false
  const isSuperseded = offer?.status === 'superseded'

  return (
    <>
      <div
        className="fixed inset-y-0 right-0 w-[500px] bg-background border-l shadow-xl z-50 flex flex-col"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-3">
            {isLoading ? (
              <Spinner className="h-5 w-5" />
            ) : (
              <>
                <div>
                  <h2 className="text-lg font-semibold">
                    {offer?.offerNumber || 'Loading...'}
                    <span className="ml-2 text-sm text-muted-foreground font-normal">
                      v{offer?.version || 1}
                    </span>
                  </h2>
                  {offer?.createdAt && (
                    <p className="text-xs text-muted-foreground">
                      Created: {formatDate(offer.createdAt)}
                    </p>
                  )}
                </div>
                {offer && (
                  <span
                    className={`px-2 py-0.5 text-xs leading-4 font-semibold rounded-full ${getStatusColor(offer.status)}`}
                  >
                    {offer.status.toUpperCase()}
                  </span>
                )}
              </>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner className="h-8 w-8" />
          </div>
        ) : offer ? (
          <div className="flex-1 overflow-auto p-4 space-y-6">
            {/* Summary */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium border-b pb-2">Summary</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Quote:</span>{' '}
                  <span className="font-medium">
                    {offer.quote?.quoteNumber || `#${offer.quote?.id?.slice(0, 8) || '...'}`}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Client:</span>{' '}
                  <span className="font-medium">{offer.quote?.clientName || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Route:</span>{' '}
                  <span className="font-medium flex items-center gap-1 inline-flex">
                    {offer.quote?.originPortCode || '-'}
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    {offer.quote?.destinationPortCode || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Valid Until:</span>{' '}
                  <span className={`font-medium ${expired ? 'text-red-600' : ''}`}>
                    {offer.validUntil ? formatDate(offer.validUntil) : '-'}
                    {expired && ' (Expired)'}
                  </span>
                </div>
              </div>

              {offer.paymentTerms && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Payment Terms:</span>{' '}
                  <span className="font-medium">{offer.paymentTerms}</span>
                </div>
              )}
            </div>

            {/* Lines */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium border-b pb-2">Lines ({lines.length})</h3>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">#</th>
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">Charge</th>
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">Product</th>
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">Type</th>
                      <th className="px-2 py-2 text-right font-medium text-muted-foreground">Qty</th>
                      <th className="px-2 py-2 text-right font-medium text-muted-foreground">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => {
                      const amount = parseFloat(line.amount) || 0
                      return (
                        <tr key={line.id} className="border-t">
                          <td className="px-2 py-2 text-muted-foreground">{line.lineNumber}</td>
                          <td className="px-2 py-2 font-mono text-xs">{line.chargeCode || '-'}</td>
                          <td className="px-2 py-2 max-w-[150px] truncate" title={line.productName || ''}>
                            {line.productName || '-'}
                          </td>
                          <td className="px-2 py-2">{line.containerSize || '-'}</td>
                          <td className="px-2 py-2 text-right">{line.quantity}</td>
                          <td className="px-2 py-2 text-right font-medium">
                            {formatCurrency(amount, line.currencyCode || offer.currencyCode)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="bg-muted/30">
                    <tr className="border-t">
                      <td colSpan={5} className="px-2 py-2 text-right font-medium">
                        Total:
                      </td>
                      <td className="px-2 py-2 text-right font-bold">
                        {formatCurrency(total, offer.currencyCode)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Terms and Notes */}
            {(offer.specialTerms || offer.customerNotes) && (
              <div className="space-y-3">
                {offer.specialTerms && (
                  <div className="text-sm">
                    <span className="text-muted-foreground block mb-1">Special Terms:</span>
                    <p className="bg-muted/30 rounded p-2">{offer.specialTerms}</p>
                  </div>
                )}
                {offer.customerNotes && (
                  <div className="text-sm">
                    <span className="text-muted-foreground block mb-1">Notes to Customer:</span>
                    <p className="bg-muted/30 rounded p-2">{offer.customerNotes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Superseded warning */}
            {isSuperseded && offer.supersededById && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
                This offer has been superseded by a newer version.
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Offer not found
          </div>
        )}

        {/* Actions footer */}
        {offer && !isLoading && (
          <div className="px-4 py-3 border-t bg-muted/30 space-y-2">
            {offer.status === 'draft' && (
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setShowStatusDialog({
                    status: 'sent',
                    title: 'Mark as Sent',
                    description: 'Mark this offer as sent to the customer. This action cannot be undone.',
                  })}
                  disabled={isUpdating}
                  className="flex-1"
                >
                  <Send className="h-4 w-4 mr-1" />
                  Mark as Sent
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={isUpdating}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}

            {offer.status === 'sent' && (
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  onClick={() => setShowStatusDialog({
                    status: 'accepted',
                    title: 'Mark as Accepted',
                    description: 'The customer has accepted this offer.',
                  })}
                  disabled={isUpdating}
                  className="flex-1"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Accepted
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowStatusDialog({
                    status: 'declined',
                    title: 'Mark as Declined',
                    description: 'The customer has declined this offer.',
                  })}
                  disabled={isUpdating}
                  className="flex-1"
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Declined
                </Button>
              </div>
            )}

            {(offer.status === 'sent' || offer.status === 'accepted' || offer.status === 'declined' || offer.status === 'expired') && (
              <Button
                variant="outline"
                onClick={handleCreateNewVersion}
                disabled={isUpdating}
                className="w-full"
              >
                <Copy className="h-4 w-4 mr-1" />
                Create New Version
              </Button>
            )}

            {offer.status === 'superseded' && (
              <p className="text-sm text-center text-muted-foreground">
                This offer has been superseded. No actions available.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Status change confirmation dialog */}
      <Dialog open={!!showStatusDialog} onOpenChange={(open) => !open && setShowStatusDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{showStatusDialog?.title}</DialogTitle>
            <DialogDescription>{showStatusDialog?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowStatusDialog(null)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              onClick={() => showStatusDialog && handleStatusChange(showStatusDialog.status)}
              disabled={isUpdating}
            >
              {isUpdating ? 'Updating...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Offer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete offer &quot;{offer?.offerNumber}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
