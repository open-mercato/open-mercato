'use client'

import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { CustomerContextCard } from '../../../types'

interface Props {
  card: CustomerContextCard
  onDismiss: () => void
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '6px 8px', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>{value}</div>
    </div>
  )
}

export function ContextCard({ card, onDismiss }: Props) {
  const c = card.customer

  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
        borderLeft: '4px solid #8b5cf6',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: '#f5f3ff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#5b21b6' }}>👤 Kontekst klienta</span>
        <IconButton type="button" variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss customer context">
          ✕
        </IconButton>
      </div>
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>{c.name}</div>
        <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '12px' }}>{c.company}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <StatBox label="Wartość klienta (LTV)" value={`${c.lifetimeValue.toLocaleString()} ${c.currency}`} />
          <StatBox label="Ostatnie zamówienie" value={c.lastOrderDate} />
          <StatBox label="Liczba zamówień" value={String(c.orderCount)} />
          <StatBox label="Śr. wartość zamówienia" value={`${c.avgOrderValue.toLocaleString()} ${c.currency}`} />
        </div>

        {c.topCategories.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Top kategorie:</div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {c.topCategories.map((cat, i) => (
                <span
                  key={i}
                  style={{
                    padding: '2px 8px',
                    backgroundColor: '#f1f5f9',
                    borderRadius: '12px',
                    fontSize: '11px',
                    color: '#475569',
                  }}
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>
        )}

        {c.notes && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px',
              backgroundColor: '#fffbeb',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#92400e',
            }}
          >
            📝 {c.notes}
          </div>
        )}
      </div>
    </div>
  )
}
