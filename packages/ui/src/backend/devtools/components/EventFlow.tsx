'use client'

import type { EventFlowEntry } from '@open-mercato/shared/lib/umes/devtools-types'

const RESULT_CLASSES: Record<string, { text: string; bg: string }> = {
  allowed: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  blocked: { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30' },
  error: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
}

export function EventFlow({ entries }: { entries: EventFlowEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        No event flow data
      </p>
    )
  }

  const recent = entries.slice(-15).reverse()

  return (
    <div>
      {recent.map((entry, idx) => {
        const classes = RESULT_CLASSES[entry.result] ?? RESULT_CLASSES.allowed
        return (
          <div
            key={idx}
            className={`mb-0.5 flex items-center justify-between rounded p-1 px-2 text-xs ${classes.bg}`}
          >
            <div>
              <span className="font-medium">{entry.eventName}</span>
              <span className="ml-1.5 text-[11px] text-muted-foreground">
                {entry.widgetId}
              </span>
            </div>
            <span className={`text-[11px] font-semibold ${classes.text}`}>
              {entry.result}
            </span>
          </div>
        )
      })}
    </div>
  )
}
