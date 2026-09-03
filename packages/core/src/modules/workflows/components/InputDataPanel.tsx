'use client'

import * as React from 'react'
import { ChevronDown, ChevronRight, Database } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { LedgerEntry } from '../lib/context-ledger'
import {
  formatLedgerSample,
  groupLedgerEntries,
  insertableLedgerEntries,
  readLedgerSampleAtPath,
} from '../lib/ledger-entry-display'
import { resolveStepSample, type PinnedSampleEnvelope } from '../lib/sample-resolver'
import { writeLedgerDragPayload } from '../lib/ledger-drag'

/**
 * Input data panel (spec 2026-07-26-workflows-ux-redesign.md section 5: every
 * activity inspector carries "the Input data panel (ledger + samples)
 * alongside").
 *
 * The docked twin of the variable picker: the same grouped, sample-annotated
 * ledger for the edited step, always visible next to the form instead of behind
 * a popover. Every row is DRAGGABLE — dropping it on any input or textarea
 * pastes the `{{path}}` pill natively, and template-capable fields intercept the
 * private ledger MIME to insert at the caret (see lib/ledger-drag.ts). Rows stay
 * focusable buttons: clicking copies the pill, so the keyboard path never
 * depends on a drag gesture.
 */

export interface InputDataPanelProps {
  entries?: LedgerEntry[]
  /** Step whose incoming context this panel describes; keys the sample lookup. */
  stepId?: string | null
  samples?: Record<string, PinnedSampleEnvelope>
  className?: string
  /**
   * Whether the panel starts folded. In the docked rail it does: the form is
   * what the author came for, and an expanded ledger would push it off the top
   * of a 384px column. The old 1280px modal showed it beside the form, where
   * costing nothing was true.
   */
  defaultCollapsed?: boolean
}

export function InputDataPanel({ entries, stepId, samples, className, defaultCollapsed = false }: InputDataPanelProps) {
  const t = useT()
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed)
  const [search, setSearch] = React.useState('')
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null)

  const listedEntries = React.useMemo(() => insertableLedgerEntries(entries), [entries])

  const sampleData = React.useMemo(() => {
    if (!stepId) return null
    return (
      resolveStepSample({
        stepId,
        samples,
        ledgerEntries: listedEntries.map((entry) => ({ path: entry.path, type: entry.type })),
      })?.data ?? null
    )
  }, [listedEntries, samples, stepId])

  const query = search.trim().toLowerCase()
  const visibleEntries = query
    ? listedEntries.filter((entry) => entry.path.toLowerCase().includes(query))
    : listedEntries
  const groups = groupLedgerEntries(visibleEntries)

  const handleDragStart = (event: React.DragEvent<HTMLButtonElement>, path: string) => {
    writeLedgerDragPayload(event.dataTransfer, path)
    event.dataTransfer.effectAllowed = 'copy'
  }

  const handleCopy = (path: string) => {
    setCopiedPath(path)
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (clipboard?.writeText) void clipboard.writeText(`{{${path}}}`).catch(() => undefined)
  }

  return (
    <aside
      className={cn('flex flex-col rounded-lg border border-border bg-muted/30', className)}
      aria-label={t('workflows.inputDataPanel.title')}
    >
      <button
        type="button"
        onClick={() => setCollapsed((previous) => !previous)}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-foreground"
      >
        {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        <Database className="size-3.5 text-muted-foreground" />
        <span className="flex-1">{t('workflows.inputDataPanel.title')}</span>
        <Badge variant="secondary" className="text-xs">
          {listedEntries.length}
        </Badge>
      </button>

      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border">
          <div className="p-2">
            <Input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('workflows.variablePicker.searchPlaceholder')}
              aria-label={t('workflows.variablePicker.searchPlaceholder')}
              className="text-xs"
            />
          </div>
          <p className="px-3 pb-2 text-xs text-muted-foreground">{t('workflows.inputDataPanel.hint')}</p>
          <div className="min-h-0 max-h-64 flex-1 overflow-y-auto px-1 pb-2">
            {listedEntries.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">{t('workflows.variablePicker.emptyState')}</p>
            ) : groups.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">{t('workflows.variablePicker.noMatches')}</p>
            ) : (
              groups.map((group) => (
                <div key={group.kind}>
                  <p className="px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                    {t(`workflows.variablePicker.groups.${group.kind}`)}
                  </p>
                  {group.entries.map((entry) => {
                    const sample = formatLedgerSample(
                      entry.sample !== undefined ? entry.sample : readLedgerSampleAtPath(sampleData, entry.path),
                    )
                    return (
                      <button
                        key={entry.path}
                        type="button"
                        draggable
                        onDragStart={(event) => handleDragStart(event, entry.path)}
                        onClick={() => handleCopy(entry.path)}
                        title={t('workflows.inputDataPanel.rowHint')}
                        className="flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
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
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
          <p className="px-3 pb-2 text-xs text-muted-foreground" aria-live="polite">
            {copiedPath ? t('workflows.inputDataPanel.copied', { path: copiedPath }) : ''}
          </p>
        </div>
      )}
    </aside>
  )
}
