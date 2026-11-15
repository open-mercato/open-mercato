"use client"

import * as React from 'react'

type HealthRowProps = {
  label: string
  /** Supporting text — version, tool count, adapter ids, latency. Truncates. */
  detail?: string | null
  /** Fixed-width end of the row: a badge, or a badge plus an action. */
  trailing: React.ReactNode
  monoLabel?: boolean
}

/**
 * Label · detail · trailing, with the trailing column sized to its content and
 * the growing half clipped instead of the badge. The previous `justify-between`
 * flex row let either side win, which is why long adapter lists pushed the state
 * off the panel.
 */
export function HealthRow({ label, detail, trailing, monoLabel = false }: HealthRowProps) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={monoLabel ? 'truncate font-mono text-foreground' : 'truncate text-foreground'} title={label}>
          {label}
        </span>
        {detail ? (
          <span className="truncate font-mono text-muted-foreground" title={detail}>
            {detail}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>
    </li>
  )
}
