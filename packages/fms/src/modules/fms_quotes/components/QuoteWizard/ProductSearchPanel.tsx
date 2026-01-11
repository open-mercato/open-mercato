'use client'

import * as React from 'react'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@open-mercato/ui/primitives/table'
import { Search, X, Loader2, Plus, ArrowLeft } from 'lucide-react'

type ProductSearchResult = {
  productId: string
  productName: string
  productType: string
  chargeCode: string
  chargeCodeName: string
  variantId: string
  variantName?: string | null
  containerSize?: string | null
  priceId: string
  price: string
  currencyCode: string
  contractType: string
  contractNumber?: string | null
  validityStart: string
  validityEnd?: string | null
  providerContractorId?: string | null
  loop?: string | null
  source?: string | null
  destination?: string | null
  transitTime?: number | null
}

type ProductSearchResponse = {
  items: ProductSearchResult[]
  total: number
  page: number
  limit: number
  totalPages: number
}

type ProductSearchPanelProps = {
  onSelect: (product: ProductSearchResult) => void
  onClose: () => void
  defaultContainerSize?: string
}

function formatCurrency(value: string, currency: string): string {
  const num = parseFloat(value) || 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function ProductSearchPanel({
  onSelect,
  onClose,
  defaultContainerSize,
}: ProductSearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Debounce search query
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedQuery(searchQuery)
    }, 300)
    return () => clearTimeout(timeout)
  }, [searchQuery])

  const { data, isLoading, error } = useQuery({
    queryKey: ['product-search', debouncedQuery],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (debouncedQuery) params.set('q', debouncedQuery)
      params.set('limit', '50')

      const response = await apiCall<ProductSearchResponse>(
        `/api/products/search?${params.toString()}`
      )
      if (!response.ok) throw new Error('Failed to search products')
      return response.result ?? { items: [], total: 0, page: 1, limit: 50, totalPages: 0 }
    },
  })

  const products = data?.items ?? []

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h2 className="text-sm font-medium">Add Product</h2>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          placeholder="Search products by name or charge code..."
          className="pl-9 pr-9"
        />
        {searchQuery && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setSearchQuery('')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Results table */}
      <div className="flex-1 min-h-0 overflow-auto border rounded-lg">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-red-600">
            Failed to load products
          </div>
        ) : products.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            {debouncedQuery ? 'No products found' : 'Enter a search term to find products'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Charge</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="w-16">Type</TableHead>
                <TableHead className="w-24 text-right">Price</TableHead>
                <TableHead className="w-20">Contract</TableHead>
                <TableHead className="w-28">Valid Until</TableHead>
                <TableHead className="w-16 text-right">Transit</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={`${product.variantId}-${product.priceId}`}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {product.chargeCode}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{product.productName}</div>
                      {product.loop && (
                        <div className="text-xs text-muted-foreground">{product.loop}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {product.variantName || '-'}
                  </TableCell>
                  <TableCell>
                    {product.containerSize && (
                      <Badge variant="secondary" className="text-xs">
                        {product.containerSize}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(product.price, product.currencyCode)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        product.contractType === 'NAC'
                          ? 'default'
                          : product.contractType === 'BASKET'
                          ? 'secondary'
                          : 'outline'
                      }
                      className="text-xs"
                    >
                      {product.contractType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(product.validityEnd)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {product.transitTime ? `${product.transitTime}d` : '-'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onSelect(product)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Footer */}
      <div className="mt-3 text-xs text-muted-foreground">
        {data?.total ? `${data.total} products found` : ''}
      </div>
    </div>
  )
}
