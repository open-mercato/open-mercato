'use client'

import type { EnricherTimingEntry } from '@open-mercato/shared/lib/umes/devtools-types'

function getTimingColor(ms: number): string {
  if (ms >= 500) return '#ef4444'
  if (ms >= 100) return '#f59e0b'
  return '#10b981'
}

function getTimingBarWidth(ms: number, maxMs: number): string {
  if (maxMs === 0) return '0%'
  return `${Math.min(100, (ms / maxMs) * 100)}%`
}

export function EnricherTiming({ entries }: { entries: EnricherTimingEntry[] }) {
  if (entries.length === 0) {
    return <p style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '12px' }}>No timing data</p>
  }

  const recent = entries.slice(-20).reverse()
  const maxMs = Math.max(...recent.map((e) => e.durationMs), 1)

  return (
    <div>
      {recent.map((entry, idx) => (
        <div
          key={idx}
          style={{
            padding: '4px 0',
            borderBottom: '1px solid #f3f4f6',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
            <span style={{ fontWeight: 500 }}>{entry.enricherId}</span>
            <span
              style={{
                color: getTimingColor(entry.durationMs),
                fontWeight: 600,
                fontFamily: 'monospace',
              }}
            >
              {entry.durationMs}ms
            </span>
          </div>
          <div
            style={{
              height: '4px',
              backgroundColor: '#f3f4f6',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: getTimingBarWidth(entry.durationMs, maxMs),
                backgroundColor: getTimingColor(entry.durationMs),
                borderRadius: '2px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div style={{ color: '#9ca3af', fontSize: '11px', marginTop: '1px' }}>
            {entry.targetEntity} | {entry.moduleId}
          </div>
        </div>
      ))}
    </div>
  )
}
