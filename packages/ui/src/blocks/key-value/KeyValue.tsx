"use client"

import * as React from 'react'
import { Check, ListX, Pencil, X } from 'lucide-react'
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
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
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

function formatDateValue(value: string, locale: string, withTime: boolean): string {
  const dateOnly = parseIsoDate(value)
  if (dateOnly) return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(dateOnly)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(locale, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(parsed)
}

function displayValue(item: KeyValueItem, locale: string): React.ReactNode {
  const { value } = item
  if (typeof value !== 'string') return value
  if (item.editor === 'select') {
    return item.options?.find((option) => option.value === value)?.label ?? value
  }
  const format = item.format ?? (item.editor === 'date' ? 'date' : 'text')
  if (format === 'text') return value
  return formatDateValue(value, locale, format === 'datetime')
}

type LayoutFlags = {
  horizontal: boolean
  bordered: boolean
  twoColumns: boolean
}

function rootClassName({ twoColumns }: LayoutFlags, className: string | undefined): string {
  return cn('flex flex-col gap-4', !twoColumns && 'max-w-2xl', className)
}

function listClassName({ bordered, twoColumns }: LayoutFlags): string {
  return cn(
    'grid grid-cols-1',
    twoColumns && 'md:grid-cols-2',
    bordered ? 'gap-px overflow-hidden rounded-lg border border-input bg-input' : cn(twoColumns && 'md:gap-x-gutter'),
  )
}

function rowClassName({ horizontal, bordered }: LayoutFlags, spanned: boolean): string {
  return cn(
    'group/key-value-row flex min-w-0',
    horizontal && !bordered && 'flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-4 sm:py-1',
    horizontal && bordered && 'flex-row items-start bg-card',
    !horizontal && 'flex-col gap-1',
    !horizontal && (bordered ? 'bg-card px-3 py-2' : 'py-2'),
    spanned && 'md:col-span-2',
  )
}

function labelClassName({ horizontal, bordered }: LayoutFlags, spanned: boolean, editing: boolean): string {
  return cn(
    'flex min-w-0 items-start gap-2 break-words text-sm text-muted-foreground',
    horizontal && !bordered && 'sm:w-1/3 sm:min-w-24 sm:max-w-40 sm:shrink-0',
    horizontal && bordered && 'w-2/5 max-w-40 shrink-0 self-stretch bg-muted/60 px-3 py-2 sm:w-1/3 sm:min-w-24',
    horizontal && spanned && 'md:w-1/6',
    horizontal && editing && (bordered ? 'pt-4' : 'sm:pt-2'),
  )
}

function valueCellClassName({ horizontal, bordered }: LayoutFlags, indented: boolean): string {
  return cn(
    'min-w-0 flex-1',
    bordered && horizontal && 'px-3 py-2',
    indented && !bordered && (horizontal ? 'max-sm:pl-6' : 'pl-6'),
    indented && bordered && !horizontal && 'pl-6',
  )
}

const SKELETON_ROWS = 4
const SKELETON_VALUE_WIDTHS = ['w-32', 'w-44', 'w-24', 'w-36']

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

function findEditableItem(items: KeyValueItem[], key: string | undefined, canEdit: boolean): KeyValueItem | null {
  if (!canEdit || key === undefined) return null
  return items.find((item) => item.key === key && item.editable === true) ?? null
}

export function KeyValue({
  items,
  columns = 1,
  layout = 'horizontal',
  bordered = false,
  onEdit,
  defaultEditingKey,
  footer,
  status,
  errorMessage,
  onRetry,
  emptyState,
  className,
}: KeyValueProps) {
  const t = useT()
  const locale = useLocale()
  const [initialEditingItem] = React.useState(() => findEditableItem(items, defaultEditingKey, onEdit !== undefined))
  const [editingKey, setEditingKey] = React.useState<string | null>(initialEditingItem?.key ?? null)
  const [draft, setDraft] = React.useState(() => (initialEditingItem ? initialDraft(initialEditingItem) : ''))
  const [pending, setPending] = React.useState(false)
  const [saveFailed, setSaveFailed] = React.useState(false)
  const idPrefix = React.useId()
  const editButtons = React.useRef(new Map<string, HTMLButtonElement>())
  const previousEditingKey = React.useRef<string | null>(editingKey)

  React.useEffect(() => {
    const previous = previousEditingKey.current
    if (previous === editingKey) return
    previousEditingKey.current = editingKey
    if (editingKey !== null) {
      document.getElementById(`${idPrefix}-editor-${editingKey}`)?.focus()
      return
    }
    if (previous !== null) editButtons.current.get(previous)?.focus()
  }, [editingKey, idPrefix])

  const startEdit = React.useCallback((item: KeyValueItem) => {
    setDraft(initialDraft(item))
    setSaveFailed(false)
    setEditingKey(item.key)
  }, [])

  const cancelEdit = React.useCallback(() => {
    if (pending) return
    setSaveFailed(false)
    setEditingKey(null)
  }, [pending])

  const saveEdit = React.useCallback(async () => {
    if (editingKey === null || pending || !onEdit) return
    setPending(true)
    setSaveFailed(false)
    try {
      await onEdit(editingKey, draft)
      setEditingKey(null)
    } catch {
      setSaveFailed(true)
    } finally {
      setPending(false)
    }
  }, [draft, editingKey, onEdit, pending])

  const flags: LayoutFlags = { horizontal: layout === 'horizontal', bordered, twoColumns: columns === 2 }

  if (status === 'loading') {
    const rowCount = items.length > 0 ? items.length : SKELETON_ROWS
    const spanLastSkeleton = bordered && flags.twoColumns && rowCount % 2 === 1
    return (
      <div data-slot="key-value" aria-busy="true" className={rootClassName(flags, className)}>
        <span className="sr-only">{t('ui.blocks.keyValue.loading', 'Loading')}</span>
        <div data-layout={layout} className={listClassName(flags)}>
          {Array.from({ length: rowCount }, (_, index) => {
            const spanned = spanLastSkeleton && index === rowCount - 1
            return (
              <div key={index} data-slot="key-value-skeleton-row" className={rowClassName(flags, spanned)}>
                <div className={labelClassName(flags, spanned, false)}>
                  <span className="flex h-5 items-center">
                    <Skeleton className="h-3.5 w-20" />
                  </span>
                </div>
                <div className={valueCellClassName(flags, false)}>
                  <span className="flex h-5 items-center">
                    <Skeleton className={cn('h-3.5', SKELETON_VALUE_WIDTHS[index % SKELETON_VALUE_WIDTHS.length])} />
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <ErrorMessage
        label={errorMessage ?? t('ui.blocks.keyValue.error', 'Something went wrong')}
        className={cn('max-w-xl rounded-md', className)}
        action={
          onRetry ? (
            <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={onRetry}>
              {t('ui.blocks.keyValue.retry', 'Try again')}
            </Button>
          ) : undefined
        }
      />
    )
  }
  if (status === 'empty' || items.length === 0) {
    if (emptyState) return <div className={className}>{emptyState}</div>
    return (
      <EmptyState
        size="sm"
        icon={<ListX aria-hidden />}
        title={t('ui.blocks.keyValue.empty', 'Nothing to show')}
        description={t('ui.blocks.keyValue.emptyDescription', 'Details will appear here once they are added.')}
        className={cn('items-start text-left px-0', className)}
      />
    )
  }

  const spanLast = bordered && flags.twoColumns && items.length % 2 === 1

  return (
    <div data-slot="key-value" className={rootClassName(flags, className)}>
      <dl data-layout={layout} className={listClassName(flags)}>
        {items.map((item, index) => {
          const editing = editingKey === item.key
          const spanned = spanLast && index === items.length - 1
          const indented = item.icon !== undefined && item.icon !== null
          return (
            <div key={item.key} data-slot="key-value-row" className={rowClassName(flags, spanned)}>
              <dt className={labelClassName(flags, spanned, editing)}>
                {item.icon ? (
                  <span aria-hidden className="flex h-5 w-4 shrink-0 items-center justify-center *:size-4">
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0">{item.label}</span>
              </dt>
              {editing ? (
                <dd className={valueCellClassName(flags, indented)}>
                  <form
                    data-slot="key-value-editor"
                    className="flex max-w-md flex-col gap-2"
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
                    {saveFailed ? (
                      <p role="alert" className="text-xs text-status-error-text">
                        {t('ui.blocks.keyValue.saveError', 'Could not save. Try again.')}
                      </p>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <Button type="submit" size="sm" className="max-sm:h-10" disabled={pending}>
                        {pending ? <Spinner size="sm" /> : <Check aria-hidden />}
                        {t('ui.blocks.keyValue.save', 'Save')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="max-sm:h-10" disabled={pending} onClick={cancelEdit}>
                        <X aria-hidden />
                        {t('ui.blocks.keyValue.cancel', 'Cancel')}
                      </Button>
                    </div>
                  </form>
                </dd>
              ) : (
                <dd className={cn('flex items-start gap-1', valueCellClassName(flags, indented))}>
                  <div className="min-w-0">
                    <div className="break-words text-sm text-foreground">
                      {displayValue(item, locale)}
                    </div>
                    {item.hint ? <p data-slot="key-value-hint" className="text-xs leading-4 text-muted-foreground">{item.hint}</p> : null}
                  </div>
                  {item.editable ? (
                    <IconButton
                      variant="ghost"
                      size="default"
                      className="-my-2 shrink-0 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/key-value-row:opacity-100"
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
                </dd>
              )}
            </div>
          )
        })}
      </dl>
      {footer ? <div data-slot="key-value-footer">{footer}</div> : null}
    </div>
  )
}
