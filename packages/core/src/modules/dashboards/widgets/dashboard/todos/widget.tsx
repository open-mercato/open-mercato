import * as React from 'react'
import type { DashboardWidgetModule, DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { Button } from '@open-mercato/ui/primitives/button'

type TodoItem = {
  id: string
  title: string
  done: boolean
}

type TodoSettings = {
  items: TodoItem[]
}

const DEFAULT_SETTINGS: TodoSettings = {
  items: [],
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function normalizeSettings(raw: unknown): TodoSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const value = raw as Partial<TodoSettings>
  const items = Array.isArray(value.items) ? value.items : []
  return {
    items: items
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const id = typeof (item as any).id === 'string' ? (item as any).id : generateId()
        const title = typeof (item as any).title === 'string' ? (item as any).title : ''
        const done = typeof (item as any).done === 'boolean' ? (item as any).done : false
        if (!title.trim()) return null
        return { id, title, done }
      })
      .filter((item): item is TodoItem => !!item),
  }
}

function createItem(title: string): TodoItem {
  return { id: generateId(), title, done: false }
}

const TodoWidgetView: React.FC<DashboardWidgetComponentProps<TodoSettings>> = ({ mode, settings, onSettingsChange }) => {
  const resolved = React.useMemo(() => normalizeSettings(settings), [settings])
  const [draft, setDraft] = React.useState('')

  const updateItems = React.useCallback((nextItems: TodoItem[]) => {
    onSettingsChange({ items: nextItems })
  }, [onSettingsChange])

  const handleAdd = React.useCallback(() => {
    if (!draft.trim()) return
    const nextItems = [...resolved.items, createItem(draft.trim())]
    updateItems(nextItems)
    setDraft('')
  }, [draft, resolved.items, updateItems])

  const handleToggle = React.useCallback((id: string) => {
    const nextItems = resolved.items.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    updateItems(nextItems)
  }, [resolved.items, updateItems])

  const handleDelete = React.useCallback((id: string) => {
    const nextItems = resolved.items.filter((item) => item.id !== id)
    updateItems(nextItems)
  }, [resolved.items, updateItems])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleAdd()
    }
  }, [handleAdd])

  const handleClearCompleted = React.useCallback(() => {
    const nextItems = resolved.items.filter((item) => !item.done)
    updateItems(nextItems)
  }, [resolved.items, updateItems])

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a to-do item"
          className="flex-1 rounded-md border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button type="button" onClick={handleAdd} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      <ul className="space-y-2">
        {resolved.items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm"
          >
            <label className="flex flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => handleToggle(item.id)}
                className="size-4"
              />
              <span className={item.done ? 'line-through text-muted-foreground' : ''}>{item.title}</span>
            </label>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={() => handleDelete(item.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {resolved.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No tasks yet. Add your first to-do above.</p>
      )}

      {mode === 'settings' && resolved.items.some((item) => item.done) && (
        <div className="pt-2">
          <Button variant="outline" size="sm" onClick={handleClearCompleted}>
            Clear completed tasks
          </Button>
        </div>
      )}
    </div>
  )
}

const widget: DashboardWidgetModule<TodoSettings> = {
  metadata: {
    id: 'dashboards.todos',
    title: 'To-do list',
    description: 'Track lightweight tasks directly from your dashboard.',
    features: ['dashboards.view', 'dashboards.widgets.todo'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
  },
  Widget: TodoWidgetView,
  hydrateSettings: normalizeSettings,
  dehydrateSettings: (settings) => ({ items: settings.items.map((item) => ({ id: item.id, title: item.title, done: item.done })) }),
}

export default widget
