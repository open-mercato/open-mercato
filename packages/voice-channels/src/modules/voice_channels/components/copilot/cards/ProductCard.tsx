'use client'

import { useState } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { ProductSuggestionCard } from '../../../types'

interface Props {
  card: ProductSuggestionCard
  onDismiss: () => void
}

export function ProductCard({ card, onDismiss }: Props) {
  const [addedProductIds, setAddedProductIds] = useState<Set<string>>(new Set())

  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
        borderLeft: '4px solid #2563eb',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: '#eff6ff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e40af' }}>
            📦 Sugestia produktu
          </span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '8px',
              backgroundColor: card.matchConfidence >= 80 ? '#dcfce7' : '#fef9c3',
              color: card.matchConfidence >= 80 ? '#166534' : '#854d0e',
            }}
          >
            {card.matchConfidence}% match
          </span>
        </div>
        <IconButton type="button" variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss product suggestion">
          ✕
        </IconButton>
      </div>
      <div style={{ padding: '12px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
        &ldquo;{card.triggerText}&rdquo;
      </div>
      {card.products.map((product) => (
        <div
          key={product.id}
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #f1f5f9',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>{product.name}</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>SKU: {product.sku}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: '16px', color: '#059669' }}>
                {product.price.amount.toFixed(2)} {product.price.currency}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>{product.price.priceType}</div>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '8px',
            }}
          >
            <span
              style={{
                fontSize: '12px',
                color: product.available ? '#059669' : '#dc2626',
                fontWeight: 500,
              }}
            >
              {product.available
                ? `✓ W magazynie${product.stockQuantity ? ` (${product.stockQuantity} szt.)` : ''}`
                : '✗ Brak w magazynie'}
            </span>
            <Button
              type="button"
              onClick={() => {
                setAddedProductIds((prev) => new Set(prev).add(product.id))
              }}
              disabled={addedProductIds.has(product.id)}
              size="sm"
              className={
                addedProductIds.has(product.id)
                  ? 'h-auto border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100'
                  : 'h-auto bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90'
              }
            >
              {addedProductIds.has(product.id) ? '✓ Dodano do oferty' : '+ Dodaj do oferty'}
            </Button>
          </div>
          {product.matchReason && (
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
              {product.matchReason}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
