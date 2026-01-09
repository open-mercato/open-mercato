'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Trash2, Edit2 } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { OfferLinesTable } from './OfferLinesTable'
import type { FmsOfferStatus, FmsContractType } from '../data/types'

type Offer = {
  id: string
  offerNumber: string
  status: FmsOfferStatus
  contractType: FmsContractType
  carrierName?: string | null
  validUntil?: string | null
  currencyCode: string
  totalAmount: string
  notes?: string | null
  createdAt: string
  updatedAt: string
}

type QuoteOffersSectionProps = {
  quoteId: string
}

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    sent: 'bg-blue-100 text-blue-800',
    accepted: 'bg-green-100 text-green-800',
    declined: 'bg-red-100 text-red-800',
    expired: 'bg-yellow-100 text-yellow-800',
    superseded: 'bg-purple-100 text-purple-800',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

function OfferCard({ offer, isExpanded, onToggle }: { offer: Offer; isExpanded: boolean; onToggle: () => void }) {
  const totalDisplay = parseFloat(offer.totalAmount) > 0
    ? `${offer.currencyCode} ${parseFloat(offer.totalAmount).toLocaleString()}`
    : 'No pricing'

  return (
    <div className="border border-gray-200 rounded-lg mb-2 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-50 text-left"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{offer.offerNumber}</span>
              {offer.carrierName && (
                <span className="text-xs text-gray-500">- {offer.carrierName}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-600">{totalDisplay}</span>
              <span className="text-xs text-gray-400">|</span>
              <span className="text-xs text-gray-500 capitalize">{offer.contractType}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(offer.status)}`}
          >
            {offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-gray-700">Pricing Lines</h4>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs">
                <Edit2 className="w-3 h-3 mr-1" />
                Edit Offer
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 hover:text-red-700">
                <Trash2 className="w-3 h-3 mr-1" />
                Delete
              </Button>
            </div>
          </div>

          <OfferLinesTable offerId={offer.id} />

          {offer.notes && (
            <div className="mt-4">
              <h5 className="text-xs font-semibold text-gray-600 mb-1">Notes</h5>
              <p className="text-xs text-gray-600 bg-white p-2 rounded border border-gray-200">
                {offer.notes}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function QuoteOffersSection({ quoteId }: QuoteOffersSectionProps) {
  const [expandedOfferId, setExpandedOfferId] = React.useState<string | null>(null)

  const { data: offers, isLoading } = useQuery({
    queryKey: ['fms_offers', quoteId],
    queryFn: async () => {
      const response = await apiCall<{ items: Offer[] }>(`/api/fms_quotes/offers?quoteId=${quoteId}`)
      if (!response.ok) throw new Error('Failed to load offers')
      return response.result?.items || []
    },
    enabled: !!quoteId,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-5 w-5" />
        <span className="ml-2 text-sm text-gray-500">Loading offers...</span>
      </div>
    )
  }

  if (!offers || offers.length === 0) {
    return (
      <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
        <p className="text-sm text-gray-500">No offers yet</p>
        <p className="text-xs text-gray-400 mt-1">Click "Add Offer" to create your first offer for this quote</p>
      </div>
    )
  }

  return (
    <div>
      {offers.map((offer) => (
        <OfferCard
          key={offer.id}
          offer={offer}
          isExpanded={expandedOfferId === offer.id}
          onToggle={() => setExpandedOfferId(expandedOfferId === offer.id ? null : offer.id)}
        />
      ))}
    </div>
  )
}
