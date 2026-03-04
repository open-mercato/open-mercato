'use client'

import type { UmesConflict } from '@open-mercato/shared/lib/umes/devtools-types'

export function ConflictWarnings({ conflicts }: { conflicts: UmesConflict[] }) {
  if (conflicts.length === 0) {
    return (
      <p style={{ color: '#10b981', fontStyle: 'italic', fontSize: '12px' }}>
        No conflicts detected
      </p>
    )
  }

  return (
    <div>
      {conflicts.map((conflict, idx) => (
        <div
          key={idx}
          style={{
            padding: '8px 10px',
            marginBottom: '6px',
            borderRadius: '4px',
            backgroundColor: conflict.severity === 'error' ? '#fef2f2' : '#fffbeb',
            borderLeft: `3px solid ${conflict.severity === 'error' ? '#ef4444' : '#f59e0b'}`,
            fontSize: '12px',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '2px' }}>
            {conflict.severity === 'error' ? 'Error' : 'Warning'}: {conflict.type}
          </div>
          <div style={{ color: '#4b5563' }}>{conflict.message}</div>
          <div style={{ color: '#9ca3af', fontSize: '11px', marginTop: '2px' }}>
            Modules: {conflict.moduleIds.join(', ')} | Target: {conflict.target}
          </div>
        </div>
      ))}
    </div>
  )
}
