'use client'

import type { InterceptorActivityEntry } from '@open-mercato/shared/lib/umes/devtools-types'

const RESULT_CLASSES: Record<string, { text: string; bg: string }> = {
  allowed: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  blocked: { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30' },
  modified: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
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
              <span className={`text-[11px] font-semibold uppercase ${classes.text}`}>
                {entry.result}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {entry.method} {entry.route} | {entry.durationMs}ms
              {entry.statusCode ? ` | ${entry.statusCode}` : ''}
            </div>
            {entry.message && (
              <div className="mt-px text-[11px] text-muted-foreground/70">
                {entry.message}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
