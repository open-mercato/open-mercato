'use client'

import type { UmesExtensionInfo } from '@open-mercato/shared/lib/umes/devtools-types'

const TYPE_COLORS: Record<string, string> = {
  enricher: '#3b82f6',
  interceptor: '#f59e0b',
  'component-override': '#8b5cf6',
  'injection-widget': '#10b981',
  'injection-data-widget': '#06b6d4',
}

export function ExtensionPointList({ extensions }: { extensions: UmesExtensionInfo[] }) {
  if (extensions.length === 0) {
    return <p style={{ color: '#9ca3af', fontStyle: 'italic' }}>No extensions registered</p>
  }

  const grouped = new Map<string, UmesExtensionInfo[]>()
  for (const ext of extensions) {
    const key = ext.type
    const group = grouped.get(key) ?? []
    group.push(ext)
    grouped.set(key, group)
  }

  return (
    <div>
      {Array.from(grouped.entries()).map(([type, items]) => (
        <div key={type} style={{ marginBottom: '12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '4px',
              fontWeight: 600,
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: TYPE_COLORS[type] ?? '#6b7280',
                display: 'inline-block',
              }}
            />
            {type} ({items.length})
          </div>
          <div style={{ paddingLeft: '14px' }}>
            {items.map((ext, idx) => (
              <div
                key={`${ext.id}-${idx}`}
                style={{
                  padding: '4px 0',
                  borderBottom: '1px solid #f3f4f6',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '12px',
                }}
              >
                <div>
                  <span style={{ fontWeight: 500 }}>{ext.id}</span>
                  <span style={{ color: '#9ca3af', marginLeft: '6px' }}>
                    [{ext.moduleId}]
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#6b7280', fontSize: '11px' }}>
                    {ext.target}
                  </span>
                  {ext.priority !== 0 && (
                    <span
                      style={{
                        backgroundColor: '#f3f4f6',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        fontWeight: 600,
                      }}
                    >
                      P{ext.priority}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
