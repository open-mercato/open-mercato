"use client"

import * as React from 'react'
import { Check, ChevronDown, ChevronsDown, ChevronsUp, Equal } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import type { EditorPriority } from '../../../lib/calendar/editorPayload'
import { CONTROL_BORDER, DROPDOWN_PANEL_CLASS, useDropdownDismiss } from './inputs'

// Jira/Linear-style priority glyphs: filled double chevrons for the extremes,
// an equals bar for the middle. Colours stay on DS status tokens (no amber):
// blue = low urgency, muted = medium, red = high.
const PRIORITY_META: Record<EditorPriority, { Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  low: { Icon: ChevronsDown, color: 'text-status-info-text' },
  medium: { Icon: Equal, color: 'text-muted-foreground' },
  high: { Icon: ChevronsUp, color: 'text-status-error-text' },
}

const PRIORITY_ORDER: EditorPriority[] = ['high', 'medium', 'low']

export function PriorityField({
  value,
  labels,
  ariaLabel,
  onChange,
}: {
  value: EditorPriority
  labels: Record<EditorPriority, string>
  ariaLabel: string
  onChange(next: EditorPriority): void
}) {
  const [open, setOpen] = React.useState(false)
  const close = React.useCallback(() => setOpen(false), [])
  const rootRef = useDropdownDismiss(open, close)
  const selected = PRIORITY_META[value]
  const SelectedIcon = selected.Icon

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <Button
        type="button"
        variant="outline"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((previous) => !previous)}
        className={cn('h-9 w-full justify-between bg-background px-3 font-normal shadow-none', CONTROL_BORDER)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <SelectedIcon aria-hidden className={cn('size-4 shrink-0', selected.color)} />
          <span className="truncate text-sm text-foreground">{labels[value]}</span>
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 opacity-60" />
      </Button>
      {open ? (
        <div role="listbox" aria-label={ariaLabel} className={DROPDOWN_PANEL_CLASS}>
          {PRIORITY_ORDER.map((priority) => {
            const meta = PRIORITY_META[priority]
            const Icon = meta.Icon
            const active = priority === value
            return (
              <Button
                key={priority}
                type="button"
                variant="ghost"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(priority)
                  setOpen(false)
                }}
                className={cn('h-auto w-full justify-start gap-2 px-2 py-1.5 text-left text-sm font-normal', active && 'bg-muted')}
              >
                <Icon aria-hidden className={cn('size-4 shrink-0', meta.color)} />
                <span className="min-w-0 flex-1 truncate text-foreground">{labels[priority]}</span>
                <Check aria-hidden className={cn('size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
              </Button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
