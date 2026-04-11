'use client'

import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { PricingAlertCard } from '../../../types'

interface Props {
  card: PricingAlertCard
  onDismiss: () => void
}

export function PricingCard({ card, onDismiss }: Props) {
  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
        borderLeft: '4px solid #f59e0b',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: '#fffbeb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#92400e' }}>💰 Alert cenowy</span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '8px',
              backgroundColor: '#fef9c3',
              color: '#854d0e',
            }}
          >
            {card.matchConfidence}% match
          </span>
        </div>
        <IconButton type="button" variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss pricing alert">
          ✕
        </IconButton>
      </div>
      <div style={{ padding: '12px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
        &ldquo;{card.triggerText}&rdquo;
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '8px',
              backgroundColor: '#f8fafc',
              borderRadius: '6px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#64748b' }}>Cena klienta</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b' }}>
              {card.currentPrice.toFixed(2)} {card.currency}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '8px',
              backgroundColor: '#fef2f2',
              borderRadius: '6px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#64748b' }}>Cena minimalna</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#dc2626' }}>
              {card.floorPrice.toFixed(2)} {card.currency}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '8px',
              backgroundColor: '#f0fdf4',
              borderRadius: '6px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#64748b' }}>Max rabat</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#059669' }}>
              {card.maxDiscountPercent}%
            </div>
          </div>
        </div>
        {card.activePromotions.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
              Aktywne promocje:
            </div>
            {card.activePromotions.map((promo, i) => (
              <div
                key={i}
                style={{
                  fontSize: '12px',
                  color: '#059669',
                  padding: '4px 0',
                }}
              >
                🏷️ {promo.name}: {promo.discount} (do {promo.validUntil})
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
