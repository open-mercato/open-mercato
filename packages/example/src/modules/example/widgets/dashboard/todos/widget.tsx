"use client"

import * as React from 'react'
import type { DashboardWidgetModule, DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

type TodoItem = {
  id: string
  title: string
  is_done: boolean
}

type TodoSettings = {
  pageSize: number
  showCompleted: boolean
}

const DEFAULT_SETTINGS: TodoSettings = {
  pageSize: 5,
  showCompleted: true,
}

function normalizeSettings(raw: unknown): TodoSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const data = raw as Partial<TodoSettings>
  const pageSize = Number(data.pageSize)
  return {
    pageSize: Number.isFinite(pageSize) && pageSize >= 1 && pageSize <= 20 ? Math.floor(pageSize) : DEFAULT_SETTINGS.pageSize,
    showCompleted: data.showCompleted ?? DEFAULT_SETTINGS.showCompleted,
  }
}

async function fetchTodos(settings: TodoSettings): Promise<TodoItem[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(settings.pageSize),
    sortDir: 'desc',
  })
  if (!settings.showCompleted) params.set('isDone', 'false')
  const res = await apiFetch(`/api/example/todos?${params.toString()}`)
  if (!res.ok) throw new Error(`Failed with status ${res.status}`)
  const json = await res.json().catch(() => ({}))
  const items = Array.isArray(json.items) ? json.items : []
  return items.map((item: any) => ({
    id: String(item?.id ?? ''),
    title: String(item?.title ?? ''),
    is_done: Boolean(item?.is_done ?? item?.isDone ?? false),
  })).filter((todo) => todo.id && todo.title)
}

async function createTodo(title: string): Promise<TodoItem> {
  const res = await apiFetch('/api/example/todos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`Failed with status ${res.status}`)
  const json = await res.json().catch(() => ({}))
  const id = json?.id ? String(json.id) : null
  if (!id) throw new Error('Missing todo id from response')
  return { id, title, is_done: false }
}

async function toggleTodo(id: string, isDone: boolean) {
  const res = await apiFetch('/api/example/todos', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, is_done: isDone }),
  })
  if (!res.ok) throw new Error(`Failed with status ${res.status}`)
}

const TodoWidget: React.FC<DashboardWidgetComponentProps<TodoSettings>> = ({ mode, settings, onSettingsChange }) => {
  const value = React.useMemo(() => normalizeSettings(settings), [settings])
  const [items, setItems] = React.useState<TodoItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchTodos(value)
      setItems(next)
    } catch (err) {
      console.error('Failed to load todos widget data', err)
      setError('Unable to load todos. Please try again later.')
    } finally {
      setLoading(false)
    }
  }, [value])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const handleCreate = React.useCallback(async () => {
    if (!draft.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createTodo(draft.trim())
      setDraft('')
      await refresh()
    } catch (err) {
      console.error('Failed to create todo from widget', err)
      setError('Unable to create todo. You might not have permission.')
    } finally {
      setCreating(false)
    }
  }, [draft, refresh])

  const handleToggle = React.useCallback(async (id: string, nextDone: boolean) => {
    setBusyId(id)
    setError(null)
    try {
      await toggleTodo(id, nextDone)
      await refresh()
    } catch (err) {
      console.error('Failed to update todo from widget', err)
      setError('Unable to update todo. You might not have permission.')
    } finally {
      setBusyId(null)
    }
  }, [refresh])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void handleCreate()
    }
  }, [handleCreate])

  if (mode === 'settings') {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="todo-page-size" className="text-xs font-medium uppercase text-muted-foreground">
            Items to show
          </label>
          <input
            id="todo-page-size"
            type="number"
            min={1}
            max={20}
            className="w-24 rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={value.pageSize}
            onChange={(event) => onSettingsChange({ ...value, pageSize: Number(event.target.value) })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.showCompleted}
            onChange={(event) => onSettingsChange({ ...value, showCompleted: event.target.checked })}
          />
          Show completed items
        </label>
        <p className="text-xs text-muted-foreground">
          Widget saves these preferences per user layout. They do not impact the shared todos list.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 rounded-md border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Add a todo"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={creating}
        />
        <Button type="button" onClick={() => void handleCreate()} disabled={creating || !draft.trim()}>
          {creating ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
      {loading ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <ul className="space-y-2">
          {items.length === 0 ? (
            <li className="rounded-md border bg-muted/40 px-3 py-6 text-sm text-muted-foreground text-center">
              {value.showCompleted ? 'No todos found.' : 'All caught up!'}
            </li>
          ) : null}
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
            >
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={item.is_done}
                  onChange={(event) => void handleToggle(item.id, event.target.checked)}
                  disabled={busyId === item.id}
                />
                <span className={item.is_done ? 'line-through text-muted-foreground' : ''}>{item.title}</span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleToggle(item.id, !item.is_done)}
                disabled={busyId === item.id}
              >
                {busyId === item.id ? 'Saving…' : item.is_done ? 'Mark active' : 'Complete'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="text-xs text-muted-foreground">
        Widget shows the most recent todos from the Example module.
      </div>
    </div>
  )
}

const widget: DashboardWidgetModule<TodoSettings> = {
  metadata: {
    id: 'example.dashboard.todos',
    title: 'Todos',
    description: 'Stay on top of Example module todos and add new ones without leaving the dashboard.',
    features: ['dashboards.view', 'example.widgets.todo'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
  },
  Widget: TodoWidget,
  hydrateSettings: normalizeSettings,
  dehydrateSettings: (value) => ({
    pageSize: value.pageSize,
    showCompleted: value.showCompleted,
  }),
}

export default widget
