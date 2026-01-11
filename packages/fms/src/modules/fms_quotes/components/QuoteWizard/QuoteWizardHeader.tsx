'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import type { Quote } from './hooks/useQuoteWizard'

type QuoteWizardHeaderProps = {
  quote: Quote
  onChange: (updates: Partial<Quote>) => void
}

export function QuoteWizardHeader({ quote, onChange }: QuoteWizardHeaderProps) {
  return (
    <div className="px-4 py-3 border-b bg-muted/30">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {/* Client Name */}
        <div className="space-y-1">
          <Label htmlFor="clientName" className="text-xs text-muted-foreground">
            Client (BCO)
          </Label>
          <Input
            id="clientName"
            value={quote.clientName || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ clientName: e.target.value })}
            placeholder="Client name"
            className="h-8 text-sm"
          />
        </div>

        {/* Quote Number */}
        <div className="space-y-1">
          <Label htmlFor="quoteNumber" className="text-xs text-muted-foreground">
            Reference
          </Label>
          <Input
            id="quoteNumber"
            value={quote.quoteNumber || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ quoteNumber: e.target.value })}
            placeholder="Quote reference"
            className="h-8 text-sm"
          />
        </div>

        {/* Direction */}
        <div className="space-y-1">
          <Label htmlFor="direction" className="text-xs text-muted-foreground">
            Direction
          </Label>
          <select
            id="direction"
            value={quote.direction || ''}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange({ direction: e.target.value || null })}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">Select</option>
            <option value="export">Export</option>
            <option value="import">Import</option>
            <option value="both">Both</option>
          </select>
        </div>

        {/* Origin Port */}
        <div className="space-y-1">
          <Label htmlFor="originPort" className="text-xs text-muted-foreground">
            Origin
          </Label>
          <Input
            id="originPort"
            value={quote.originPortCode || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ originPortCode: e.target.value.toUpperCase() })}
            placeholder="Port code"
            className="h-8 text-sm font-mono"
            maxLength={10}
          />
        </div>

        {/* Destination Port */}
        <div className="space-y-1">
          <Label htmlFor="destPort" className="text-xs text-muted-foreground">
            Destination
          </Label>
          <Input
            id="destPort"
            value={quote.destinationPortCode || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ destinationPortCode: e.target.value.toUpperCase() })}
            placeholder="Port code"
            className="h-8 text-sm font-mono"
            maxLength={10}
          />
        </div>

        {/* Currency */}
        <div className="space-y-1">
          <Label htmlFor="currency" className="text-xs text-muted-foreground">
            Currency
          </Label>
          <select
            id="currency"
            value={quote.currencyCode}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange({ currencyCode: e.target.value })}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="PLN">PLN</option>
            <option value="CNY">CNY</option>
          </select>
        </div>
      </div>
    </div>
  )
}
