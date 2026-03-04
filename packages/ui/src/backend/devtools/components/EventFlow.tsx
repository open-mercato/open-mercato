'use client'

import type { EventFlowEntry } from '@open-mercato/shared/lib/umes/devtools-types'

const RESULT_STYLES: Record<string, { color: string; bg: string }> = {
  allowed: { color: '#10b981', bg: '#ecfdf5' },
  blocked: { color: '#ef4444', bg: '#fef2f2' },
  error: { color: '#f59e0b', bg: '#fffbeb' },
}

export function EventFlow({ entries }: { entries: EventFlowEntry[] }) {
  if (entries.length === 0) {
    return (
      <p style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '12px' }}>
        No event flow data
      </p>
    )
  }

  const recent = entries.slice(-15).reverse()

  return (
    <div>
      {recent.map((entry, idx) => {
        const style = RESULT_STYLES[entry.result] ?? RESULT_STYLES.allowed
        return (
          <div
            key={idx}
            style={{
              padding: '4px 8px',
              marginBottom: '3px',
              borderRadius: '4px',
              backgroundColor: style.bg,
              fontSize: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <span style={{ fontWeight: 500 }}>{entry.eventName}</span>
              <span style={{ color: '#9ca3af', marginLeft: '6px', fontSize: '11px' }}>
                {entry.widgetId}
              </span>
            </div>
            <span style={{ color: style.color, fontWeight: 600, fontSize: '11px' }}>
              {entry.result}
            </span>
          </div>
        )
      })}
    </div>
  )
}
