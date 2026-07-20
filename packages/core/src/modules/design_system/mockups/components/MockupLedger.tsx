'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { GalleryEntry } from '../../gallery/types'
import { collectLeaves, type MockupCounts, type MockupDocument, type MockupLeafNode } from '../schema'
import {
  LEDGER_STATUS_ORDER,
  ledgerStatusOf,
  STATUS_CHIP_CLASS,
  STATUS_DOT_CLASS,
  STATUS_LABELS,
  type MockupLedgerStatus,
} from './statusPresentation'

/**
 * The side ledger — every annotation lives here as a dot-label entry, paired
 * to its block like a review comment beside a diff line. Hovering a ledger
 * entry emphasizes only the paired block's margin rail (and vice versa);
 * selecting one scrolls the block into view. The user-story filter filters
 * the LEDGER — it never dims or hides screen content.
 */

export type MockupLedgerProps = {
  document: MockupDocument
  entries: Map<string, GalleryEntry>
  counts: MockupCounts
  storyFilter: string | null
  hoveredBlockId: string | null
  onHoverBlock: (blockId: string | null) => void
  onSelectBlock: (blockId: string) => void
}

function countFor(counts: MockupCounts, status: MockupLedgerStatus): number {
  if (status === 'implemented') return counts.implemented
  if (status === 'proposed') return counts.proposed
  if (status === 'placeholder') return counts.placeholder
  return counts.omDefault
}

function leafLabel(leaf: MockupLeafNode, entries: Map<string, GalleryEntry>): string {
  if (leaf.type === 'placeholder') return leaf.label
  return entries.get(leaf.entry)?.title ?? leaf.entry
}

export function MockupLedger({
  document,
  entries,
  counts,
  storyFilter,
  hoveredBlockId,
  onHoverBlock,
  onSelectBlock,
}: MockupLedgerProps) {
  const t = useT()
  const leaves = React.useMemo(() => collectLeaves(document.root), [document])
  const visibleLeaves = storyFilter
    ? leaves.filter((leaf) => leaf.userStory === storyFilter)
    : leaves

  return (
    <aside className="w-72 shrink-0 space-y-4" data-testid="mockup-ledger" aria-label={t('design_system.mockups.ledger.title', 'Annotations')}>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('design_system.mockups.ledger.title', 'Annotations')}</h3>
        <div className="grid grid-cols-2 gap-2" data-testid="mockup-ledger-counts">
          {LEDGER_STATUS_ORDER.map((status) => (
            <span
              key={status}
              className={cn(
                'flex items-center justify-between gap-2 rounded-sm border px-2 py-1 text-xs',
                STATUS_CHIP_CLASS[status],
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STATUS_DOT_CLASS[status])} />
                <span className="truncate">{t(STATUS_LABELS[status].key, STATUS_LABELS[status].fallback)}</span>
              </span>
              <span className="font-medium tabular-nums">{countFor(counts, status)}</span>
            </span>
          ))}
        </div>
      </div>
      {visibleLeaves.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('design_system.mockups.ledger.noMatches', 'No annotations match this user story')}
        </p>
      ) : (
        <ul className="space-y-2">
          {visibleLeaves.map((leaf) => {
            const status = ledgerStatusOf(leaf)
            const hovered = hoveredBlockId === leaf.id
            return (
              <li key={leaf.id}>
                <button
                  type="button"
                  data-testid={`mockup-ledger-entry-${leaf.id}`}
                  className={cn(
                    'w-full rounded-sm border bg-card px-2 py-1.5 text-left transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:shadow-focus',
                    hovered ? 'border-ring' : 'border-border',
                  )}
                  onMouseEnter={() => onHoverBlock(leaf.id)}
                  onMouseLeave={() => onHoverBlock(null)}
                  onFocus={() => onHoverBlock(leaf.id)}
                  onBlur={() => onHoverBlock(null)}
                  onClick={() => onSelectBlock(leaf.id)}
                >
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STATUS_DOT_CLASS[status])} />
                    <span className="truncate text-sm font-medium">{leafLabel(leaf, entries)}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{t(STATUS_LABELS[status].key, STATUS_LABELS[status].fallback)}</span>
                    {leaf.userStory ? (
                      <span className="rounded-sm border border-border bg-muted/30 px-1.5 font-mono">
                        {leaf.userStory}
                      </span>
                    ) : null}
                  </span>
                  {leaf.note ? (
                    <span className="mt-1 block text-xs text-muted-foreground">{leaf.note}</span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
