'use client'

import type { InterceptorActivityEntry } from '@open-mercato/shared/lib/umes/devtools-types'

const RESULT_CLASSES: Record<string, { text: string; bg: string }> = {
  allowed: { text: 'text-status-success-icon', bg: 'bg-status-success-bg' },
  blocked: { text: 'text-status-error-icon', bg: 'bg-status-error-bg' },
  modified: { text: 'text-status-warning-icon', bg: 'bg-status-warning-bg' },
}

export function InterceptorActivity({ entries }: { entries: InterceptorActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        No interceptor activity
      </p>
    )
  }

  const recent = entries.slice(-15).reverse()

  return (
    <div>
      {recent.map((entry, idx) => {
        const classes = RESULT_CLASSES[entry.result] ?? RESULT_CLASSES.allowed
        return (
          <div key={idx} className={`mb-1 rounded p-1.5 px-2 text-xs ${classes.bg}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{entry.interceptorId}</span>
              <span className={`text-overline font-semibold uppercase ${classes.text}`}>
                {entry.result}
              </span>
            </div>
            <div className="mt-0.5 text-overline text-muted-foreground">
              {entry.method} {entry.route} | {entry.durationMs}ms
              {entry.statusCode ? ` | ${entry.statusCode}` : ''}
            </div>
            {entry.message && (
              <div className="mt-px text-overline text-muted-foreground/70">
                {entry.message}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
