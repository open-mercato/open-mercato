'use client'

import * as React from 'react'
import { Braces } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { LedgerEntry } from '../../lib/context-ledger'
import { insertAtElementCursor } from '../../lib/insert-at-cursor'
import {
  formatLedgerSample,
  groupLedgerEntries,
  insertableLedgerEntries,
} from '../../lib/ledger-entry-display'

/**
 * Ledger-fed variable picker (spec 2026-07-26-workflows-ux-redesign.md
 * section 3.5, step 3.2, mockup Screen 2).
 *
 * An icon button beside template-capable config inputs that opens a popover
 * listing the context available at the edited step — the step's incoming
 * ledger entries grouped by producer kind, each with its type badge, a
 * `maybe` marker for path-dependent presence, and a sample snippet when one
 * is known. Clicking a row splices the picked path into the target control at
 * the cursor position (via the target element's id — works for Input and
 * Textarea alike) and closes the popover. `insertMode` controls the spliced
 * text: `'template'` (default) wraps the path as `{{path}}` for interpolated
 * config values; `'bare'` inserts the dot path as-is for consumers that treat
 * the whole value as a context path (sub-workflow `inputMapping` values read
 * by `mapInputData` via `getNestedValue`, no `{{}}` interpolation).
 *
 * The button renders even when no ledger entries are available so the
 * feature stays discoverable; the popover then shows an empty state. Grouping,
 * sample formatting, and the `'*'` wildcard filter are shared with the docked
 * Input data panel (lib/ledger-entry-display.ts), so both listings always show
 * the same ledger the same way.
 */

export type VariablePickerInsertMode = 'template' | 'bare'

export interface VariablePickerButtonProps {
  targetId: string
  value: string
  onValueChange: (nextValue: string) => void
  ledgerEntries?: LedgerEntry[]
  insertMode?: VariablePickerInsertMode
  disabled?: boolean
}

export function VariablePickerButton({
  targetId,
  value,
  onValueChange,
  ledgerEntries,
  insertMode = 'template',
  disabled,
}: VariablePickerButtonProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')

  const entries = React.useMemo(() => insertableLedgerEntries(ledgerEntries), [ledgerEntries])
  const query = search.trim().toLowerCase()
  const visibleEntries = query
    ? entries.filter((entry) => entry.path.toLowerCase().includes(query))
    : entries
  const groups = groupLedgerEntries(visibleEntries)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setSearch('')
  }

  const handleInsert = (path: string) => {
    const element = document.getElementById(targetId)
    const target =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null
    const insertion = insertMode === 'bare' ? path : `{{${path}}}`
    const result = insertAtElementCursor(target, value, insertion)
    onValueChange(result.value)
    handleOpenChange(false)
    if (target) {
      window.requestAnimationFrame(() => {
        target.focus()
        if (typeof target.setSelectionRange === 'function') {
          target.setSelectionRange(result.cursor, result.cursor)
        }
      })
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={t('workflows.variablePicker.buttonLabel')}
          disabled={disabled}
        >
          <Braces className="size-3.5" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <div className="border-b border-border p-2">
          <Input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('workflows.variablePicker.searchPlaceholder')}
            aria-label={t('workflows.variablePicker.searchPlaceholder')}
            className="text-xs"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {entries.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {t('workflows.variablePicker.emptyState')}
            </p>
          ) : groups.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {t('workflows.variablePicker.noMatches')}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.kind}>
                <p className="px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                  {t(`workflows.variablePicker.groups.${group.kind}`)}
                </p>
                {group.entries.map((entry) => {
                  const sample = formatLedgerSample(entry.sample)
                  return (
                    <Button
                      key={entry.path}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleInsert(entry.path)}
                      className="h-auto w-full justify-start gap-2 px-2 py-1.5"
                    >
                      <span className="min-w-0 truncate font-mono text-xs">{entry.path}</span>
                      <Badge
                        variant={entry.type === 'unknown' ? 'muted' : 'secondary'}
                        className="shrink-0 text-xs"
                      >
                        {entry.type}
                      </Badge>
                      {entry.presence === 'maybe' && (
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {t('workflows.variablePicker.maybeBadge')}
                        </Badge>
                      )}
                      {sample && (
                        <span
                          className={cn(
                            'ml-auto min-w-0 truncate text-xs text-muted-foreground',
                            sample.numeric && 'tabular-nums',
                          )}
                        >
                          {sample.text}
                        </span>
                      )}
                    </Button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
