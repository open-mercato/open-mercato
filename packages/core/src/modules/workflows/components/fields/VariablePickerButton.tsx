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
import type { LedgerEntry, LedgerSourceKind } from '../../lib/context-ledger'
import { insertAtElementCursor } from '../../lib/insert-at-cursor'

/**
 * Ledger-fed variable picker (spec 2026-07-26-workflows-ux-redesign.md
 * section 3.5, step 3.2, mockup Screen 2).
 *
 * An icon button beside template-capable config inputs that opens a popover
 * listing the context available at the edited step — the step's incoming
 * ledger entries grouped by producer kind, each with its type badge, a
 * `maybe` marker for path-dependent presence, and a sample snippet when one
 * is known. Clicking a row splices `{{path}}` into the target control at the
 * cursor position (via the target element's id — works for Input and
 * Textarea alike) and closes the popover.
 *
 * The button renders even when no ledger entries are available so the
 * feature stays discoverable; the popover then shows an empty state. The
 * trigger/signal `'*'` wildcard entries are unnamed payload spreads and are
 * not insertable, so they are filtered out of the listing.
 */

const GROUP_ORDER: LedgerSourceKind[] = [
  'contextSchema',
  'trigger',
  'userTask',
  'activity',
  'setVariable',
  'asyncResult',
  'signal',
  'join',
  'subWorkflow',
]

const SAMPLE_MAX_LENGTH = 40

interface FormattedSample {
  text: string
  numeric: boolean
}

function formatSample(sample: unknown): FormattedSample | null {
  if (sample === undefined) return null
  const numeric = typeof sample === 'number'
  let text: string
  if (typeof sample === 'string') {
    text = sample
  } else {
    try {
      text = JSON.stringify(sample) ?? String(sample)
    } catch {
      text = String(sample)
    }
  }
  if (text.length > SAMPLE_MAX_LENGTH) text = `${text.slice(0, SAMPLE_MAX_LENGTH - 1)}…`
  return { text, numeric }
}

function groupEntries(entries: LedgerEntry[]): Array<{ kind: LedgerSourceKind; entries: LedgerEntry[] }> {
  const byKind = new Map<LedgerSourceKind, LedgerEntry[]>()
  for (const entry of entries) {
    const list = byKind.get(entry.source.kind) ?? []
    list.push(entry)
    byKind.set(entry.source.kind, list)
  }
  const groups: Array<{ kind: LedgerSourceKind; entries: LedgerEntry[] }> = []
  for (const kind of GROUP_ORDER) {
    const list = byKind.get(kind)
    if (list && list.length > 0) groups.push({ kind, entries: list })
  }
  return groups
}

export interface VariablePickerButtonProps {
  targetId: string
  value: string
  onValueChange: (nextValue: string) => void
  ledgerEntries?: LedgerEntry[]
  disabled?: boolean
}

export function VariablePickerButton({ targetId, value, onValueChange, ledgerEntries, disabled }: VariablePickerButtonProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')

  const entries = React.useMemo(
    () => (ledgerEntries ?? []).filter((entry) => entry.path !== '*'),
    [ledgerEntries],
  )
  const query = search.trim().toLowerCase()
  const visibleEntries = query
    ? entries.filter((entry) => entry.path.toLowerCase().includes(query))
    : entries
  const groups = groupEntries(visibleEntries)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setSearch('')
  }

  const handleInsert = (path: string) => {
    const element = document.getElementById(targetId)
    const target =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null
    const result = insertAtElementCursor(target, value, `{{${path}}}`)
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
                  const sample = formatSample(entry.sample)
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
