"use client"

import * as React from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import type { KeyValueItem, KeyValueProps } from '../contracts/key-value'

function initialDraft(item: KeyValueItem): string {
  const { value } = item
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (item.editor === 'select' && !item.options?.some((option) => option.value === raw)) {
    const byLabel = item.options?.find((option) => option.label === raw)
    return byLabel ? byLabel.value : raw
  }
  return raw
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function formatIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function displayValue(item: KeyValueItem, locale: string): React.ReactNode {
  const { value } = item
  if (typeof value !== 'string') return value
  if (item.editor === 'select') {
    return item.options?.find((option) => option.value === value)?.label ?? value
  }
  if (item.editor === 'date') {
    const date = parseIsoDate(value)
    return date ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date) : value
  }
  return value
}

type EditorFieldProps = {
  fieldId: string
  item: KeyValueItem
  draft: string
  pending: boolean
  onChange: (next: string) => void
}

function EditorField({ fieldId, item, draft, pending, onChange }: EditorFieldProps) {
  if (item.editor === 'textarea') {
    return (
      <Textarea
        id={fieldId}
        aria-label={item.label}
        value={draft}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }
  if (item.editor === 'select') {
    return (
      <Select value={draft} disabled={pending} onValueChange={onChange}>
        <SelectTrigger id={fieldId} aria-label={item.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(item.options ?? []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (item.editor === 'date') {
    return (
      <DatePicker
        id={fieldId}
        aria-label={item.label}
        value={parseIsoDate(draft)}
        disabled={pending}
        footer="none"
        onChange={(next) => onChange(next ? formatIsoDate(next) : '')}
      />
    )
  }
  return (
    <Input
      id={fieldId}
      aria-label={item.label}
      value={draft}
      disabled={pending}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function KeyValue({
  items,
  columns = 1,
  onEdit,
  footer,
  status,
  errorMessage,
  emptyState,
  className,
}: KeyValueProps) {
  const t = useT()
  const locale = useLocale()
  const [editingKey, setEditingKey] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const idPrefix = React.useId()
  const editButtons = React.useRef(new Map<string, HTMLButtonElement>())
  const previousEditingKey = React.useRef<string | null>(null)

  React.useEffect(() => {
    const previous = previousEditingKey.current
    previousEditingKey.current = editingKey
    if (editingKey !== null) {
      document.getElementById(`${idPrefix}-editor-${editingKey}`)?.focus()
      return
    }
    if (previous !== null) editButtons.current.get(previous)?.focus()
  }, [editingKey, idPrefix])

  const startEdit = React.useCallback((item: KeyValueItem) => {
    setDraft(initialDraft(item))
    setEditingKey(item.key)
  }, [])

  const cancelEdit = React.useCallback(() => {
    if (pending) return
    setEditingKey(null)
  }, [pending])

  const saveEdit = React.useCallback(async () => {
    if (editingKey === null || pending || !onEdit) return
    setPending(true)
    try {
      await onEdit(editingKey, draft)
      setEditingKey(null)
    } catch {
      return
    } finally {
      setPending(false)
    }
  }, [draft, editingKey, onEdit, pending])

  if (status === 'loading') {
    return <LoadingMessage label={t('ui.blocks.keyValue.loading', 'Loading')} className={className} />
  }
  if (status === 'error') {
    return (
      <ErrorMessage
        label={errorMessage ?? t('ui.blocks.keyValue.error', 'Something went wrong')}
        className={className}
      />
    )
  }
  if (status === 'empty' || items.length === 0) {
    return (
      <div className={className}>
        {emptyState ?? <EmptyState title={t('ui.blocks.keyValue.empty', 'Nothing to show')} />}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <dl className={cn('grid grid-cols-1 gap-4', columns === 2 && 'md:grid-cols-2')}>
        {items.map((item) => {
          const editing = editingKey === item.key
          return (
            <div key={item.key} className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <dt className="min-w-0 break-words text-xs uppercase tracking-wide text-muted-foreground">{item.label}</dt>
                {item.editable && !editing ? (
                  <IconButton
                    variant="ghost"
                    size="xs"
                    className="shrink-0"
                    ref={(node: HTMLButtonElement | null) => {
                      if (node) editButtons.current.set(item.key, node)
                      else editButtons.current.delete(item.key)
                    }}
                    aria-label={t('ui.blocks.keyValue.edit', 'Edit {label}', { label: item.label })}
                    disabled={pending}
                    onClick={() => startEdit(item)}
                  >
                    <Pencil aria-hidden />
                  </IconButton>
                ) : null}
              </div>
              {editing ? (
                <dd className="mt-1">
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void saveEdit()
                    }}
                    onKeyDown={(event) => {
                      if (event.defaultPrevented) return
                      if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        cancelEdit()
                        return
                      }
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        event.stopPropagation()
                        void saveEdit()
                      }
                    }}
                  >
                    <EditorField fieldId={`${idPrefix}-editor-${item.key}`} item={item} draft={draft} pending={pending} onChange={setDraft} />
                    <div className="flex items-center gap-2">
                      <Button type="submit" size="sm" disabled={pending}>
                        {pending ? <Spinner size="sm" /> : <Check aria-hidden />}
                        {t('ui.blocks.keyValue.save', 'Save')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={cancelEdit}>
                        <X aria-hidden />
                        {t('ui.blocks.keyValue.cancel', 'Cancel')}
                      </Button>
                    </div>
                  </form>
                </dd>
              ) : (
                <dd className="mt-1 min-w-0 break-words text-sm text-foreground">{displayValue(item, locale)}</dd>
              )}
              {item.hint ? <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p> : null}
            </div>
          )
        })}
      </dl>
      {footer ? <div>{footer}</div> : null}
    </div>
  )
}
