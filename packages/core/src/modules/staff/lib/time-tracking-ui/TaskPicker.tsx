"use client"

import * as React from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveProjectColorHex } from '../timesheets-ui/colors'

/**
 * The task picker.
 *
 * A generic entity lookup is the wrong shape for this: thirty tasks belonging to
 * six projects are not thirty independent rows, they are six groups, and the one
 * thing every row in a group shares — the project and its customer — is exactly
 * what a flat list repeats and then truncates. So the project becomes a sticky
 * header said once, and the row spends its width on what differs.
 *
 * The other departure is what leads a row. `AWR-6` is how a task is named out
 * loud and quoted in a report, but nobody *scans* for it — they scan for "the
 * booking thing". The title is therefore the headline and the reference is a
 * quiet monospace column beside it, readable when you need it and silent when
 * you do not.
 *
 * Recents lead the list because time logging is repetitive: most entries in a
 * week go to a handful of tasks, so opening on those makes the common case one
 * keystroke.
 */

export type TaskPickerStatus = {
  id: string
  name: string
  color: string | null
  isDone: boolean
}

export type TaskPickerItem = {
  id: string
  reference: string | null
  title: string
  projectId: string | null
  projectName: string | null
  customerName: string | null
  statusId: string | null
  assigneeInitials: string | null
  assigneeName: string | null
  loggedMinutes: number | null
}

export type TaskPickerProps = {
  value: string | null
  onChange: (taskId: string | null) => void
  /** Every task the caller may pick, already scoped. */
  items: TaskPickerItem[]
  /** Task ids the viewer logged time to recently, most recent first. */
  recentTaskIds?: string[]
  statuses?: Record<string, TaskPickerStatus>
  loading?: boolean
  disabled?: boolean
  /** Set when the picker was opened from inside one project. */
  scopedProjectName?: string | null
  autoFocus?: boolean
}

type Group = { key: string; label: string; sublabel: string | null; items: TaskPickerItem[] }

function formatHours(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** Case-insensitive, first occurrence only — enough to show *why* a row matched. */
export function highlight(text: string, term: string): React.ReactNode {
  const trimmed = term.trim()
  if (!trimmed) return text
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase())
  if (index < 0) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-status-warning-bg px-0.5 text-status-warning-text">
        {text.slice(index, index + trimmed.length)}
      </mark>
      {text.slice(index + trimmed.length)}
    </>
  )
}

export function matchesTask(item: TaskPickerItem, term: string): boolean {
  const trimmed = term.trim().toLowerCase()
  if (!trimmed) return true
  return (
    item.title.toLowerCase().includes(trimmed) ||
    (item.reference ?? '').toLowerCase().includes(trimmed)
  )
}

/**
 * Recents first, then one group per project.
 *
 * A task that is in recents is deliberately still listed under its project: the
 * recents block is a shortcut, not a move, and a reader scanning Apollo should
 * find every Apollo task where they expect it.
 */
export function groupTasks(
  items: TaskPickerItem[],
  recentTaskIds: string[],
  labels: { recent: string; noProject: string },
): Group[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const groups: Group[] = []

  const recent = recentTaskIds
    .map((id) => byId.get(id))
    .filter((item): item is TaskPickerItem => item !== undefined)
  if (recent.length > 0) {
    groups.push({ key: '__recent', label: labels.recent, sublabel: null, items: recent })
  }

  const byProject = new Map<string, TaskPickerItem[]>()
  for (const item of items) {
    const key = item.projectId ?? '__none'
    const bucket = byProject.get(key) ?? []
    bucket.push(item)
    byProject.set(key, bucket)
  }

  const projectGroups = [...byProject.entries()].map(([key, groupItems]) => ({
    key,
    label: groupItems[0]?.projectName ?? labels.noProject,
    sublabel: groupItems[0]?.customerName ?? null,
    items: groupItems,
  }))
  projectGroups.sort((left, right) => left.label.localeCompare(right.label))

  return [...groups, ...projectGroups]
}

export function TaskPicker({
  value,
  onChange,
  items,
  recentTaskIds = [],
  statuses = {},
  loading,
  disabled,
  scopedProjectName,
  autoFocus,
}: TaskPickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)

  const labels = React.useMemo(
    () => ({
      recent: t('staff.time_tracking.taskPicker.recent', 'Recent'),
      noProject: t('staff.time_tracking.taskPicker.noProject', 'No project'),
      search: scopedProjectName
        ? t('staff.time_tracking.taskPicker.searchScoped', 'Search {project} tasks', { project: scopedProjectName })
        : t('staff.time_tracking.taskPicker.search', 'Search tasks'),
      placeholder: t('staff.time_tracking.taskPicker.placeholder', 'Pick a task'),
      change: t('staff.time_tracking.taskPicker.change', 'Change'),
      empty: t('staff.time_tracking.taskPicker.empty', 'Nothing matches {term}'),
      move: t('staff.time_tracking.taskPicker.keyMove', 'move'),
      pick: t('staff.time_tracking.taskPicker.keyPick', 'pick'),
      close: t('staff.time_tracking.taskPicker.keyClose', 'close'),
      count: t('staff.time_tracking.taskPicker.count', '{shown} of {total}'),
      loading: t('staff.time_tracking.taskPicker.loading', 'Loading tasks…'),
    }),
    [scopedProjectName, t],
  )

  const filtered = React.useMemo(() => items.filter((item) => matchesTask(item, query)), [items, query])
  const groups = React.useMemo(
    // Recents are only a shortcut for the unfiltered list; once you are typing,
    // the match itself is the shortcut and a duplicate row is just noise.
    () => groupTasks(filtered, query.trim() ? [] : recentTaskIds, labels),
    [filtered, labels, query, recentTaskIds],
  )
  const flat = React.useMemo(() => groups.flatMap((group) => group.items), [groups])

  React.useEffect(() => { setActiveIndex(0) }, [query])

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const selected = React.useMemo(() => items.find((item) => item.id === value) ?? null, [items, value])

  const choose = React.useCallback(
    (taskId: string) => {
      onChange(taskId)
      setQuery('')
      setOpen(false)
    },
    [onChange],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (flat.length === 0) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActiveIndex((current) => (current + step + flat.length) % flat.length)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const target = flat[activeIndex]
        if (target) choose(target.id)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    },
    [activeIndex, choose, flat],
  )

  const statusDot = (item: TaskPickerItem) => {
    const status = item.statusId ? statuses[item.statusId] : undefined
    const hex = status ? resolveProjectColorHex(status.color, status.name) : null
    return (
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: hex ?? 'var(--muted-foreground)' }}
        title={status?.name ?? undefined}
        aria-hidden
      />
    )
  }

  // Chosen and closed: one line, out of the way. The whole point of picking is
  // to stop looking at the picker.
  if (selected && !open) {
    return (
      <div
        ref={containerRef}
        className="flex items-center gap-2 rounded-md border border-input bg-background px-2.5 py-2"
        data-testid="task-picker-selected"
      >
        {statusDot(selected)}
        {selected.reference ? (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{selected.reference}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{selected.title}</span>
        {selected.projectName ? (
          <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {selected.customerName ? `${selected.projectName} · ${selected.customerName}` : selected.projectName}
          </span>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          className="shrink-0 text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => {
            setOpen(true)
            window.setTimeout(() => inputRef.current?.focus(), 0)
          }}
          data-testid="task-picker-change"
        >
          {labels.change}
        </button>
      </div>
    )
  }

  let flatIndex = -1

  return (
    <div ref={containerRef} className="flex flex-col gap-1" data-testid="task-picker">
      <div
        className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2.5
                   focus-within:border-foreground focus-within:shadow-focus"
      >
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={handleKeyDown}
          placeholder={selected ? selected.title : labels.search}
          aria-label={labels.placeholder}
          aria-expanded={open}
          role="combobox"
          aria-controls="task-picker-listbox"
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          data-testid="task-picker-input"
        />
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>

      {open ? (
        <div className="overflow-hidden rounded-md border border-border bg-popover shadow-md">
          <div
            ref={listRef}
            id="task-picker-listbox"
            role="listbox"
            className="max-h-72 overflow-y-auto"
          >
            {loading ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">{labels.loading}</p>
            ) : flat.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {labels.empty.replace('{term}', query.trim())}
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.key}>
                  <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b border-border bg-muted px-2.5 py-1 text-overline font-semibold uppercase tracking-widest text-muted-foreground">
                    <span className="truncate">
                      {group.sublabel ? `${group.label} · ${group.sublabel}` : group.label}
                    </span>
                    <span className="shrink-0 font-medium normal-case tracking-normal">{group.items.length}</span>
                  </div>
                  {group.items.map((item) => {
                    flatIndex += 1
                    const isActive = flatIndex === activeIndex
                    const hours = formatHours(item.loggedMinutes)
                    return (
                      <button
                        key={`${group.key}:${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={item.id === value}
                        data-active={isActive}
                        data-testid={`task-picker-option-${item.id}`}
                        onMouseEnter={() => setActiveIndex(flat.indexOf(item))}
                        onClick={() => choose(item.id)}
                        className={`flex h-[34px] w-full items-center gap-2 border-b border-border/50 px-2.5 text-left text-sm last:border-b-0 ${
                          isActive ? 'bg-accent' : ''
                        }`}
                      >
                        {statusDot(item)}
                        <span className="w-14 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                          {item.reference ? highlight(item.reference, query) : ''}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{highlight(item.title, query)}</span>
                        {item.assigneeInitials ? (
                          <span
                            className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[9px] font-semibold text-muted-foreground"
                            title={item.assigneeName ?? undefined}
                          >
                            {item.assigneeInitials}
                          </span>
                        ) : null}
                        {hours ? (
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{hours}</span>
                        ) : null}
                        {item.id === value ? <Check className="size-3.5 shrink-0 text-foreground" aria-hidden /> : null}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">↑</kbd>
              <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">↓</kbd>
              {labels.move}
              <kbd className="ml-1 rounded border border-border bg-background px-1 font-mono text-[10px]">↵</kbd>
              {labels.pick}
              <kbd className="ml-1 rounded border border-border bg-background px-1 font-mono text-[10px]">esc</kbd>
              {labels.close}
            </span>
            <span>{labels.count.replace('{shown}', String(flat.length)).replace('{total}', String(items.length))}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default TaskPicker
