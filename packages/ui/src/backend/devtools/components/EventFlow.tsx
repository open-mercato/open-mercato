'use client'

import type { EventFlowEntry } from '@open-mercato/shared/lib/umes/devtools-types'

const RESULT_CLASSES: Record<string, { text: string; bg: string }> = {
  allowed: { text: 'text-status-success-icon', bg: 'bg-status-success-bg' },
  blocked: { text: 'text-status-error-icon', bg: 'bg-status-error-bg' },
  error: { text: 'text-status-warning-icon', bg: 'bg-status-warning-bg' },
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
              <span className="ml-1.5 text-overline text-muted-foreground">
                {entry.widgetId}
              </span>
            </div>
            <span className={`text-overline font-semibold ${classes.text}`}>
              {entry.result}
            </span>
          </div>
        )
      })}
    </div>
  )
}
