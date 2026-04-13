"use client"
import * as React from 'react'
import { Search, GripVertical, X, ChevronRight } from 'lucide-react'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { Switch } from '../../primitives/switch'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export type ColumnChooserField = {
  key: string
  label: string
  group: string
  defaultVisible?: boolean
  alwaysVisible?: boolean
}

export type ColumnChooserSectionProps = {
  availableColumns: ColumnChooserField[]
  visibleColumnKeys: string[]
  columnOrder: string[]
  onToggleColumn: (key: string) => void
  onReorderColumns: (newOrder: string[]) => void
  dndContextId?: string
}

export type ColumnChooserPanelProps = ColumnChooserSectionProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function SortableColumnItem({
  column,
  onToggle,
}: {
  column: ColumnChooserField
  onToggle: (key: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.key })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
    >
      <span className="cursor-grab text-muted-foreground" {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </span>
      <span className="truncate flex-1 min-w-0">{column.label}</span>
      <Switch
        checked
        disabled={column.alwaysVisible}
        onCheckedChange={() => onToggle(column.key)}
        className="shrink-0 scale-90"
      />
    </div>
  )
}

export function ColumnChooserSection({
  availableColumns,
  visibleColumnKeys,
  columnOrder,
  onToggleColumn,
  onReorderColumns,
  dndContextId = 'column-chooser',
}: ColumnChooserSectionProps) {
  const t = useT()
  const [searchQuery, setSearchQuery] = React.useState('')
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const visibleSet = React.useMemo(() => new Set(visibleColumnKeys), [visibleColumnKeys])

  const selectedColumns = React.useMemo(() => {
    const ordered: ColumnChooserField[] = []
    for (const key of columnOrder) {
      const col = availableColumns.find((c) => c.key === key)
      if (col && visibleSet.has(key)) ordered.push(col)
    }
    for (const col of availableColumns) {
      if (visibleSet.has(col.key) && !ordered.some((o) => o.key === col.key)) {
        ordered.push(col)
      }
    }
    if (!searchQuery) return ordered
    const lowerQuery = searchQuery.toLowerCase()
    return ordered.filter((c) => c.label.toLowerCase().includes(lowerQuery))
  }, [availableColumns, visibleSet, columnOrder, searchQuery])

  const groupedAvailable = React.useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase()
    const filtered = availableColumns
      .filter((c) => !visibleSet.has(c.key))
      .filter((c) => !searchQuery || c.label.toLowerCase().includes(lowerQuery))

    const groups = new Map<string, ColumnChooserField[]>()
    for (const col of filtered) {
      const group = col.group || t('ui.columnChooser.ungrouped', 'Other')
      const list = groups.get(group) ?? []
      list.push(col)
      groups.set(group, list)
    }
    return groups
  }, [availableColumns, searchQuery, visibleSet, t])

  const toggleGroup = React.useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = selectedColumns.findIndex((c) => c.key === active.id)
    const newIndex = selectedColumns.findIndex((c) => c.key === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = [...selectedColumns]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    onReorderColumns(reordered.map((c) => c.key))
  }, [selectedColumns, onReorderColumns])

  const handleHideAll = React.useCallback(() => {
    for (const col of selectedColumns) {
      if (!col.alwaysVisible) onToggleColumn(col.key)
    }
  }, [selectedColumns, onToggleColumn])

  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-t">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            className="w-full rounded border bg-background pl-8 pr-2 py-2 text-sm"
            placeholder={t('ui.columnChooser.search', 'Search columns...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div>
        {selectedColumns.length > 0 ? (
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-baseline gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('ui.columnChooser.shown', 'Shown')}
                </div>
                <span className="text-xs text-muted-foreground">
                  {selectedColumns.length}/{availableColumns.length}
                </span>
              </div>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 text-sm text-muted-foreground hover:text-foreground"
                onClick={handleHideAll}
              >
                {t('ui.columnChooser.hideAll', 'Hide all')}
              </Button>
            </div>
            <DndContext id={dndContextId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={selectedColumns.map((c) => c.key)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {selectedColumns.map((col) => (
                    <SortableColumnItem key={col.key} column={col} onToggle={onToggleColumn} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        ) : null}

        <div className="border-t px-4 py-3 mt-4 mb-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
            {t('ui.columnChooser.available', 'Available columns')}
          </div>
          {Array.from(groupedAvailable.entries()).map(([group, columns]) => {
            const isCollapsed = !searchQuery && !expandedGroups.has(group)
            return (
              <div key={group} className="mb-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 h-auto px-1 py-2 text-xs font-medium uppercase text-muted-foreground"
                  onClick={() => toggleGroup(group)}
                >
                  <ChevronRight className={`size-4 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                  <span>{group}</span>
                </Button>
                {!isCollapsed ? (
                  <div className="space-y-2 mt-2">
                    {columns.map((col) => (
                      <div
                        key={col.key}
                        className="flex items-center gap-2 rounded pl-7 pr-2 py-1.5 text-sm hover:bg-muted/50 cursor-pointer"
                        onClick={() => { if (!col.alwaysVisible) onToggleColumn(col.key) }}
                      >
                        <span className="truncate flex-1 min-w-0">{col.label}</span>
                        <Switch
                          checked={false}
                          disabled={col.alwaysVisible}
                          onCheckedChange={() => onToggleColumn(col.key)}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 scale-90"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function ColumnChooserPanel({
  open,
  onOpenChange,
  ...sectionProps
}: ColumnChooserPanelProps) {
  const t = useT()
  React.useEffect(() => {
    if (!open) return
    if (typeof document === 'undefined') return
    document.body.dataset.columnChooserOpen = 'true'
    return () => {
      delete document.body.dataset.columnChooserOpen
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-y-0 right-0 z-50 w-80 border-l bg-background shadow-lg flex flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold text-sm">
          {t('ui.columnChooser.title', 'Columns')}
        </h3>
        <IconButton variant="ghost" size="sm" type="button" onClick={() => onOpenChange(false)} aria-label={t('ui.columnChooser.close', 'Close')}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex-1 overflow-auto">
        <ColumnChooserSection {...sectionProps} />
      </div>
    </div>
  )
}
