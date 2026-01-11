'use client'

import * as React from 'react'
import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Badge } from '@open-mercato/ui/primitives/badge'

type ProductData = {
  productId: string
  productName: string
  productType: string
  chargeCode: string
  variantId: string
  containerSize?: string | null
  priceId: string
  price: string
  currencyCode: string
  contractType: string
  variantName?: string | null
  loop?: string | null
}

type AddProductModalProps = {
  product: unknown
  defaultQuantity: number
  defaultMarginPercent: number
  onConfirm: (data: {
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
  }) => void
  onCancel: () => void
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function AddProductModal({
  product,
  defaultQuantity,
  defaultMarginPercent,
  onConfirm,
  onCancel,
}: AddProductModalProps) {
  const [quantity, setQuantity] = useState(defaultQuantity)
  const [marginPercent, setMarginPercent] = useState(defaultMarginPercent)

  const typedProduct = product as ProductData | null

  // Reset form when product changes
  useEffect(() => {
    if (typedProduct) {
      setQuantity(defaultQuantity)
      setMarginPercent(defaultMarginPercent)
    }
  }, [typedProduct, defaultQuantity, defaultMarginPercent])

  if (!typedProduct) return null

  const unitCost = parseFloat(typedProduct.price) || 0
  const unitSales = marginPercent >= 100
    ? unitCost * 10
    : marginPercent <= 0
      ? unitCost
      : unitCost / (1 - marginPercent / 100)
  const totalSales = quantity * unitSales
  const totalCost = quantity * unitCost
  const profit = totalSales - totalCost

  const handleConfirm = () => {
    onConfirm({
      productId: typedProduct.productId,
      variantId: typedProduct.variantId,
      priceId: typedProduct.priceId,
      productName: typedProduct.productName,
      chargeCode: typedProduct.chargeCode,
      productType: typedProduct.productType,
      providerName: typedProduct.variantName || undefined,
      containerSize: typedProduct.containerSize || undefined,
      contractType: typedProduct.contractType,
      quantity,
      unitCost,
      currencyCode: typedProduct.currencyCode,
      marginPercent,
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleConfirm()
    }
  }

  return (
    <Dialog open={!!product} onOpenChange={() => onCancel()}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Add Product to Quote</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Product info */}
          <div className="p-3 bg-muted/50 rounded-lg space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{typedProduct.productName}</div>
                {typedProduct.loop && (
                  <div className="text-sm text-muted-foreground">{typedProduct.loop}</div>
                )}
              </div>
              <Badge variant="outline" className="font-mono">
                {typedProduct.chargeCode}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {typedProduct.containerSize && (
                <Badge variant="secondary">{typedProduct.containerSize}</Badge>
              )}
              <Badge
                variant={typedProduct.contractType === 'NAC' ? 'default' : 'outline'}
              >
                {typedProduct.contractType}
              </Badge>
              <span className="text-muted-foreground">
                {formatCurrency(unitCost, typedProduct.currencyCode)} / unit
              </span>
            </div>
          </div>

          {/* Quantity */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="margin">Margin %</Label>
              <Input
                id="margin"
                type="number"
                min={0}
                max={99}
                value={marginPercent}
                onChange={(e) => setMarginPercent(Math.min(99, Math.max(0, parseFloat(e.target.value) || 0)))}
              />
            </div>
          </div>

          {/* Calculated values */}
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="p-2 bg-muted/30 rounded">
              <div className="text-muted-foreground text-xs">Unit Sales</div>
              <div className="font-mono">
                {formatCurrency(unitSales, typedProduct.currencyCode)}
              </div>
            </div>
            <div className="p-2 bg-muted/30 rounded">
              <div className="text-muted-foreground text-xs">Total Sales</div>
              <div className="font-mono font-medium">
                {formatCurrency(totalSales, typedProduct.currencyCode)}
              </div>
            </div>
            <div className="p-2 bg-muted/30 rounded">
              <div className="text-muted-foreground text-xs">Profit</div>
              <div className={`font-mono ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(profit, typedProduct.currencyCode)}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Add to Quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
