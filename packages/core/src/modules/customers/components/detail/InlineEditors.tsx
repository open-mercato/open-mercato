"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { FileCode, Loader2, Linkedin, Mail, Pencil, Phone, Twitter, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@open-mercato/ui/primitives/button'
import type { PluggableList } from 'unified'
import { PhoneNumberField } from '@open-mercato/ui/backend/inputs/PhoneNumberField'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import remarkGfm from 'remark-gfm'
import { useEmailDuplicateCheck } from '../../backend/hooks/useEmailDuplicateCheck'
import { lookupPhoneDuplicate } from '../../utils/phoneDuplicates'
import {
  DictionaryValue,
  ICON_SUGGESTIONS,
  renderDictionaryColor,
  renderDictionaryIcon,
  type CustomerDictionaryKind,
} from '../../lib/dictionaries'
import { DictionarySelectField } from '../formConfig'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { createDictionarySelectLabels, formatDateTime } from './utils'
import {
  invalidateCustomerDictionary,
  useCustomerDictionary,
} from './hooks/useCustomerDictionary'
import { LoadingMessage } from './LoadingMessage'

export type InlineFieldType = 'text' | 'email' | 'tel' | 'url'

export type InlineFieldProps = {
  label: string
  value: string | null | undefined
  placeholder: string
  emptyLabel: string
  type?: InlineFieldType
  validator?: (value: string) => string | null
  onSave: (value: string | null) => Promise<void>
  recordId?: string
  variant?: 'default' | 'muted' | 'plain'
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
  hideLabel?: boolean
  renderDisplay?: (params: { value: string | null | undefined; emptyLabel: string; type: InlineFieldType }) => React.ReactNode
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
    <LoadingMessage
      label={t('customers.people.detail.notes.editorLoading', 'Loading editor…')}
      className="min-h-[200px]"
    />
  )
}

const UiMarkdownEditor = dynamic(() => import('@uiw/react-md-editor'), {
  ssr: false,
  loading: () => <MarkdownEditorFallback />,
}) as unknown as React.ComponentType<UiMarkdownEditorProps>

export function InlineTextEditor({
  label,
  value,
  placeholder,
  emptyLabel,
  type = 'text',
  validator,
  onSave,
  recordId,
  variant = 'default',
  activateOnClick = false,
  containerClassName,
  triggerClassName,
  hideLabel = false,
  renderDisplay,
}: InlineFieldProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const trimmedDraft = React.useMemo(() => draft.trim(), [draft])
  const isEmailField = type === 'email'
  const isPhoneField = type === 'tel'
  const currentRecordId = React.useMemo(() => (typeof recordId === 'string' ? recordId : null), [recordId])
  const isValidEmailForLookup = React.useMemo(() => {
    if (!isEmailField) return false
    if (!trimmedDraft.length) return false
    if (!validator) return true
    return validator(trimmedDraft) === null
  }, [isEmailField, trimmedDraft, validator])
  const { duplicate, checking } = useEmailDuplicateCheck(draft, {
    recordId: currentRecordId,
    disabled: !editing || !isEmailField || !!error || saving || !isValidEmailForLookup,
    matchMode: 'prefix',
  })
  const formRef = React.useRef<HTMLFormElement | null>(null)
  const handlePhoneDuplicateLookup = React.useCallback(
    async (digits: string) => {
      if (!isPhoneField || !editing || !!error || saving) return null
      return lookupPhoneDuplicate(digits, { recordId: currentRecordId })
    },
    [currentRecordId, editing, error, isPhoneField, saving],
  )
  const containerClasses = cn(
    'group',
    variant === 'muted'
      ? 'relative rounded border bg-muted/20 p-3'
      : variant === 'plain'
        ? 'relative flex items-center gap-3 rounded-none border-0 p-0'
        : 'rounded-lg border p-4',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    containerClassName || null,
  )
  const readOnlyWrapperClasses = cn(
    'flex-1 min-w-0',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    variant === 'plain' ? 'flex items-center gap-2' : null,
  )
  const triggerSize = variant === 'plain' ? 'icon' : 'sm'
  const triggerClasses = cn(
    'shrink-0 transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    variant === 'muted' ? 'h-8 w-8' : null,
    variant === 'plain' ? 'mt-1' : null,
    triggerClassName || null,
  )

  const handleActivate = React.useCallback(() => {
    if (!editing) setEditing(true)
  }, [editing])

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
        } else {
          return
        }
      }
      handleActivate()
    },
    [activateOnClick, editing, handleActivate],
  )

  React.useEffect(() => {
    if (!editing) {
      setDraft(value ?? '')
    }
  }, [editing, value])

  const handleSave = React.useCallback(async () => {
    const trimmed = draft.trim()
    const finalValue = trimmed.length ? trimmed : ''
    if (validator) {
      const validationError = validator(finalValue)
      if (validationError) {
        setError(validationError)
        return
      }
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(finalValue.length ? finalValue : null)
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [draft, onSave, t, validator])

  const handleFormKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setEditing(false)
        return
      }
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
      event.preventDefault()
      if (saving) return
      if (!trimmedDraft.length && type !== 'email' && type !== 'tel' && type !== 'url') return
      try {
        formRef.current?.requestSubmit()
      } catch {
        // ignore environments without form.requestSubmit
      }
    },
    [saving, trimmedDraft, type],
  )

  const handleFormSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (saving) return
      void handleSave()
    },
    [handleSave, saving],
  )

  const displayContent = React.useMemo(() => {
    if (renderDisplay) {
      return renderDisplay({ value, emptyLabel, type })
    }
    const baseValue = value && typeof value === 'string' ? value : ''
    const anchorClass =
      variant === 'plain'
        ? 'inline-flex items-center gap-2 text-xl font-semibold leading-tight text-primary hover:text-primary/90 hover:underline'
        : 'flex items-center gap-2 text-sm text-primary hover:text-primary/90 hover:underline'
    const textClass = variant === 'plain' ? 'text-2xl font-semibold leading-tight' : 'text-sm break-words'
    if (type === 'email') {
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
    if (type === 'tel') {
      const sanitizedValue = baseValue.replace(/[^+\d]/g, '')
      const hrefValue = sanitizedValue.length ? sanitizedValue : baseValue
      return (
        <a className={anchorClass} href={`tel:${hrefValue}`}>
          <Phone aria-hidden className={variant === 'plain' ? 'h-5 w-5' : 'h-4 w-4'} />
          <span className="truncate">{baseValue}</span>
        </a>
      )
    }
    if (type === 'url') {
      return (
        <a className={textClass} href={baseValue} target="_blank" rel="noreferrer">
          {baseValue}
        </a>
      )
    }
    return <p className={textClass}>{baseValue}</p>
  }, [emptyLabel, renderDisplay, type, value, variant])

  const editingContainerClass = variant === 'plain' ? 'mt-0 w-full max-w-sm space-y-3' : 'mt-2 space-y-3'

  const activateListeners =
    activateOnClick && !editing
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick: handleInteractiveClick,
          onKeyDown: handleContainerKeyDown,
        }
      : {}

  return (
    <div className={containerClasses} onClick={handleInteractiveClick}>
      <div className="flex items-start justify-between gap-2">
        <div className={readOnlyWrapperClasses} {...activateListeners}>
          {hideLabel ? null : <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>}
          {editing ? (
            <form
              ref={formRef}
              className={editingContainerClass}
              onSubmit={handleFormSubmit}
              onKeyDown={handleFormKeyDown}
            >
              {isPhoneField ? (
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
                  checkingLabel={t('customers.people.form.phoneChecking')}
                  duplicateLabel={(match) =>
                    t('customers.people.form.phoneDuplicateNotice', undefined, { name: match.label })
                  }
                  duplicateLinkLabel={t('customers.people.form.phoneDuplicateLink')}
                  onDuplicateLookup={handlePhoneDuplicateLookup}
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
                  type={type}
                  autoFocus
                />
              )}
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              {!error && isEmailField && duplicate ? (
                <p className="text-xs text-muted-foreground">
                  {t('customers.people.detail.inline.emailDuplicate', undefined, { name: duplicate.displayName })}{' '}
                  <Link
                    className="font-medium text-primary underline underline-offset-2"
                    href={`/backend/customers/people/${duplicate.id}`}
                  >
                    {t('customers.people.detail.inline.emailDuplicateLink')}
                  </Link>
                </p>
              ) : null}
              {!error && isEmailField && !duplicate && checking ? (
                <p className="text-xs text-muted-foreground">
                  {t('customers.people.detail.inline.emailChecking')}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('customers.people.detail.inline.saveShortcut')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {t('customers.people.detail.inline.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div className={variant === 'plain' ? '' : 'mt-1'}>{displayContent}</div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size={triggerSize}
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

export type InlineMultilineDisplayRenderer = (params: {
  value: string | null | undefined
  emptyLabel: string
}) => React.ReactNode

const MARKDOWN_PREVIEW_PLUGINS: PluggableList = [remarkGfm]

type InlineMultilineEditorProps = {
  label: string
  value: string | null | undefined
  placeholder: string
  emptyLabel: string
  onSave: (value: string | null) => Promise<void>
  validator?: (value: string) => string | null
  variant?: 'default' | 'muted'
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
  renderDisplay?: InlineMultilineDisplayRenderer
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
  const [draft, setDraft] = React.useState(() => (value && typeof value === 'string' ? value : ''))
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [isMarkdownEnabled, setIsMarkdownEnabled] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const markdownEditorRef = React.useRef<HTMLDivElement | null>(null)
  const containerClasses = cn(
    'group rounded-lg border p-4',
    variant === 'muted' ? 'bg-muted/20' : 'bg-card',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    containerClassName ?? null,
  )
  const triggerClasses = cn(
    'transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    variant === 'muted' ? 'h-8 w-8' : 'h-9 w-9',
    triggerClassName ?? null,
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
      setDraft(value && typeof value === 'string' ? value : '')
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
      const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [adjustError, draft, onSave, t])

  return (
    <div className={containerClasses} onClick={handleInteractiveClick}>
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn('flex-1', activateOnClick && !editing ? 'cursor-pointer' : null)}
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
                if (saving) return
                void handleSave()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  return
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!saving) {
                    void handleSave()
                  }
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
                    onChange={(value) => {
                      if (error) setError(null)
                      setDraft(typeof value === 'string' ? value : '')
                    }}
                    previewOptions={{ remarkPlugins: MARKDOWN_PREVIEW_PLUGINS }}
                  />
                </div>
              </div>
            ) : (
                <textarea
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
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('customers.people.detail.inline.saveShortcut')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {t('customers.people.detail.inline.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleMarkdownToggle}
                  aria-pressed={isMarkdownEnabled}
                  title={
                    isMarkdownEnabled
                      ? t('customers.people.detail.notes.markdownDisable')
                      : t('customers.people.detail.notes.markdownEnable')
                  }
                  aria-label={
                    isMarkdownEnabled
                      ? t('customers.people.detail.notes.markdownDisable')
                      : t('customers.people.detail.notes.markdownEnable')
                  }
                  className={cn('h-8 w-8', isMarkdownEnabled ? 'text-primary' : undefined)}
                  disabled={saving}
                >
                  <FileCode className="h-4 w-4" aria-hidden />
                  <span className="sr-only">
                    {isMarkdownEnabled
                      ? t('customers.people.detail.notes.markdownDisable')
                      : t('customers.people.detail.notes.markdownEnable')}
                  </span>
                </Button>
              </div>
            </form>
          ) : (
            <div className={cn('mt-1 text-sm break-words', renderDisplay ? null : 'whitespace-pre-wrap')}>
              {typeof value === 'string' && value.trim().length ? (
                renderDisplay ? (
                  renderDisplay({ value, emptyLabel })
                ) : (
                  value
                )
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

function createSocialRenderDisplay(IconComponent: typeof Linkedin): NonNullable<InlineFieldProps['renderDisplay']> {
  // eslint-disable-next-line react/display-name
  return ({ value, emptyLabel }) => {
    const raw = typeof value === 'string' ? value.trim() : ''
    if (!raw.length) {
      return <span className="text-sm text-muted-foreground">{emptyLabel}</span>
    }
    const display = raw.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
    return (
      <a
        className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/90 hover:underline"
        href={raw}
        target="_blank"
        rel="noreferrer"
      >
        <IconComponent aria-hidden className="h-4 w-4" />
        <span className="truncate">{display}</span>
      </a>
    )
  }
}

export const renderLinkedInDisplay = createSocialRenderDisplay(Linkedin)
export const renderTwitterDisplay = createSocialRenderDisplay(Twitter)

export const renderMultilineMarkdownDisplay: InlineMultilineDisplayRenderer = ({ value, emptyLabel }) => {
  const raw = typeof value === 'string' ? value : ''
  const trimmed = raw.trim()
  if (!trimmed.length) {
    return <span className="text-muted-foreground">{emptyLabel}</span>
  }
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_PREVIEW_PLUGINS}
      className="text-sm text-foreground [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs"
    >
      {raw}
    </ReactMarkdown>
  )
}

type DictionaryEditorProps = {
  label: string
  value: string | null | undefined
  emptyLabel: string
  onSave: (value: string | null) => Promise<void>
  kind: CustomerDictionaryKind
  variant?: 'default' | 'muted'
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
  selectClassName?: string
}

export function InlineDictionaryEditor({
  label,
  value,
  emptyLabel,
  onSave,
  kind,
  variant = 'default',
  activateOnClick = false,
  containerClassName,
  triggerClassName,
  selectClassName,
}: DictionaryEditorProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string | undefined>(value && value.length ? value : undefined)
  const [saving, setSaving] = React.useState(false)
  const translate = React.useCallback(
    (key: string, fallback: string) => {
      const result = t(key)
      return result === key ? fallback : result
    },
    [t],
  )
  const dictionaryLabels = React.useMemo(() => createDictionarySelectLabels(kind, translate), [kind, translate])
  const scopeVersion = useOrganizationScopeVersion()
  const dictionaryQuery = useCustomerDictionary(kind, scopeVersion)
  const dictionaryMap = dictionaryQuery.data?.map ?? null
  const containerClasses = cn(
    'group',
    variant === 'muted' ? 'relative rounded border bg-muted/20 p-3' : 'rounded-lg border p-4',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    containerClassName || null,
  )
  const readOnlyWrapperClasses = cn('flex-1', activateOnClick && !editing ? 'cursor-pointer' : null)
  const triggerClasses = cn(
    'shrink-0 transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    variant === 'muted' ? 'h-8 w-8' : null,
    triggerClassName || null,
  )
  const triggerSize: React.ComponentProps<typeof Button>['size'] = 'sm'

  const handleActivate = React.useCallback(() => {
    if (!editing) setEditing(true)
  }, [editing])

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
        } else {
          return
        }
      }
      handleActivate()
    },
    [activateOnClick, editing, handleActivate],
  )

  React.useEffect(() => {
    if (!editing) setDraft(value && value.length ? value : undefined)
  }, [editing, value])

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    try {
      await onSave(draft ?? null)
      await invalidateCustomerDictionary(queryClient, kind)
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [draft, kind, onSave, queryClient, t])

  const editingContainerClass = 'mt-2 space-y-3'
  const activateListeners =
    activateOnClick && !editing
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick: handleInteractiveClick,
          onKeyDown: handleContainerKeyDown,
        }
      : {}

  return (
    <div className={containerClasses} onClick={handleInteractiveClick}>
      <div className="flex items-start justify-between gap-2">
        <div className={readOnlyWrapperClasses} {...activateListeners}>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <div
              className={editingContainerClass}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  return
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!saving) {
                    void handleSave()
                  }
                }
              }}
            >
              <DictionarySelectField
                kind={kind}
                value={draft}
                onChange={setDraft}
                labels={dictionaryLabels}
                selectClassName={selectClassName}
              />
              {dictionaryQuery.isError ? (
                <p className="text-xs text-red-600">
                  {dictionaryQuery.error instanceof Error
                    ? dictionaryQuery.error.message
                    : translate('customers.people.form.dictionary.errorLoad', 'Failed to load options')}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('customers.people.detail.inline.saveShortcut')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {t('customers.people.detail.inline.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-sm">
              {dictionaryMap ? (
                <DictionaryValue
                  value={value}
                  map={dictionaryMap}
                  fallback={<span className="text-sm text-muted-foreground">{emptyLabel}</span>}
                  className="text-sm"
                  iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
                  iconClassName="h-4 w-4"
                  colorClassName="h-3 w-3 rounded-full"
                />
              ) : value && value.length ? (
                <span className="break-words text-sm">{value}</span>
              ) : dictionaryQuery.isLoading ? (
                <span className="text-sm text-muted-foreground">
                  {translate('customers.people.form.dictionary.loading', 'Loading…')}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">{emptyLabel}</span>
              )}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size={triggerSize}
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

export type NextInteractionPayload = {
  at: string
  name: string
  refId?: string | null
  icon?: string | null
  color?: string | null
}

type NextInteractionEditorProps = {
  label: string
  valueAt: string | null | undefined
  valueName: string | null | undefined
  valueRefId: string | null | undefined
  valueIcon: string | null | undefined
  valueColor: string | null | undefined
  emptyLabel: string
  onSave: (next: NextInteractionPayload | null) => Promise<void>
  activateOnClick?: boolean
}

export function InlineNextInteractionEditor({
  label,
  valueAt,
  valueName,
  valueRefId,
  valueIcon,
  valueColor,
  emptyLabel,
  onSave,
  activateOnClick = false,
}: NextInteractionEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draftDate, setDraftDate] = React.useState<string>(() => (valueAt ? valueAt.slice(0, 16) : ''))
  const [draftName, setDraftName] = React.useState(valueName ?? '')
  const [draftRefId, setDraftRefId] = React.useState(valueRefId ?? '')
  const [draftIcon, setDraftIcon] = React.useState(valueIcon ?? '')
  const [draftColor, setDraftColor] = React.useState<string | null>(valueColor ?? null)
  const [dateError, setDateError] = React.useState<string | null>(null)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement | null>(null)
  const dateErrorId = React.useId()
  const nameErrorId = React.useId()
  const containerClasses = cn('group relative rounded-lg border p-4', activateOnClick && !editing ? 'cursor-pointer' : null)
  const requiredMessage = React.useMemo(
    () => t('customers.people.detail.inline.required', 'This field is required'),
    [t],
  )

  React.useEffect(() => {
    if (!editing) {
      setDraftDate(valueAt ? valueAt.slice(0, 16) : '')
      setDraftName(valueName ?? '')
      setDraftRefId(valueRefId ?? '')
      setDraftIcon(valueIcon ?? '')
      setDraftColor(valueColor ?? null)
      setDateError(null)
      setNameError(null)
      setSubmitError(null)
    }
  }, [editing, valueAt, valueName, valueRefId, valueIcon, valueColor])

  const appearanceLabels = React.useMemo(
    () => ({
      colorLabel: t('customers.people.detail.inline.nextInteractionColorLabel'),
      colorHelp: t('customers.people.detail.inline.nextInteractionColorHelp'),
      colorClearLabel: t('customers.people.detail.inline.nextInteractionColorClear'),
      iconLabel: t('customers.people.detail.inline.nextInteractionIconLabel'),
      iconPlaceholder: t('customers.people.detail.inline.nextInteractionIconPlaceholder'),
      iconPickerTriggerLabel: t('customers.people.detail.inline.nextInteractionIconBrowse'),
      iconSearchPlaceholder: t('customers.people.detail.inline.nextInteractionIconSearchPlaceholder'),
      iconSearchEmptyLabel: t('customers.people.detail.inline.nextInteractionIconSearchEmpty'),
      iconSuggestionsLabel: t('customers.people.detail.inline.nextInteractionIconSuggestions'),
      iconClearLabel: t('customers.people.detail.inline.nextInteractionIconClear'),
      previewEmptyLabel: t('customers.people.detail.inline.nextInteractionAppearanceEmpty'),
    }),
    [t],
  )

  const handleSave = React.useCallback(async () => {
    setSubmitError(null)
    setDateError(null)
    setNameError(null)
    const trimmedName = draftName.trim()
    let hasError = false
    if (!draftDate) {
      setDateError(requiredMessage)
      hasError = true
    }
    if (!trimmedName.length) {
      setNameError(requiredMessage)
      hasError = true
    }
    if (hasError) return
    const parsedDate = new Date(draftDate)
    if (Number.isNaN(parsedDate.getTime())) {
      setDateError(t('customers.people.detail.inline.nextInteractionInvalid'))
      return
    }
    const iso = parsedDate.toISOString()
    const trimmedRef = draftRefId.trim()
    const trimmedIcon = draftIcon.trim()
    const normalizedColor = (() => {
      if (!draftColor) return null
      const trimmed = draftColor.trim().toLowerCase()
      return /^#([0-9a-f]{6})$/.test(trimmed) ? trimmed : null
    })()
    setSaving(true)
    try {
      await onSave({
        at: iso,
        name: trimmedName,
        refId: trimmedRef.length ? trimmedRef : null,
        icon: trimmedIcon.length ? trimmedIcon : null,
        color: normalizedColor,
      })
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
      setSubmitError(message)
    } finally {
      setSaving(false)
    }
  }, [draftColor, draftDate, draftIcon, draftName, draftRefId, onSave, requiredMessage, t])

  const handleFormSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (saving) return
      void handleSave()
    },
    [handleSave, saving],
  )

  const handleFormKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setEditing(false)
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (saving) return
        try {
          formRef.current?.requestSubmit()
        } catch {
          void handleSave()
        }
      }
    },
    [handleSave, saving],
  )

  const handleActivate = React.useCallback(() => {
    if (!editing) setEditing(true)
  }, [editing])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!activateOnClick || editing) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleActivate()
      }
    },
    [activateOnClick, editing, handleActivate],
  )

  const handleInteractiveClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!activateOnClick || editing) return
      const target = event.target as HTMLElement
      const interactiveElement = target.closest('button, input, select, textarea, a, [role=\"link\"]')
      if (interactiveElement) {
        if (interactiveElement.tagName.toLowerCase() === 'a') {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return
          }
          event.preventDefault()
        } else {
          return
        }
      }
      handleActivate()
    },
    [activateOnClick, editing, handleActivate],
  )

  const interactiveProps: React.HTMLAttributes<HTMLDivElement> =
    activateOnClick && !editing
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick: handleInteractiveClick,
          onKeyDown: handleKeyDown,
        }
      : {}

  return (
    <div className={containerClasses} onClick={handleInteractiveClick}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          'absolute right-3 top-3 transition-opacity duration-150',
          editing
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
        )}
        onClick={(event) => {
          event.stopPropagation()
          setEditing((state) => !state)
        }}
      >
        {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
      </Button>
      <div className="flex items-start gap-2" {...interactiveProps}>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <form
              ref={formRef}
              className="mt-2 space-y-4"
              onSubmit={handleFormSubmit}
              onKeyDown={handleFormKeyDown}
            >
              <input
                type="datetime-local"
                className={cn(
                  'w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
                  dateError ? 'border-destructive focus:border-destructive focus:ring-destructive/40' : null,
                )}
                value={draftDate}
                aria-invalid={dateError ? 'true' : undefined}
                aria-required="true"
                aria-describedby={dateError ? dateErrorId : undefined}
                onChange={(event) => {
                  if (dateError) setDateError(null)
                  if (submitError) setSubmitError(null)
                  setDraftDate(event.target.value)
                }}
              />
              {dateError ? (
                <p id={dateErrorId} className="text-xs text-destructive">
                  {dateError}
                </p>
              ) : null}
              <input
                placeholder={t('customers.people.detail.inline.nextInteractionName')}
                className={cn(
                  'w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
                  nameError ? 'border-destructive focus:border-destructive focus:ring-destructive/40' : null,
                )}
                value={draftName}
                aria-invalid={nameError ? 'true' : undefined}
                aria-required="true"
                aria-describedby={nameError ? nameErrorId : undefined}
                onChange={(event) => {
                  if (submitError) setSubmitError(null)
                  if (nameError) setNameError(null)
                  setDraftName(event.target.value)
                }}
              />
              {nameError ? (
                <p id={nameErrorId} className="text-xs text-destructive">
                  {nameError}
                </p>
              ) : null}
              <input
                placeholder={t('customers.people.detail.inline.nextInteractionRef')}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draftRefId}
                onChange={(event) => {
                  if (submitError) setSubmitError(null)
                  setDraftRefId(event.target.value)
                }}
              />
              <AppearanceSelector
                icon={draftIcon || null}
                color={draftColor}
                onIconChange={(next) => {
                  if (submitError) setSubmitError(null)
                  setDraftIcon(next ?? '')
                }}
                onColorChange={(next) => {
                  if (submitError) setSubmitError(null)
                  setDraftColor(next)
                }}
                iconSuggestions={ICON_SUGGESTIONS}
                disabled={saving}
                labels={appearanceLabels}
              />
              {submitError && !dateError && !nameError ? (
                <p className="text-xs text-destructive">{submitError}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('customers.people.detail.inline.saveShortcut')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {t('customers.people.detail.inline.cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    setDraftDate('')
                    setDraftName('')
                    setDraftRefId('')
                    setDraftIcon('')
                    setDraftColor(null)
                    setDateError(null)
                    setNameError(null)
                    setSubmitError(null)
                    setSaving(true)
                    try {
                      await onSave(null)
                      setEditing(false)
                    } catch (err) {
                      const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
                      setSubmitError(message)
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={saving}
                >
                  {t('customers.people.detail.inline.clear')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-1 text-sm">
              {valueAt ? (
                <div className="flex items-start gap-3">
                  {valueIcon ? (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-card">
                      {renderDictionaryIcon(valueIcon, 'h-4 w-4')}
                    </span>
                  ) : null}
                  <div className="flex-1">
                    <span className="block">{formatDateTime(valueAt)}</span>
                    {valueName ? <span className="text-xs text-muted-foreground">{valueName}</span> : null}
                    {valueRefId ? <span className="text-xs text-muted-foreground">#{valueRefId}</span> : null}
                  </div>
                  {valueColor ? renderDictionaryColor(valueColor, 'h-3 w-3 rounded-full border border-border') : null}
                </div>
              ) : (
                <span className="text-muted-foreground">{emptyLabel}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
