"use client"

import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import type {
  DealTimelineCell,
  DealTimelineColumnResponse,
  DealTimelineItem,
  DealTimelineLane,
} from '../../../../../lib/dealsTimelineTypes'
import { TimelineDealCard, isTimelineDealOverdue } from './TimelineDealCard'
import { pluralCategory } from '../../../../../lib/calendar/labels'

export const TIMELINE_CELL_DROPPABLE_PREFIX = 'timeline-cell:'

export function timelineCellDroppableId(laneKey: string, column: number): string {
  return `${TIMELINE_CELL_DROPPABLE_PREFIX}${column}:${laneKey}`
}

export function formatTimelineCount(t: ReturnType<typeof useT>, count: number, partial: boolean): string {
  if (partial) return translateWithFallback(t, 'customers.deals.timeline.partialCount', '{count}+', { count })
  return String(count)
}

export function formatTimelineDealCount(
  t: ReturnType<typeof useT>,
  locale: string,
  count: number,
  partial: boolean,
): string {
  const params = { count: formatTimelineCount(t, count, partial) }
  const key = `customers.deals.timeline.lane.count.${pluralCategory(locale, count)}`
  const resolved = t(key, params)
  return resolved === key
    ? translateWithFallback(t, 'customers.deals.timeline.lane.count.other', '{count} deals', params)
    : resolved
}

export type TimelineLaneDisplay = {
  label: string
  kind: 'owner' | 'stage'
  accentClass: string
  avatarLabel?: string | null
  pipelineHeading?: string | null
}

export type TimelineLaneProps = {
  lane: DealTimelineLane
  display: TimelineLaneDisplay
  columns: DealTimelineColumnResponse[]
  gridTemplate: string
  perCell: number
  todayKey: string
  collapsed: boolean
  onToggleCollapsed: (laneKey: string) => void
  activeDrag: { laneKey: string; column: number } | null
  canDragItem: (item: DealTimelineItem) => boolean
  dragDisabledHint: (item: DealTimelineItem) => string | null
  canOpenInNewTab: boolean
  accentClassForItem: (item: DealTimelineItem) => string
  ownerLabelForItem: (item: DealTimelineItem) => string | null
  onOpenDeal: (item: DealTimelineItem, element: HTMLElement) => void
  renderMore: (input: { lane: DealTimelineLane; cell: DealTimelineCell; hiddenCount: number }) => React.ReactNode
}

type TimelineCellProps = {
  lane: DealTimelineLane
  cell: DealTimelineCell
  column: DealTimelineColumnResponse
  perCell: number
  todayKey: string
  activeDrag: TimelineLaneProps['activeDrag']
  canDragItem: TimelineLaneProps['canDragItem']
  dragDisabledHint: TimelineLaneProps['dragDisabledHint']
  canOpenInNewTab: boolean
  accentClassForItem: TimelineLaneProps['accentClassForItem']
  ownerLabelForItem: TimelineLaneProps['ownerLabelForItem']
  onOpenDeal: TimelineLaneProps['onOpenDeal']
  renderMore: TimelineLaneProps['renderMore']
}

function TimelineCell({
  lane,
  cell,
  column,
  perCell,
  todayKey,
  activeDrag,
  canDragItem,
  dragDisabledHint,
  canOpenInNewTab,
  accentClassForItem,
  ownerLabelForItem,
  onOpenDeal,
  renderMore,
}: TimelineCellProps): React.ReactElement {
  const dropDisabled = !activeDrag || activeDrag.laneKey !== lane.key
  const { setNodeRef, isOver } = useDroppable({
    id: timelineCellDroppableId(lane.key, column.index),
    data: { laneKey: lane.key, column: column.index },
    disabled: dropDisabled,
  })
  const visible = cell.items.slice(0, perCell)
  const hiddenCount = Math.max(0, cell.total - visible.length)
  const isTarget = isOver && !dropDisabled && activeDrag?.column !== column.index
  const isForeignLane = !!activeDrag && activeDrag.laneKey !== lane.key

  return (
    <div
      ref={setNodeRef}
      data-timeline-cell="true"
      data-lane-key={lane.key}
      data-column={column.index}
      className={`flex w-full min-w-0 flex-col gap-1.5 border-l border-border p-1.5 transition-colors ${
        column.isCurrent ? 'bg-accent-indigo/5' : ''
      } ${isTarget ? 'bg-accent-indigo/10 ring-2 ring-inset ring-accent-indigo' : ''} ${
        isForeignLane ? 'opacity-60' : ''
      }`}
    >
      {visible.map((item) => (
        <TimelineDealCard
          key={item.id}
          item={item}
          laneKey={lane.key}
          column={column.index}
          todayKey={todayKey}
          accentClass={accentClassForItem(item)}
          ownerLabel={ownerLabelForItem(item)}
          canDrag={canDragItem(item)}
          dragDisabledHint={dragDisabledHint(item)}
          canOpenInNewTab={canOpenInNewTab}
          onOpen={onOpenDeal}
        />
      ))}
      {hiddenCount > 0
        ? renderMore({ lane, cell, hiddenCount })
        : null}
    </div>
  )
}

export function TimelineLane({
  lane,
  display,
  columns,
  gridTemplate,
  perCell,
  todayKey,
  collapsed,
  onToggleCollapsed,
  activeDrag,
  canDragItem,
  dragDisabledHint,
  canOpenInNewTab,
  accentClassForItem,
  ownerLabelForItem,
  onOpenDeal,
  renderMore,
}: TimelineLaneProps): React.ReactElement {
  const t = useT()
  const locale = useLocale()
  const cellByColumn = React.useMemo(() => {
    const map = new Map<number, DealTimelineCell>()
    for (const cell of lane.cells) map.set(cell.column, cell)
    return map
  }, [lane.cells])
  const countLabel = formatTimelineDealCount(t, locale, lane.total, lane.partial)
  const toggleLabel = collapsed
    ? translateWithFallback(t, 'customers.deals.timeline.lane.expand', 'Expand {lane}', { lane: display.label })
    : translateWithFallback(t, 'customers.deals.timeline.lane.collapse', 'Collapse {lane}', { lane: display.label })

  return (
    <div role="row" data-timeline-lane={lane.key} className="grid border-b border-border" style={{ gridTemplateColumns: gridTemplate }}>
      <div
        role="rowheader"
        className="sticky left-0 z-10 flex items-start gap-2 border-r border-border bg-background px-2 py-2"
      >
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapsed(lane.key)}
        >
          {collapsed ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
        </IconButton>
        {display.kind === 'owner' ? (
          <Avatar label={display.avatarLabel ?? display.label} size="sm" />
        ) : (
          <span aria-hidden="true" className={`mt-1 h-4 w-1 shrink-0 rounded-full ${display.accentClass}`} />
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold leading-snug text-foreground" title={display.label}>
            {display.label}
          </span>
          <span className="text-xs leading-normal text-muted-foreground">{countLabel}</span>
        </div>
      </div>
      {columns.map((column) => {
        const cell = cellByColumn.get(column.index) ?? { column: column.index, total: 0, partial: false, items: [] }
        if (collapsed) {
          const overdue = cell.items.some((item) => isTimelineDealOverdue(item, todayKey))
          return (
            <div
              key={column.index}
              role="cell"
              className={`flex items-center border-l border-border px-2 py-2 text-xs ${
                column.isCurrent ? 'bg-accent-indigo/5' : ''
              } ${overdue ? 'font-semibold text-status-error-text' : 'text-muted-foreground'}`}
            >
              {cell.total > 0
                ? formatTimelineDealCount(t, locale, cell.total, cell.partial)
                : ''}
            </div>
          )
        }
        return (
          <div key={column.index} role="cell" className="flex min-w-0">
            <TimelineCell
              lane={lane}
              cell={cell}
              column={column}
              perCell={perCell}
              todayKey={todayKey}
              activeDrag={activeDrag}
              canDragItem={canDragItem}
              dragDisabledHint={dragDisabledHint}
              canOpenInNewTab={canOpenInNewTab}
              accentClassForItem={accentClassForItem}
              ownerLabelForItem={ownerLabelForItem}
              onOpenDeal={onOpenDeal}
              renderMore={renderMore}
            />
          </div>
        )
      })}
    </div>
  )
}
