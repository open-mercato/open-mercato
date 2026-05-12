'use client'

import type { UmesConflict } from '@open-mercato/shared/lib/umes/devtools-types'

export function ConflictWarnings({ conflicts }: { conflicts: UmesConflict[] }) {
  if (conflicts.length === 0) {
    return (
      <p className="text-xs italic text-status-success-text">
        No conflicts detected
      </p>
    )
  }

  return (
    <div>
      {conflicts.map((conflict, idx) => (
        <div
          key={idx}
          className={`mb-1.5 rounded border-l-[3px] p-2 text-xs ${
            conflict.severity === 'error'
              ? 'border-l-status-error-border bg-status-error-bg'
              : 'border-l-status-warning-border bg-status-warning-bg'
          }`}
        >
          <div className="mb-0.5 font-semibold">
            {conflict.severity === 'error' ? 'Error' : 'Warning'}: {conflict.type}
          </div>
          <div className="text-foreground/80">{conflict.message}</div>
          <div className="mt-0.5 text-overline text-muted-foreground">
            Modules: {conflict.moduleIds.join(', ')} | Target: {conflict.target}
          </div>
        </div>
      ))}
    </div>
  )
}
