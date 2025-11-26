"use client"

import * as React from 'react'
import { Loader2, Pencil, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

type EditorVariant = 'default' | 'muted' | 'plain'

export type InlineTextEditorProps = {
  label: string
  value: string | null | undefined
  placeholder?: string
  emptyLabel: string
  onSave: (value: string | null) => Promise<void>
  inputType?: React.HTMLInputTypeAttribute
  validator?: (value: string) => string | null
  variant?: EditorVariant
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
  hideLabel?: boolean
  renderDisplay?: (params: { value: string | null | undefined; emptyLabel: string; type?: string }) => React.ReactNode
  onEditingChange?: (editing: boolean) => void
  renderActions?: React.ReactNode
}

export function InlineTextEditor({
  label,
  value,
  placeholder,
  emptyLabel,
  onSave,
  inputType = 'text',
  validator,
  variant = 'default',
  activateOnClick = false,
  containerClassName,
  triggerClassName,
  hideLabel = false,
  renderDisplay,
  onEditingChange,
  renderActions,
}: InlineTextEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [editing, value])

  const containerClasses = cn(
    'group',
    variant === 'muted'
      ? 'relative rounded border bg-muted/30 p-3'
      : variant === 'plain'
        ? 'relative flex flex-col gap-1 rounded-none border-0 p-0'
        : 'rounded-lg border bg-card p-4',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    containerClassName ?? null,
  )
  const triggerClasses = cn(
    'shrink-0 transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    variant === 'muted' ? 'h-8 w-8' : null,
    triggerClassName ?? null,
  )

  const setEditingSafe = React.useCallback(
    (next: boolean) => {
      setEditing(next)
      if (onEditingChange) onEditingChange(next)
    },
    [onEditingChange],
  )

  const handleSave = React.useCallback(async () => {
    const trimmed = draft.trim()
    if (validator) {
      const validationError = validator(trimmed)
      if (validationError) {
        setError(validationError)
        return
      }
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(trimmed.length ? trimmed : null)
      setEditingSafe(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('ui.detail.inline.error', 'Failed to save value.')
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [draft, onSave, t, validator, setEditingSafe])

  const interactiveProps: React.HTMLAttributes<HTMLDivElement> =
    activateOnClick && !editing
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick: () => setEditing(true),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setEditing(true)
            }
          },
        }
      : {}

  return (
    <div className={containerClasses}>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0" {...interactiveProps}>
          {hideLabel ? null : <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>}
          {editing ? (
            <form
              className={variant === 'plain' ? 'space-y-2 pt-1' : 'mt-2 space-y-2'}
              onSubmit={(event) => {
                event.preventDefault()
                if (!saving) void handleSave()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditingSafe(false)
                  setError(null)
                  return
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!saving) void handleSave()
                }
              }}
            >
              <input
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft}
                onChange={(event) => {
                  if (error) setError(null)
                  setDraft(event.target.value)
                }}
                placeholder={placeholder}
                type={inputType}
                autoFocus
              />
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('ui.detail.inline.saveShortcut', 'Save (Ctrl/Cmd + Enter)')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingSafe(false)} disabled={saving}>
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div className={variant === 'plain' ? 'flex items-center gap-2' : 'mt-1 text-sm'}>
              {renderDisplay ? (
                renderDisplay({ value, emptyLabel, type: inputType })
              ) : value && value.length ? (
                <span className={variant === 'plain' ? 'text-2xl font-semibold leading-tight' : 'break-words'}>
                  {value}
                </span>
              ) : (
                <span className="text-muted-foreground">{emptyLabel}</span>
              )}
            </div>
          )}
        </div>
        {renderActions ? <div className="flex items-center gap-2">{renderActions}</div> : null}
        <Button
          type="button"
          variant="ghost"
          size={variant === 'plain' ? 'icon' : 'sm'}
          className={triggerClasses}
          onClick={(event) => {
            event.stopPropagation()
            const next = !editing
            setEditingSafe(next)
          }}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

export type InlineMultilineEditorProps = {
  label: string
  value: string | null | undefined
  placeholder?: string
  emptyLabel: string
  onSave: (value: string | null) => Promise<void>
  validator?: (value: string) => string | null
  variant?: EditorVariant
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
  renderDisplay?: (params: { value: string | null | undefined; emptyLabel: string }) => React.ReactNode
}

export function InlineMultilineEditor({
  label,
  value,
  placeholder,
  emptyLabel,
  onSave,
  validator,
  variant = 'default',
  activateOnClick = false,
  containerClassName,
  triggerClassName,
  renderDisplay,
}: InlineMultilineEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [editing, value])

  const containerClasses = cn(
    'group rounded-lg border p-4',
    variant === 'muted' ? 'bg-muted/30' : 'bg-card',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    containerClassName ?? null,
  )
  const triggerClasses = cn(
    'transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    triggerClassName ?? null,
  )

  const handleSave = React.useCallback(async () => {
    const trimmed = draft.trim()
    if (validator) {
      const validationError = validator(trimmed)
      if (validationError) {
        setError(validationError)
        return
      }
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(trimmed.length ? trimmed : null)
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('ui.detail.inline.error', 'Failed to save value.')
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [draft, onSave, t, validator])

  return (
    <div className={containerClasses}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <form
              className="mt-2 space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (!saving) void handleSave()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  setError(null)
                  return
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!saving) void handleSave()
                }
              }}
            >
              <Textarea
                value={draft}
                onChange={(event) => {
                  if (error) setError(null)
                  setDraft(event.target.value)
                }}
                placeholder={placeholder}
                className="min-h-[96px]"
                autoFocus
              />
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('ui.detail.inline.saveShortcut', 'Save (Ctrl/Cmd + Enter)')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-1 text-sm whitespace-pre-wrap">
              {renderDisplay ? (
                renderDisplay({ value, emptyLabel })
              ) : value && value.length ? (
                <span>{value}</span>
              ) : (
                <span className="text-muted-foreground">{emptyLabel}</span>
              )}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={triggerClasses}
          onClick={(event) => {
            event.stopPropagation()
            setEditing((state) => !state)
          }}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

export type InlineSelectOption = { value: string; label: string; description?: string }

export type InlineSelectEditorProps = {
  label: string
  value: string | null | undefined
  emptyLabel: string
  options: InlineSelectOption[]
  onSave: (value: string | null) => Promise<void>
  variant?: EditorVariant
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
  hideLabel?: boolean
}

export function InlineSelectEditor({
  label,
  value,
  emptyLabel,
  options,
  onSave,
  variant = 'default',
  activateOnClick = false,
  containerClassName,
  triggerClassName,
  hideLabel = false,
}: InlineSelectEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string>(value ?? '')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [editing, value])

  const containerClasses = cn(
    'group',
    variant === 'muted'
      ? 'relative rounded border bg-muted/30 p-3'
      : variant === 'plain'
        ? 'relative flex flex-col gap-1 rounded-none border-0 p-0'
        : 'rounded-lg border bg-card p-4',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    containerClassName ?? null,
  )
  const triggerClasses = cn(
    'shrink-0 transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    variant === 'muted' ? 'h-8 w-8' : null,
    triggerClassName ?? null,
  )

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    try {
      await onSave(draft.length ? draft : null)
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('ui.detail.inline.error', 'Failed to save value.')
      console.error(message, err)
    } finally {
      setSaving(false)
    }
  }, [draft, onSave, t])

  const selected = options.find((option) => option.value === value)

  const interactiveProps: React.HTMLAttributes<HTMLDivElement> =
    activateOnClick && !editing
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick: () => setEditing(true),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setEditing(true)
            }
          },
        }
      : {}

  return (
    <div className={containerClasses}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0" {...interactiveProps}>
          {hideLabel ? null : <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>}
          {editing ? (
            <div className={variant === 'plain' ? 'space-y-2 pt-1' : 'mt-2 space-y-2'}>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              >
                <option value="">{t('ui.detail.inline.select.placeholder', 'Not set')}</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('ui.detail.inline.saveShortcut', 'Save (Ctrl/Cmd + Enter)')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className={variant === 'plain' ? 'flex items-center gap-2' : 'mt-1 text-sm'}>
              {selected ? (
                <div className="space-y-0.5">
                  <p className="font-medium leading-tight">{selected.label}</p>
                  {selected.description ? (
                    <p className="text-xs text-muted-foreground">{selected.description}</p>
                  ) : null}
                </div>
              ) : (
                <span className="text-muted-foreground">{emptyLabel}</span>
              )}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size={variant === 'plain' ? 'icon' : 'sm'}
          className={triggerClasses}
          onClick={(event) => {
            event.stopPropagation()
            setEditing((state) => !state)
          }}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
