'use client'

import * as React from 'react'
import { useState } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Loader2, X, PanelRightClose, PanelRight, Save, Check, AlertCircle } from 'lucide-react'
import { useQuoteWizard } from './hooks/useQuoteWizard'
import { QuoteWizardHeader } from './QuoteWizardHeader'
import { QuoteWizardLinesTable } from './QuoteWizardLinesTable'
import { QuoteWizardTotals } from './QuoteWizardTotals'
import { QuoteWizardContextPanel } from './QuoteWizardContextPanel'
import { ProductSearchPanel } from './ProductSearchPanel'
import { AddProductModal } from './AddProductModal'

type QuoteWizardContentProps = {
  quoteId: string
  onClose: () => void
}

export function QuoteWizardContent({ quoteId, onClose }: QuoteWizardContentProps) {
  const [contextPanelOpen, setContextPanelOpen] = useState(true)
  const [selectedProduct, setSelectedProduct] = useState<unknown | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    quote,
    isLoadingQuote,
    updateQuote,
    lines,
    isLoadingLines,
    addLine,
    updateLine,
    removeLine,
    saveStatus,
    forceSave,
    hasPendingChanges,
    totals,
    showProductSearch,
    openProductSearch,
    closeProductSearch,
  } = useQuoteWizard({
    quoteId,
    onError: setError,
  })

  const handleClose = async () => {
    if (hasPendingChanges) {
      await forceSave()
    }
    onClose()
  }

  const handleAddProduct = (product: unknown) => {
    setSelectedProduct(product)
  }

  const handleConfirmAddProduct = async (data: {
    productId: string
    variantId: string
    priceId: string
    productName: string
    chargeCode: string
    productType: string
    providerName?: string
    containerSize?: string
    contractType: string
    quantity: number
    unitCost: number
    currencyCode: string
    marginPercent: number
  }) => {
    const unitSales = data.unitCost / (1 - data.marginPercent / 100)

    await addLine({
      productId: data.productId,
      variantId: data.variantId,
      priceId: data.priceId,
      productName: data.productName,
      chargeCode: data.chargeCode,
      productType: data.productType,
      providerName: data.providerName || null,
      containerSize: data.containerSize || null,
      contractType: data.contractType,
      quantity: data.quantity.toString(),
      unitCost: data.unitCost.toString(),
      currencyCode: data.currencyCode,
      marginPercent: data.marginPercent.toString(),
      unitSales: unitSales.toString(),
    })

    setSelectedProduct(null)
    closeProductSearch()
  }

  if (isLoadingQuote) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Quote not found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">
            Quote {quote.quoteNumber || quote.id.slice(0, 8)}
          </h1>
          {quote.originPortCode && quote.destinationPortCode && (
            <span className="text-muted-foreground">
              {quote.originPortCode} → {quote.destinationPortCode}
            </span>
          )}
          <Badge variant={quote.status === 'draft' ? 'secondary' : 'default'}>
            {quote.status.toUpperCase()}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Save status indicator */}
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            {saveStatus === 'saving' && (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Saving...</span>
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-green-600">Saved</span>
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <AlertCircle className="h-4 w-4 text-red-500" />
                <span className="text-red-600">Error saving</span>
              </>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setContextPanelOpen(!contextPanelOpen)}
            title={contextPanelOpen ? 'Hide context panel' : 'Show context panel'}
          >
            {contextPanelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRight className="h-4 w-4" />
            )}
          </Button>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-sm">
          {error}
          <button
            className="ml-2 underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel - main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Quote header form */}
          <QuoteWizardHeader quote={quote} onChange={updateQuote} />

          {/* Product search or lines table */}
          <div className="flex-1 min-h-0 overflow-auto p-4">
            {showProductSearch ? (
              <ProductSearchPanel
                onSelect={handleAddProduct}
                onClose={closeProductSearch}
                defaultContainerSize={undefined}
              />
            ) : (
              <QuoteWizardLinesTable
                lines={lines}
                isLoading={isLoadingLines}
                onLineUpdate={updateLine}
                onRemoveLine={removeLine}
                onAddProduct={openProductSearch}
              />
            )}
          </div>

          {/* Totals footer */}
          <QuoteWizardTotals
            totals={totals}
            currency={quote.currencyCode}
          />
        </div>

        {/* Right panel - context */}
        {contextPanelOpen && (
          <QuoteWizardContextPanel
            clientName={quote.clientName}
            originPort={quote.originPortCode}
            destinationPort={quote.destinationPortCode}
          />
        )}
      </div>

      {/* Add product modal */}
      <AddProductModal
        product={selectedProduct}
        defaultQuantity={1}
        defaultMarginPercent={10}
        onConfirm={handleConfirmAddProduct}
        onCancel={() => setSelectedProduct(null)}
      />
    </div>
  )
}
