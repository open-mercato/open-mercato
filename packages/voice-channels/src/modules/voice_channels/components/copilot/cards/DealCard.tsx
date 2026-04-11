'use client'

import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { DealStatusCard } from '../../../types'

interface Props {
  card: DealStatusCard
  onDismiss: () => void
}

export function DealCard({ card, onDismiss }: Props) {
  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
        borderLeft: '4px solid #06b6d4',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: '#ecfeff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#155e75' }}>📊 Otwarte deale</span>
        <IconButton type="button" variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss deal status">
          ✕
        </IconButton>
      </div>
      <div style={{ padding: '0 16px 12px' }}>
        {card.deals.map((deal) => (
          <div
            key={deal.id}
            style={{
              padding: '10px 0',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>{deal.title}</span>
              <span style={{ fontWeight: 700, fontSize: '14px', color: '#059669' }}>
                {deal.value.toLocaleString()} {deal.currency}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '12px' }}>
              <span
                style={{
                  padding: '2px 8px',
                  backgroundColor: '#f0f9ff',
                  borderRadius: '4px',
                  color: '#0369a1',
                }}
              >
                {deal.stage}
              </span>
              <span style={{ color: '#64748b' }}>{deal.daysInStage} dni w etapie</span>
              {deal.isStalled && (
                <span
                  style={{
                    color: '#dc2626',
                    fontWeight: 600,
                    animation: 'pulse 2s infinite',
                  }}
                >
                  ⚠ Wstrzymany
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
