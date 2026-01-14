'use client'

import * as React from 'react'
import { FileText, TrendingUp, Package } from 'lucide-react'
import type { PortRef } from './hooks/useQuoteWizard'

type QuoteWizardContextPanelProps = {
  clientName?: string | null
  originPorts?: PortRef[]
  destinationPorts?: PortRef[]
}

export function QuoteWizardContextPanel({
  clientName,
  originPorts,
  destinationPorts,
}: QuoteWizardContextPanelProps) {
  const hasRoute = originPorts && originPorts.length > 0 && destinationPorts && destinationPorts.length > 0
  const originDisplay = originPorts?.map(p => p.locode || p.name).join(', ') || ''
  const destinationDisplay = destinationPorts?.map(p => p.locode || p.name).join(', ') || ''
  return (
    <div className="w-80 border-l bg-muted/20 flex flex-col">
      <div className="p-4 border-b">
        <h2 className="text-sm font-medium">Context</h2>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Recent Client Quotes */}
        {clientName && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-xs font-medium uppercase text-muted-foreground">
                Recent Quotes for {clientName}
              </h3>
            </div>
            <div className="text-sm text-muted-foreground italic">
              No recent quotes found
            </div>
          </section>
        )}

        {/* Route Pricing Insights */}
        {hasRoute && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-xs font-medium uppercase text-muted-foreground">
                Route: {originDisplay} → {destinationDisplay}
              </h3>
            </div>
            <div className="text-sm text-muted-foreground italic">
              No pricing data available
            </div>
          </section>
        )}

        {/* Typical Products */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-xs font-medium uppercase text-muted-foreground">
              Typical Products
            </h3>
          </div>
          <div className="text-sm text-muted-foreground">
            <ul className="space-y-1">
              <li>Ocean Freight (GFRT)</li>
              <li>Terminal Handling (GTHC)</li>
              <li>Bunker Adjustment (GBAF)</li>
              <li>Bill of Lading (GBOL)</li>
              <li>Customs Clearance (GCUS)</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  )
}
