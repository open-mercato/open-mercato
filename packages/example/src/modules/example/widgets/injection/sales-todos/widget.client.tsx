"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type TodoItem = {
  id: string
  title: string
  is_done: boolean
}

type WidgetContext = {
  kind?: 'order' | 'quote'
  record?: { id?: string; organizationId?: string | null; organization_id?: string | null }
}

export default function SalesTodosWidget({ context }: InjectionWidgetComponentProps<WidgetContext>) {
  const t = useT()
  const [items, setItems] = React.useState<TodoItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const organizationId =
    (context?.record as any)?.organizationId ??
    (context?.record as any)?.organization_id ??
    null

  const loadTodos = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ pageSize: '10' })
      if (organizationId) params.set('organizationId', organizationId)
      const call = await apiCallOrThrow<{ items?: TodoItem[] }>(`/api/example/todos?${params.toString()}`, {
        allowNullResult: true,
      })
      const list = Array.isArray(call.result?.items) ? call.result!.items! : []
      setItems(
        list.map((item) => ({
          id: String((item as any).id ?? ''),
          title: String((item as any).title ?? ''),
          is_done: Boolean((item as any).is_done),
        })),
      )
    } catch (err) {
      console.error('example.salesTodos.load', err)
      setError(t('example.widgets.salesTodos.loadError', 'Failed to load todos'))
    } finally {
      setLoading(false)
    }
  }, [organizationId, t])

  React.useEffect(() => {
    void loadTodos()
  }, [loadTodos])

  const toggleTodo = React.useCallback(
    async (id: string, next: boolean) => {
      try {
        await apiCallOrThrow('/api/example/todos', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, is_done: next }),
        })
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, is_done: next } : item)))
      } catch (err) {
        console.error('example.salesTodos.toggle', err)
        setError(t('example.widgets.salesTodos.toggleError', 'Unable to update todo'))
      }
    },
    [t],
  )

  const handleAdd = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      const title = draft.trim()
      if (!title.length) return
      setSaving(true)
      setError(null)
      try {
        const body: Record<string, unknown> = { title }
        if (organizationId) body.organizationId = organizationId
        const call = await apiCallOrThrow<{ result?: TodoItem }>('/api/example/todos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const created = call.result
        if (created?.id) {
          setItems((prev) => [{ id: String(created.id), title: String(created.title ?? title), is_done: !!created.is_done }, ...prev])
        } else {
          await loadTodos()
        }
        setDraft('')
      } catch (err) {
        console.error('example.salesTodos.add', err)
        setError(t('example.widgets.salesTodos.addError', 'Unable to add todo'))
      } finally {
        setSaving(false)
      }
    },
    [draft, loadTodos, organizationId, t],
  )

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <Alert>
        <AlertTitle>{t('example.widgets.salesTodos.title', 'Example widget')}</AlertTitle>
        <AlertDescription>
          {t(
            'example.widgets.salesTodos.description',
            'This tab is injected by the widget system. Manage todos here to see how extension points work.',
          )}{' '}
          <a className="text-primary underline" href="/docs/framework/admin-ui/widget-injection" target="_blank" rel="noreferrer">
            {t('example.widgets.salesTodos.docsLink', 'Read the docs')}
          </a>
        </AlertDescription>
      </Alert>
      <form className="flex items-center gap-2" onSubmit={handleAdd}>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('example.widgets.salesTodos.placeholder', 'New todo for this document')}
        />
        <Button type="submit" disabled={saving || !draft.trim()}>
          {saving ? t('example.widgets.salesTodos.saving', 'Adding…') : t('example.widgets.salesTodos.add', 'Add')}
        </Button>
      </form>
      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      {loading ? (
        <div className="text-sm text-muted-foreground">{t('example.widgets.salesTodos.loading', 'Loading todos…')}</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t('example.widgets.salesTodos.empty', 'No todos yet.')}</div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded border px-2 py-1.5">
              <Checkbox checked={item.is_done} onCheckedChange={(v) => toggleTodo(item.id, v === true)} />
              <span className={`text-sm ${item.is_done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {item.title || t('example.widgets.salesTodos.untitled', 'Untitled todo')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
