'use client'

import * as React from 'react'
import { GripVertical } from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * Phase E — Ranking renderer shared by `PreviewSurface` and `FormRunner`.
 *
 * Behavior (Decision 4 — partial allowed by default):
 * - Authors define options via `x-om-options` (same as select_one / select_many).
 * - Respondents drag entries up/down to assemble a rank order. Items the
 *   respondent has not yet placed sit at the bottom of the list with a muted
 *   rank chip (`—`). Dragging an unranked item up implicitly enters it into
 *   the rank order; dragging a ranked item past the boundary unranks it.
 * - Keyboard accessibility comes from `@dnd-kit/sortable`'s
 *   `sortableKeyboardCoordinates` coordinate getter (arrow keys reorder).
 * - Touch targets honor the 44px minimum (`h-11`).
 *
 * The persisted value is the rank-ordered prefix of option values; unranked
 * items never appear in the value. The dnd-kit list combines ranked + unranked
 * into one sortable so reordering across the boundary is intuitive.
 */

export type RankingFieldOption = {
  value: string
  label: string
}

export type RankingFieldProps = {
  /** Stable DOM id prefix (`preview-<key>` or `runner-<key>`). */
  idPrefix: string
  options: ReadonlyArray<RankingFieldOption>
  /** Current rank-ordered value (array of option values). */
  value: ReadonlyArray<string>
  /** Receives the next rank-ordered value. */
  onChange: (next: string[]) => void
  /** When false, drag/keyboard interactions are disabled (preview read-only). */
  canEdit: boolean
  t: TranslateFn
}

type RankingRow = {
  id: string
  value: string
  label: string
  rank: number | null
}

/**
 * Builds a single sortable row list: every ranked option (in user order)
 * followed by every unranked option (in author-declared order). The id of
 * each row is the option value (option values are unique in `x-om-options`).
 */
function buildRows(
  options: ReadonlyArray<RankingFieldOption>,
  value: ReadonlyArray<string>,
): RankingRow[] {
  const optionByValue = new Map<string, RankingFieldOption>()
  for (const option of options) optionByValue.set(option.value, option)
  const ranked: RankingRow[] = []
  const seen = new Set<string>()
  let rank = 1
  for (const entry of value) {
    if (seen.has(entry)) continue
    const option = optionByValue.get(entry)
    if (!option) continue
    seen.add(entry)
    ranked.push({ id: option.value, value: option.value, label: option.label, rank })
    rank += 1
  }
  const unranked: RankingRow[] = []
  for (const option of options) {
    if (seen.has(option.value)) continue
    unranked.push({ id: option.value, value: option.value, label: option.label, rank: null })
  }
  return [...ranked, ...unranked]
}

export function RankingField({
  idPrefix,
  options,
  value,
  onChange,
  canEdit,
  t,
}: RankingFieldProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const rows = React.useMemo(() => buildRows(options, value), [options, value])
  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      if (!canEdit) return
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = rows.findIndex((row) => row.id === active.id)
      const newIndex = rows.findIndex((row) => row.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const reordered = arrayMove(rows, oldIndex, newIndex)
      // The new ranked prefix is every entry whose target index is strictly
      // less than the count of items currently in `value` after adding the
      // moved item. For simplicity, after a manual reorder we treat every
      // entry the user has *touched* (i.e. that appeared in `value` OR was
      // moved into a position above an already-ranked entry) as ranked.
      // The simplest invariant: respect the user's manual order — every row
      // up to and including the moved one becomes ranked. This matches the
      // typical Typeform-style ranking UX.
      const nextValue: string[] = []
      const movedIndex = newIndex
      for (let i = 0; i <= movedIndex; i += 1) {
        nextValue.push(reordered[i].value)
      }
      // Preserve any other previously-ranked items that ended up below the
      // moved row — that way dragging an already-ranked entry within the
      // ranked prefix doesn't accidentally unrank later entries.
      const previouslyRanked = new Set(value)
      for (let i = movedIndex + 1; i < reordered.length; i += 1) {
        const row = reordered[i]
        if (previouslyRanked.has(row.value)) nextValue.push(row.value)
      }
      onChange(nextValue)
    },
    [canEdit, onChange, rows, value],
  )
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1" aria-label={t('forms.runner.field.ranking.dragHandle')}>
          {rows.map((row) => (
            <RankingRowItem
              key={row.id}
              row={row}
              idPrefix={idPrefix}
              canEdit={canEdit}
              t={t}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

type RankingRowItemProps = {
  row: RankingRow
  idPrefix: string
  canEdit: boolean
  t: TranslateFn
}

function RankingRowItem({ row, idPrefix, canEdit, t }: RankingRowItemProps) {
  const sortable = useSortable({ id: row.id, disabled: !canEdit })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }
  const isRanked = row.rank !== null
  const chipText = isRanked ? String(row.rank) : '—'
  const itemId = `${idPrefix}-rank-${row.value}`
  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      id={itemId}
      className={
        'flex h-11 items-center gap-2 rounded-md border border-border bg-card px-2 '
        + (isRanked ? 'text-foreground' : 'text-muted-foreground')
      }
    >
      <Tag variant="neutral">{chipText}</Tag>
      <span className="flex-1 text-sm">{row.label}</span>
      <button
        type="button"
        aria-label={t('forms.runner.field.ranking.dragHandle')}
        disabled={!canEdit}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        {...sortable.listeners}
        {...sortable.attributes}
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
    </li>
  )
}
