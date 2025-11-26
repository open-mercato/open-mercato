"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { FileCode, Loader2, Mail, Pencil, Phone, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluggableList } from 'unified'
import { PhoneNumberField } from '@open-mercato/ui/backend/inputs/PhoneNumberField'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { LoadingMessage } from './LoadingMessage'
import { mapCrudServerErrorToFormErrors } from '../utils/serverErrors'

function resolveInlineErrorMessage(err: unknown, fallbackMessage: string): string {
  const { message, fieldErrors } = mapCrudServerErrorToFormErrors(err)
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors).find((text) => typeof text === 'string' && text.trim().length)
    : null
  if (typeof firstFieldError === 'string' && firstFieldError.trim().length) {
    return firstFieldError.trim()
  }
  if (typeof message === 'string' && message.trim().length) {
    return message.trim()
  }
  if (err instanceof Error && typeof err.message === 'string' && err.message.trim().length) {
    return err.message.trim()
  }
  if (typeof err === 'string' && err.trim().length) {
    return err.trim()
  }
  return fallbackMessage
}

type EditorVariant = 'default' | 'muted' | 'plain'

export type InlineFieldType = 'text' | 'email' | 'tel' | 'url'

export type InlineTextEditorProps = {
  label: string
  value: string | null | undefined
  placeholder?: string
  emptyLabel: string
  onSave: (value: string | null) => Promise<void>
  type?: InlineFieldType
  inputType?: React.HTMLInputTypeAttribute
  validator?: (value: string) => string | null
  variant?: EditorVariant
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
  hideLabel?: boolean
  renderDisplay?: (params: { value: string | null | undefined; emptyLabel: string; type: InlineFieldType }) => React.ReactNode
  onEditingChange?: (editing: boolean) => void
  renderActions?: React.ReactNode
  saveLabel?: string
  recordId?: string
  onDraftChange?: (draft: string) => void
  renderBelowInput?: (params: {
    draft: string
    resolvedType: InlineFieldType
    error: string | null
    saving: boolean
  }) => React.ReactNode
}

export function InlineTextEditor({
  label,
  value,
  placeholder,
  emptyLabel,
  onSave,
  type = 'text',
  inputType,
  validator,
  variant = 'default',
  activateOnClick = false,
  containerClassName,
  triggerClassName,
  hideLabel = false,
  renderDisplay,
  onEditingChange,
  renderActions,
  saveLabel,
  onDraftChange,
  renderBelowInput,
}: InlineTextEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const computedSaveLabel = saveLabel ?? t('ui.detail.inline.saveShortcut', 'Save ⌘⏎ / Ctrl+Enter')
  const fallbackError = React.useMemo(
    () => t('ui.detail.inline.error', 'Failed to save value.'),
    [t],
  )
  const resolvedType = React.useMemo<InlineFieldType>(() => {
    if (type && typeof type === 'string') return type
    if (inputType && typeof inputType === 'string') {
      const normalized = inputType.toLowerCase()
      if (normalized === 'email' || normalized === 'tel' || normalized === 'url') {
        return normalized as InlineFieldType
      }
    }
    return 'text'
  }, [inputType, type])

  React.useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [editing, value])

  React.useEffect(() => {
    if (onDraftChange) onDraftChange(draft)
  }, [draft, onDraftChange])

  const containerClasses = cn(
    'group',
    variant === 'muted'
      ? 'relative rounded border bg-muted/20 p-3'
      : variant === 'plain'
        ? 'relative flex items-center gap-3 rounded-none border-0 p-0'
        : 'rounded-lg border p-4',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    containerClassName ?? null,
  )
  const readOnlyWrapperClasses = cn(
    'flex-1 min-w-0',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    variant === 'plain' ? 'flex items-center gap-2' : null,
  )
  const triggerClasses = cn(
    'shrink-0 transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    variant === 'muted' ? 'h-8 w-8' : null,
    triggerClassName ?? null,
  )
  const triggerSize = variant === 'plain' ? 'icon' : 'sm'

  const setEditingSafe = React.useCallback(
    (next: boolean) => {
      setEditing(next)
      if (onEditingChange) onEditingChange(next)
    },
    [onEditingChange],
  )

  const handleActivate = React.useCallback(() => {
    if (!editing) setEditingSafe(true)
  }, [editing, setEditingSafe])

  const handleInteractiveClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!activateOnClick || editing) return
      const target = event.target as HTMLElement
      const interactiveElement = target.closest('button, input, select, textarea, a, [role="link"]')
      if (interactiveElement) {
        if (interactiveElement.tagName.toLowerCase() === 'a') {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return
          }
          event.preventDefault()
          // let the link click toggle edit mode instead of navigating away
        } else {
          return
        }
      }
      handleActivate()
    },
    [activateOnClick, editing, handleActivate],
  )

  const handleContainerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!activateOnClick || editing) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleActivate()
      }
    },
    [activateOnClick, editing, handleActivate],
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
      setError(resolveInlineErrorMessage(err, fallbackError))
    } finally {
      setSaving(false)
    }
  }, [draft, fallbackError, onSave, setEditingSafe, validator])

  const interactiveProps: React.HTMLAttributes<HTMLDivElement> =
    activateOnClick && !editing
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onKeyDown: handleContainerKeyDown,
        }
      : {}

  const displayContent = React.useMemo(() => {
    if (renderDisplay) {
      return renderDisplay({ value, emptyLabel, type: resolvedType })
    }
    const baseValue = value && typeof value === 'string' ? value : ''
    const anchorClass =
      variant === 'plain'
        ? 'inline-flex items-center gap-2 text-xl font-semibold leading-tight text-primary hover:text-primary/90 hover:underline'
        : 'flex items-center gap-2 text-sm text-primary hover:text-primary/90 hover:underline'
    const textClass = variant === 'plain' ? 'text-2xl font-semibold leading-tight' : 'text-sm break-words'
    if (resolvedType === 'email') {
      if (!baseValue.length) {
        return (
          <p className={variant === 'plain' ? 'text-base text-muted-foreground' : 'text-sm text-muted-foreground'}>
            {emptyLabel}
          </p>
        )
      }
      return (
        <a className={anchorClass} href={`mailto:${baseValue}`}>
          <Mail aria-hidden className={variant === 'plain' ? 'h-5 w-5' : 'h-4 w-4'} />
          <span className="truncate">{baseValue}</span>
        </a>
      )
    }
    if (!baseValue.length) {
      return (
        <p className={variant === 'plain' ? 'text-base text-muted-foreground' : 'text-sm text-muted-foreground'}>
          {emptyLabel}
        </p>
      )
    }
    if (resolvedType === 'tel') {
      const sanitizedValue = baseValue.replace(/[^+\d]/g, '')
      const hrefValue = sanitizedValue.length ? sanitizedValue : baseValue
      return (
        <a className={anchorClass} href={`tel:${hrefValue}`}>
          <Phone aria-hidden className={variant === 'plain' ? 'h-5 w-5' : 'h-4 w-4'} />
          <span className="truncate">{baseValue}</span>
        </a>
      )
    }
    if (resolvedType === 'url') {
      return (
        <a className={textClass} href={baseValue} target="_blank" rel="noreferrer">
          {baseValue}
        </a>
      )
    }
    return <p className={textClass}>{baseValue}</p>
  }, [emptyLabel, renderDisplay, resolvedType, value, variant])

  const editingContainerClass = variant === 'plain' ? 'mt-0 w-full max-w-sm space-y-3' : 'mt-2 space-y-3'

  return (
    <div className={containerClasses} onClick={handleInteractiveClick}>
      <div className="flex items-start justify-between gap-2">
        <div className={readOnlyWrapperClasses} {...interactiveProps}>
          {hideLabel ? null : <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>}
          {editing ? (
            <form
              className={editingContainerClass}
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
              {resolvedType === 'tel' ? (
                <PhoneNumberField
                  value={draft.length ? draft : undefined}
                  onValueChange={(next) => {
                    if (error) setError(null)
                    setDraft(next ?? '')
                  }}
                  placeholder={placeholder}
                  autoFocus
                  disabled={saving}
                  minDigits={7}
                />
              ) : (
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft}
                  onChange={(event) => {
                    if (error) setError(null)
                    setDraft(event.target.value)
                  }}
                  placeholder={placeholder}
                  type={resolvedType}
                  autoFocus
                />
              )}
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              {renderBelowInput ? renderBelowInput({ draft, resolvedType, error, saving }) : null}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {computedSaveLabel}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingSafe(false)} disabled={saving}>
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div className={variant === 'plain' ? '' : 'mt-1'}>{displayContent}</div>
          )}
        </div>
        {renderActions ? <div className="flex items-center gap-2">{renderActions}</div> : null}
        <Button
          type="button"
          variant="ghost"
          size={triggerSize}
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

type UiMarkdownEditorProps = {
  value?: string
  height?: number
  onChange?: (value?: string) => void
  previewOptions?: { remarkPlugins?: unknown[] }
}

function MarkdownEditorFallback() {
  const t = useT()
  return (
    <LoadingMessage label={t('ui.detail.inline.editorLoading', 'Loading editor…')} className="min-h-[200px] justify-center" />
  )
}

const UiMarkdownEditor = dynamic(() => import('@uiw/react-md-editor'), {
  ssr: false,
  loading: () => <MarkdownEditorFallback />,
}) as unknown as React.ComponentType<UiMarkdownEditorProps>

const MARKDOWN_PREVIEW_PLUGINS: PluggableList = [remarkGfm]

export function InlineMultilineEditor({
  label,
  value,
  placeholder,
  emptyLabel,
  onSave,
  validator,
  variant = 'default',
  activateOnClick = true,
  containerClassName,
  triggerClassName,
  renderDisplay,
}: InlineMultilineEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [isMarkdownEnabled, setIsMarkdownEnabled] = React.useState(true)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const markdownEditorRef = React.useRef<HTMLDivElement | null>(null)
  const fallbackError = React.useMemo(
    () => t('ui.detail.inline.error', 'Failed to save value.'),
    [t],
  )

  const adjustTextareaSize = React.useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [])

  React.useEffect(() => {
    adjustTextareaSize(textareaRef.current)
  }, [adjustTextareaSize, draft, isMarkdownEnabled])

  React.useEffect(() => {
    if (!editing) return
    if (isMarkdownEnabled) {
      const element = markdownEditorRef.current?.querySelector('textarea')
      if (!element) return
      window.requestAnimationFrame(() => {
        element.focus()
      })
      return
    }
    const element = textareaRef.current
    if (!element) return
    window.requestAnimationFrame(() => {
      adjustTextareaSize(element)
      element.focus()
    })
  }, [adjustTextareaSize, editing, isMarkdownEnabled])

  const handleMarkdownToggle = React.useCallback(() => {
    setIsMarkdownEnabled((prev) => !prev)
  }, [])

  React.useEffect(() => {
    if (!editing) {
      setDraft(value ?? '')
      setError(null)
    }
  }, [editing, value])

  const handleActivate = React.useCallback(() => {
    if (!editing) setEditing(true)
  }, [editing])

  const handleInteractiveClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!activateOnClick || editing) return
      const target = event.target as HTMLElement
      const interactiveElement = target.closest('button, input, select, textarea, a, [role="link"]')
      if (interactiveElement) {
        if (interactiveElement.tagName.toLowerCase() === 'a') {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return
          }
          event.preventDefault()
          // Links should not block activation; let the click toggle edit mode
        } else {
          return
        }
      }
      handleActivate()
    },
    [activateOnClick, editing, handleActivate],
  )

  const handleContainerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!activateOnClick || editing) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleActivate()
      }
    },
    [activateOnClick, editing, handleActivate],
  )

  const adjustError = React.useCallback(
    (nextValue: string) => {
      if (!validator) return null
      const trimmed = nextValue.trim()
      return validator(trimmed)
    },
    [validator],
  )

  const containerClasses = cn(
    'group rounded-lg border p-4',
    variant === 'muted' ? 'bg-muted/20' : null,
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
    const validationError = adjustError(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    try {
      await onSave(trimmed.length ? trimmed : null)
      setEditing(false)
    } catch (err) {
      setError(resolveInlineErrorMessage(err, fallbackError))
    } finally {
      setSaving(false)
    }
  }, [adjustError, draft, fallbackError, onSave])

  return (
    <div className={containerClasses} onClick={handleInteractiveClick}>
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn('flex-1 min-w-0', activateOnClick && !editing ? 'cursor-pointer' : null)}
          {...(activateOnClick && !editing
            ? { role: 'button' as const, tabIndex: 0, onKeyDown: handleContainerKeyDown }
            : {})}
        >
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
              {isMarkdownEnabled ? (
                <div
                  ref={markdownEditorRef}
                  className={cn(
                    'w-full rounded-md border border-muted-foreground/30 bg-background p-2',
                    saving ? 'pointer-events-none opacity-75' : null,
                  )}
                >
                  <div data-color-mode="light" className="w-full">
                    <UiMarkdownEditor
                      value={draft}
                      height={220}
                      onChange={(nextValue) => {
                        if (error) setError(null)
                        setDraft(typeof nextValue === 'string' ? nextValue : '')
                      }}
                      previewOptions={{ remarkPlugins: MARKDOWN_PREVIEW_PLUGINS }}
                    />
                  </div>
                </div>
              ) : (
                <Textarea
                  ref={textareaRef}
                  rows={3}
                  className="w-full resize-none overflow-hidden rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={placeholder}
                  value={draft}
                  onChange={(event) => {
                    if (error) setError(null)
                    setDraft(event.target.value)
                  }}
                  onInput={(event) => adjustTextareaSize(event.currentTarget)}
                  autoFocus
                  disabled={saving}
                />
              )}
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('ui.detail.inline.saveShortcut', 'Save ⌘⏎ / Ctrl+Enter')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleMarkdownToggle}
                  aria-pressed={isMarkdownEnabled}
                  title={
                    isMarkdownEnabled
                      ? t('ui.detail.inline.markdownDisable', 'Disable Markdown')
                      : t('ui.detail.inline.markdownEnable', 'Enable Markdown')
                  }
                  aria-label={
                    isMarkdownEnabled
                      ? t('ui.detail.inline.markdownDisable', 'Disable Markdown')
                      : t('ui.detail.inline.markdownEnable', 'Enable Markdown')
                  }
                  className={cn('h-8 w-8', isMarkdownEnabled ? 'text-primary' : undefined)}
                  disabled={saving}
                >
                  <FileCode className="h-4 w-4" aria-hidden />
                  <span className="sr-only">
                    {isMarkdownEnabled
                      ? t('ui.detail.inline.markdownDisable', 'Disable Markdown')
                      : t('ui.detail.inline.markdownEnable', 'Enable Markdown')}
                  </span>
                </Button>
              </div>
            </form>
          ) : (
            <div
              className={cn(
                'mt-1 text-sm break-words',
                renderDisplay ? null : 'whitespace-pre-wrap',
                activateOnClick && !editing ? 'cursor-pointer' : null,
              )}
            >
              {renderDisplay ? (
                renderDisplay({ value, emptyLabel })
              ) : value && value.length ? (
                <ReactMarkdown
                  remarkPlugins={MARKDOWN_PREVIEW_PLUGINS}
                  className="prose prose-sm max-w-none text-foreground [&>*]:my-2 [&>*:last-child]:mb-0 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5"
                >
                  {value}
                </ReactMarkdown>
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
  renderEditor?: (params: { value: string; onChange: (next: string) => void }) => React.ReactNode
  renderDisplay?: (params: { value: string | null | undefined; emptyLabel: string }) => React.ReactNode
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
  renderEditor,
  renderDisplay,
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
              {renderEditor ? (
                renderEditor({ value: draft, onChange: setDraft })
              ) : (
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
              )}
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('ui.detail.inline.saveShortcut', 'Save ⌘⏎ / Ctrl+Enter')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className={variant === 'plain' ? 'flex items-center gap-2' : 'mt-1 text-sm'}>
              {renderDisplay ? (
                renderDisplay({ value, emptyLabel })
              ) : selected ? (
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
