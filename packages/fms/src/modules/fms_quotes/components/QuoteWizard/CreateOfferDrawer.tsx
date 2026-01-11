'use client'

import * as React from 'react'
import { useState, useCallback, useMemo } from 'react'
import { X, Check } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { QuoteLine } from './hooks/useCalculations'

type CreateOfferDrawerProps = {
  open: boolean
  onClose: () => void
  quoteId: string
  quoteNumber?: string | null
  lines: QuoteLine[]
  currency: string
  onSuccess?: () => void
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

const PAYMENT_TERMS_OPTIONS = [
  'Net 7 days',
  'Net 14 days',
  'Net 30 days',
  'Net 45 days',
  'Net 60 days',
  'Due on receipt',
  'Prepaid',
]

export function CreateOfferDrawer({
  open,
  onClose,
  quoteId,
  quoteNumber,
  lines,
  currency,
  onSuccess,
}: CreateOfferDrawerProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set(lines.map(l => l.id)))
  const [validUntil, setValidUntil] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() + 14)
    return formatDate(date)
  })
  const [paymentTerms, setPaymentTerms] = useState('Net 30 days')
  const [specialTerms, setSpecialTerms] = useState('')
  const [customerNotes, setCustomerNotes] = useState('')

  React.useEffect(() => {
    if (open) {
      setSelectedLineIds(new Set(lines.map(l => l.id)))
      const date = new Date()
      date.setDate(date.getDate() + 14)
      setValidUntil(formatDate(date))
      setPaymentTerms('Net 30 days')
      setSpecialTerms('')
      setCustomerNotes('')
    }
  }, [open, lines])

  const toggleLine = useCallback((lineId: string) => {
    setSelectedLineIds(prev => {
      const next = new Set(prev)
      if (next.has(lineId)) {
        next.delete(lineId)
      } else {
        next.add(lineId)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (selectedLineIds.size === lines.length) {
      setSelectedLineIds(new Set())
    } else {
      setSelectedLineIds(new Set(lines.map(l => l.id)))
    }
  }, [selectedLineIds.size, lines])

  const selectedTotal = useMemo(() => {
    return lines
      .filter(l => selectedLineIds.has(l.id))
      .reduce((sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitSales) || 0), 0)
  }, [lines, selectedLineIds])

  const handleSubmit = useCallback(async () => {
    if (selectedLineIds.size === 0) {
      flash('Please select at least one line', 'error')
      return
    }

    if (!validUntil) {
      flash('Valid until date is required', 'error')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await apiCall<{ id: string; offerNumber: string }>('/api/fms_quotes/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId,
          lineIds: Array.from(selectedLineIds),
          validUntil: new Date(validUntil).toISOString(),
          paymentTerms: paymentTerms || null,
          specialTerms: specialTerms.trim() || null,
          customerNotes: customerNotes.trim() || null,
        }),
      })

      if (response.ok && response.result) {
        flash(`Offer ${response.result.offerNumber} created`, 'success')
        onClose()
        onSuccess?.()
      } else {
        flash('Failed to create offer', 'error')
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : 'An error occurred', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [quoteId, selectedLineIds, validUntil, paymentTerms, specialTerms, customerNotes, onClose, onSuccess])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSubmit()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    },
    [handleSubmit, onClose]
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-y-0 right-0 w-[500px] bg-background border-l shadow-xl z-50 flex flex-col"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h2 className="text-lg font-semibold">Create Offer</h2>
          {quoteNumber && (
            <p className="text-sm text-muted-foreground">From Quote: {quoteNumber}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Line selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-medium">Select Lines to Include</Label>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={toggleAll}
            >
              {selectedLineIds.size === lines.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="w-8 px-2 py-2"></th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">#</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">Charge</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">Product</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-2 py-2 text-right font-medium text-muted-foreground">Qty</th>
                  <th className="px-2 py-2 text-right font-medium text-muted-foreground">Sales</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const isSelected = selectedLineIds.has(line.id)
                  const lineTotal = (parseFloat(line.quantity) || 0) * (parseFloat(line.unitSales) || 0)
                  return (
                    <tr
                      key={line.id}
                      className={`border-t cursor-pointer hover:bg-muted/30 ${isSelected ? 'bg-primary/5' : ''}`}
                      onClick={() => toggleLine(line.id)}
                    >
                      <td className="px-2 py-2">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-input'}`}>
                          {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
                      <td className="px-2 py-2 font-mono text-xs">{line.chargeCode || '-'}</td>
                      <td className="px-2 py-2 max-w-[150px] truncate" title={line.productName}>
                        {line.productName}
                      </td>
                      <td className="px-2 py-2">{line.containerSize || '-'}</td>
                      <td className="px-2 py-2 text-right">{line.quantity}</td>
                      <td className="px-2 py-2 text-right font-medium">
                        {formatCurrency(lineTotal, line.currencyCode || currency)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-2 text-sm">
            <span className="text-muted-foreground">
              {selectedLineIds.size} of {lines.length} selected
            </span>
            <span className="font-medium">
              Total: {formatCurrency(selectedTotal, currency)}
            </span>
          </div>
        </div>

        {/* Offer details */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium border-b pb-2">Offer Details</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="validUntil">Valid Until *</Label>
              <Input
                id="validUntil"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Default: 14 days from today</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paymentTerms">Payment Terms</Label>
              <select
                id="paymentTerms"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                {PAYMENT_TERMS_OPTIONS.map((term) => (
                  <option key={term} value={term}>{term}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="specialTerms">Special Terms</Label>
            <Input
              id="specialTerms"
              placeholder="e.g., FOB Shanghai, subject to space availability"
              value={specialTerms}
              onChange={(e) => setSpecialTerms(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customerNotes">Notes to Customer</Label>
            <textarea
              id="customerNotes"
              placeholder="Any additional notes for the customer..."
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              className="w-full h-24 px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t bg-muted/30">
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting || selectedLineIds.size === 0}>
          {isSubmitting ? 'Creating...' : 'Create Offer'}
        </Button>
      </div>
    </div>
  )
}
