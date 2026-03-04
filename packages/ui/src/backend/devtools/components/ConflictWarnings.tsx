'use client'

import type { UmesConflict } from '@open-mercato/shared/lib/umes/devtools-types'

export function ConflictWarnings({ conflicts }: { conflicts: UmesConflict[] }) {
  if (conflicts.length === 0) {
    return (
      <p className="text-xs italic text-emerald-600 dark:text-emerald-400">
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
              ? 'border-l-red-500 bg-red-50 dark:bg-red-950/30'
              : 'border-l-amber-500 bg-amber-50 dark:bg-amber-950/30'
          }`}
        >
          <div className="mb-0.5 font-semibold">
            {conflict.severity === 'error' ? 'Error' : 'Warning'}: {conflict.type}
          </div>
          <div className="text-foreground/80">{conflict.message}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Modules: {conflict.moduleIds.join(', ')} | Target: {conflict.target}
          </div>
        </div>
      ))}
    </div>
  )
}
