'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FileText } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@open-mercato/ui/primitives/sheet'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { DynamicTable, type ColumnDef } from '@open-mercato/ui/backend/dynamic-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { FmsQuoteStatus } from '../data/types'

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

export type QuotePreviewDrawerProps = {
  quoteId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
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

// Column definitions for Basic Info table
const BASIC_INFO_COLUMNS: ColumnDef[] = [
  { data: 'clientName', title: 'Client', type: 'text', readOnly: true, width: 150 },
  { data: 'direction', title: 'Direction', type: 'text', readOnly: true, width: 100 },
  { data: 'cargoType', title: 'Cargo Type', type: 'text', readOnly: true, width: 100 },
  { data: 'incoterm', title: 'Incoterm', type: 'text', readOnly: true, width: 80 },
]

// Column definitions for Route table
const ROUTE_COLUMNS: ColumnDef[] = [
  { data: 'originPortCode', title: 'Origin Port', type: 'text', readOnly: true, width: 120 },
  { data: 'destinationPortCode', title: 'Dest. Port', type: 'text', readOnly: true, width: 120 },
  { data: 'containerCount', title: 'Containers', type: 'numeric', readOnly: true, width: 100 },
]

// Column definitions for Commercial table
const COMMERCIAL_COLUMNS: ColumnDef[] = [
  { data: 'currencyCode', title: 'Currency', type: 'text', readOnly: true, width: 80 },
  { data: 'validUntil', title: 'Valid Until', type: 'text', readOnly: true, width: 120 },
  { data: 'createdAt', title: 'Created', type: 'text', readOnly: true, width: 150 },
  { data: 'updatedAt', title: 'Updated', type: 'text', readOnly: true, width: 150 },
]

function SectionTable({ title, columns, data }: { title: string; columns: ColumnDef[]; data: Record<string, unknown>[] }) {
  const tableRef = React.useRef<HTMLDivElement>(null)

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</h3>
      <DynamicTable
        tableRef={tableRef}
        data={data}
        columns={columns}
        idColumnName="id"
        tableName={title}
        height={80}
        colHeaders={true}
        rowHeaders={false}
        uiConfig={{
          hideToolbar: true,
          hideSearch: true,
          hideFilterButton: true,
          hideAddRowButton: true,
          hideBottomBar: true,
        }}
      />
    </div>
  )
}

export function QuotePreviewDrawer({ quoteId, open, onOpenChange }: QuotePreviewDrawerProps) {
  const { data: quote, isLoading, error } = useQuery({
    queryKey: ['fms_quote_preview', quoteId],
    queryFn: async () => {
      if (!quoteId) return null
      const response = await apiCall<QuoteDetail>(`/api/fms_quotes/${quoteId}`)
      if (!response.ok) throw new Error('Failed to load quote')
      return response.result
    },
    enabled: !!quoteId && open,
  })

  const displayTitle = quote?.quoteNumber || (quote?.id ? `Quote ${quote.id.slice(0, 8)}...` : 'Quote')
  const routeDisplay = [quote?.originPortCode, quote?.destinationPortCode].filter(Boolean).join(' → ') || 'No route set'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md sm:max-w-lg flex flex-col p-0" overlayClassName="backdrop-blur-none">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 p-6">
            <Spinner className="h-6 w-6" />
            <span className="text-sm text-gray-500">Loading quote...</span>
          </div>
        ) : error || !quote ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 p-6">
            <p className="text-sm text-gray-500">{error instanceof Error ? error.message : 'Quote not found'}</p>
          </div>
        ) : (
          <>
            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto p-6">
              <SheetHeader className="pb-4 border-b">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-500 rounded p-2">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <SheetTitle className="text-lg">{displayTitle}</SheetTitle>
                    <p className="text-sm text-gray-500">{routeDisplay}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(quote.status)}`}>
                    {quote.status.toUpperCase()}
                  </span>
                </div>
              </SheetHeader>

              <div className="mt-6 space-y-4">
                {/* Basic Info Table */}
                <SectionTable
                  title="Basic Info"
                  columns={BASIC_INFO_COLUMNS}
                  data={[{
                    id: quote.id,
                    clientName: quote.clientName || '-',
                    direction: quote.direction || '-',
                    cargoType: quote.cargoType?.toUpperCase() || '-',
                    incoterm: quote.incoterm?.toUpperCase() || '-',
                  }]}
                />

                {/* Route Table */}
                <SectionTable
                  title="Route"
                  columns={ROUTE_COLUMNS}
                  data={[{
                    id: quote.id,
                    originPortCode: quote.originPortCode || '-',
                    destinationPortCode: quote.destinationPortCode || '-',
                    containerCount: quote.containerCount ?? '-',
                  }]}
                />

                {/* Commercial & Dates Table */}
                <SectionTable
                  title="Commercial & Dates"
                  columns={COMMERCIAL_COLUMNS}
                  data={[{
                    id: quote.id,
                    currencyCode: quote.currencyCode || '-',
                    validUntil: quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : '-',
                    createdAt: new Date(quote.createdAt).toLocaleString(),
                    updatedAt: new Date(quote.updatedAt).toLocaleString(),
                  }]}
                />

                {/* Notes */}
                {quote.notes && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</h3>
                    <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">
                      {quote.notes}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Fixed footer with link to detail page */}
            <div className="flex-shrink-0 p-4 border-t bg-white">
              <Link href={`/backend/fms-quotes/${quote.id}`}>
                <Button className="w-full" variant="default">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Full Details
                </Button>
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
