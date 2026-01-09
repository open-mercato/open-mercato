'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, Package, Ship, StickyNote, Plus } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { CollapsibleSection } from '../../../components/CollapsibleSection'
import { QuoteDetailsTable } from '../../../components/QuoteDetailsTable'
import { QuoteOffersSection } from '../../../components/QuoteOffersSection'
import { OfferDialog } from '../../../components/OfferDialog'
import { type FmsQuoteStatus } from '../../../data/types'

type QuoteDetailPageProps = {
  params?: { id?: string }
}

type QuoteDetail = {
  id: string
  quoteNumber?: string | null
  clientName?: string | null
  containerCount?: number | null
  status: FmsQuoteStatus
  direction?: string | null
  incoterm?: string | null
  cargoType?: string | null
  originPortCode?: string | null
  destinationPortCode?: string | null
  validUntil?: string | null
  currencyCode: string
  notes?: string | null
  createdAt: string
  updatedAt: string
}

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    ready: 'bg-blue-100 text-blue-800',
    offered: 'bg-indigo-100 text-indigo-800',
    won: 'bg-green-100 text-green-800',
    lost: 'bg-red-100 text-red-800',
    expired: 'bg-yellow-100 text-yellow-800',
    archived: 'bg-gray-200 text-gray-600',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

export default function QuoteDetailPage({ params: propsParams }: QuoteDetailPageProps) {
  const routerParams = useParams<{ id?: string; slug?: string[] }>()
  const router = useRouter()
  const queryClient = useQueryClient()

  // Get quoteId from props params (passed by catch-all route) or fallback to useParams slug
  const quoteId = propsParams?.id
    ?? routerParams?.id
    ?? (Array.isArray(routerParams?.slug) ? routerParams.slug[routerParams.slug.length - 1] : undefined)

  const [isOfferDialogOpen, setIsOfferDialogOpen] = React.useState(false)

  const { data: quote, isLoading, error } = useQuery({
    queryKey: ['fms_quote', quoteId],
    queryFn: async () => {
      if (!quoteId) throw new Error('Quote ID is required')
      const response = await apiCall<QuoteDetail>(`/api/fms_quotes/${quoteId}`)
      if (!response.ok) throw new Error('Failed to load quote')
      return response.result
    },
    enabled: !!quoteId,
  })

  const handleFieldSave = React.useCallback(
    async (field: string, value: unknown) => {
      if (!quoteId) return

      try {
        const response = await apiCall(`/api/fms_quotes/${quoteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        })

        if (response.ok) {
          flash('Quote updated', 'success')
          queryClient.invalidateQueries({ queryKey: ['fms_quote', quoteId] })
        } else {
          flash('Failed to update quote', 'error')
        }
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Update failed', 'error')
      }
    },
    [quoteId, queryClient]
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>Loading quote...</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !quote) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <p>{error instanceof Error ? error.message : 'Quote not found'}</p>
            <Button variant="outline" onClick={() => router.push('/backend/fms-quotes')}>
              Back to Quotes
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const displayTitle = quote.quoteNumber || `Quote ${quote.id.slice(0, 8)}...`
  const routeDisplay = [quote.originPortCode, quote.destinationPortCode].filter(Boolean).join(' → ') || 'No route set'

  return (
    <Page>
      <PageBody className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/backend/fms-quotes')}
              className="p-2 hover:bg-gray-100 rounded"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div className="bg-blue-500 rounded p-2">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{displayTitle}</h1>
              <p className="text-sm text-gray-500">{routeDisplay}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(quote.status)}`}
            >
              {quote.status.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-4">
          {/* Quote Details Section */}
          <CollapsibleSection title="Quote Details" defaultOpen={true} icon={Package}>
            <QuoteDetailsTable quote={quote} onFieldSave={handleFieldSave} />
          </CollapsibleSection>

          {/* Offers Section */}
          <CollapsibleSection
            title="Offers"
            defaultOpen={true}
            icon={Ship}
            actions={
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setIsOfferDialogOpen(true)}
              >
                <Plus className="w-3 h-3 mr-1" />
                Add Offer
              </Button>
            }
          >
            <QuoteOffersSection quoteId={quote.id} />
          </CollapsibleSection>

          <OfferDialog
            open={isOfferDialogOpen}
            onOpenChange={setIsOfferDialogOpen}
            quoteId={quote.id}
            mode="create"
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['fms_offers', quote.id] })
            }}
          />

          {/* Notes Section */}
          <CollapsibleSection title="Notes" defaultOpen={false} icon={StickyNote}>
            <div className="space-y-2">
              <textarea
                className="w-full h-32 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="Add internal notes about this quote..."
                defaultValue={quote.notes || ''}
                onBlur={(e) => {
                  if (e.target.value !== (quote.notes || '')) {
                    handleFieldSave('notes', e.target.value)
                  }
                }}
              />
            </div>
          </CollapsibleSection>
        </div>
      </PageBody>
    </Page>
  )
}
