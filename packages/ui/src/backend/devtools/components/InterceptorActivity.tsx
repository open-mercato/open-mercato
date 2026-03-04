'use client'

import type { InterceptorActivityEntry } from '@open-mercato/shared/lib/umes/devtools-types'

const RESULT_STYLES: Record<string, { color: string; bg: string }> = {
  allowed: { color: '#10b981', bg: '#ecfdf5' },
  blocked: { color: '#ef4444', bg: '#fef2f2' },
  modified: { color: '#f59e0b', bg: '#fffbeb' },
}

export function InterceptorActivity({ entries }: { entries: InterceptorActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <p style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '12px' }}>
        No interceptor activity
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
              padding: '6px 8px',
              marginBottom: '4px',
              borderRadius: '4px',
              backgroundColor: style.bg,
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500 }}>{entry.interceptorId}</span>
              <span
                style={{
                  color: style.color,
                  fontWeight: 600,
                  fontSize: '11px',
                  textTransform: 'uppercase',
                }}
              >
                {entry.result}
              </span>
            </div>
            <div style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>
              {entry.method} {entry.route} | {entry.durationMs}ms
              {entry.statusCode ? ` | ${entry.statusCode}` : ''}
            </div>
            {entry.message && (
              <div style={{ color: '#9ca3af', fontSize: '11px', marginTop: '1px' }}>
                {entry.message}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
