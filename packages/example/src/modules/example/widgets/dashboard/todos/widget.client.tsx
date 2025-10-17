"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { hydrateTodoSettings, type TodoSettings } from './config'

type TodoItem = {
  id: string
  title: string
  is_done: boolean
}

async function fetchTodos(settings: TodoSettings): Promise<TodoItem[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(settings.pageSize),
    sortField: 'created_at',
    sortDir: 'desc',
  })
  if (!settings.showCompleted) params.set('isDone', 'false')
  const res = await apiFetch(`/api/example/todos?${params.toString()}`)
  if (!res.ok) throw new Error(`Failed with status ${res.status}`)
  const json = await res.json().catch(() => ({}))
  const items = Array.isArray(json.items) ? json.items : []
  return items
    .map((candidate): TodoItem | null => {
      if (!candidate || typeof candidate !== 'object') return null
      const record = candidate as Record<string, unknown>
      const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : ''
      const title = typeof record.title === 'string' ? record.title : ''
      const isDoneValue = record.is_done ?? record.isDone
      const isDone = typeof isDoneValue === 'boolean' ? isDoneValue : Boolean(isDoneValue)
      if (!id || !title) return null
      return { id, title, is_done: isDone }
    })
    .filter((todo): todo is TodoItem => todo !== null)
}

async function createTodo(title: string): Promise<void> {
  const res = await apiFetch('/api/example/todos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`Failed with status ${res.status}`)
}

async function toggleTodo(id: string, isDone: boolean): Promise<void> {
  const res = await apiFetch('/api/example/todos', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, is_done: isDone }),
  })
  if (!res.ok) throw new Error(`Failed with status ${res.status}`)
}

const TodoWidgetClient: React.FC<DashboardWidgetComponentProps<TodoSettings>> = ({
  mode,
  settings,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const value = React.useMemo(() => hydrateTodoSettings(settings), [settings])
  const [items, setItems] = React.useState<TodoItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const next = await fetchTodos(value)
      setItems(next)
    } catch (err) {
      console.error('Failed to load todos widget data', err)
      setError(t('example.widgets.todo.error.load'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [onRefreshStateChange, t, value])

  React.useEffect(() => {
    refresh()
  }, [refresh, refreshToken])

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
      setError(t('example.widgets.todo.error.create'))
    } finally {
      setCreating(false)
    }
  }, [draft, refresh, t])

  const handleToggle = React.useCallback(async (id: string, nextDone: boolean) => {
    setBusyId(id)
    setError(null)
    try {
      await toggleTodo(id, nextDone)
      await refresh()
    } catch (err) {
      console.error('Failed to update todo from widget', err)
      setError(t('example.widgets.todo.error.update'))
    } finally {
      setBusyId(null)
    }
  }, [refresh, t])

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
            {t('example.widgets.todo.settings.itemsLabel')}
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
          {t('example.widgets.todo.settings.showCompleted')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('example.widgets.todo.settings.help')}
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
          placeholder={t('example.widgets.todo.input.placeholder')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={creating}
        />
        <Button type="button" onClick={() => void handleCreate()} disabled={creating || !draft.trim()}>
          {creating ? t('example.widgets.todo.actions.adding') : t('example.widgets.todo.actions.add')}
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
              {value.showCompleted ? t('example.widgets.todo.state.empty') : t('example.widgets.todo.state.allCaughtUp')}
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
                {busyId === item.id
                  ? t('example.widgets.todo.actions.saving')
                  : item.is_done
                    ? t('example.widgets.todo.actions.markActive')
                    : t('example.widgets.todo.actions.complete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="text-xs text-muted-foreground">
        {t('example.widgets.todo.footer')}
      </div>
    </div>
  )
}

export default TodoWidgetClient
