'use client'

import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { QuickActionCard } from '../../../types'

interface Props {
  card: QuickActionCard
  onDismiss: () => void
}

export function ActionCard({ card, onDismiss }: Props) {
  const handleAction = (actionType: string) => {
    flash(`Akcja ${actionType} nie jest jeszcze podłączona do workflow.`, 'info')
  }

  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
        borderLeft: '4px solid #22c55e',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: '#f0fdf4',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#166534' }}>⚡ Szybkie akcje</span>
        <IconButton type="button" variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss quick actions">
          ✕
        </IconButton>
      </div>
      <div style={{ padding: '12px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
        &ldquo;{card.triggerText}&rdquo;
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {card.actions.map((action, i) => (
          <Button
            key={i}
            type="button"
            onClick={() => handleAction(action.actionType)}
            variant="outline"
            size="sm"
            className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
