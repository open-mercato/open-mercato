"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { PhoneNumberField } from '@open-mercato/ui/backend/inputs/PhoneNumberField'
import { Button } from '@open-mercato/ui/primitives/button'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { FileCode, Linkedin, Loader2, Mail, Pencil, Phone, Plus, Twitter, X } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import {
  DictionarySelectField,
} from '../../../../components/formConfig'
import {
  ActivitiesSection,
} from '../../../../components/detail/ActivitiesSection'
import {
  NotesSection,
} from '../../../../components/detail/NotesSection'
import {
  TagsSection,
  type TagOption,
} from '../../../../components/detail/TagsSection'
import { DealsSection } from '../../../../components/detail/DealsSection'
import { AddressesSection } from '../../../../components/detail/AddressesSection'
import { TasksSection } from '../../../../components/detail/TasksSection'
import { PersonHighlights } from '../../../../components/detail/PersonHighlights'
import {
  formatDateTime,
  formatDate,
  formatRelativeTime,
  resolveTodoHref,
  resolveTodoApiPath,
  toLocalDateTimeInput,
} from '../../../../components/detail/utils'
import type {
  ActivitySummary,
  AddressSummary,
  CommentSummary,
  DealSummary,
  TagSummary,
  TodoLinkSummary,
  Translator,
  SectionAction,
  TabEmptyState,
} from '../../../../components/detail/types'
import type { ActivityFormSubmitPayload } from '../../../../components/detail/ActivityForm'
import { type DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import {
  ICON_SUGGESTIONS,
  DictionaryValue,
  createDictionaryMap,
  normalizeDictionaryEntries,
  renderDictionaryColor,
  renderDictionaryIcon,
  type CustomerDictionaryKind,
  type CustomerDictionaryMap,
} from '../../../../lib/dictionaries'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../../../lib/markdownPreference'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { type CustomerAddressInput } from '../../../../components/AddressTiles'
import { useEmailDuplicateCheck } from '../../../hooks/useEmailDuplicateCheck'
import { lookupPhoneDuplicate } from '../../../../utils/phoneDuplicates'
import { CustomDataSection } from '../../../../components/detail/CustomDataSection'

type PersonOverview = {
  person: {
    id: string
    displayName: string
    description?: string | null
    primaryEmail?: string | null
    primaryPhone?: string | null
    status?: string | null
    lifecycleStage?: string | null
    source?: string | null
    nextInteractionAt?: string | null
    nextInteractionName?: string | null
    nextInteractionRefId?: string | null
    nextInteractionIcon?: string | null
    nextInteractionColor?: string | null
    organizationId?: string | null
  }
  profile: {
    id: string
    firstName?: string | null
    lastName?: string | null
    preferredName?: string | null
    jobTitle?: string | null
    department?: string | null
    seniority?: string | null
    timezone?: string | null
    linkedInUrl?: string | null
    twitterUrl?: string | null
    companyEntityId?: string | null
  } | null
  customFields: Record<string, unknown>
  tags: TagSummary[]
  addresses: AddressSummary[]
  comments: CommentSummary[]
  activities: ActivitySummary[]
  deals: DealSummary[]
  todos: TodoLinkSummary[]
  viewer?: {
    userId: string | null
    name?: string | null
    email?: string | null
  } | null
}

type SectionKey = 'notes' | 'activities' | 'deals' | 'addresses' | 'tasks'

function cn(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(' ')
}




function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `tmp-${Math.random().toString(36).slice(2)}`
}

function slugifyTagLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `tag-${Math.random().toString(36).slice(2, 10)}`
}

function isValidSocialUrl(
  rawValue: string,
  options: { hosts: string[]; pathRequired?: boolean },
): boolean {
  const { hosts, pathRequired = false } = options
  let parsed: URL
  try {
    parsed = new URL(rawValue)
  } catch {
    return false
  }
  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'https:' && protocol !== 'http:') {
    return false
  }
  const hostname = parsed.hostname.toLowerCase()
  const matchesHost = hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  if (!matchesHost) {
    return false
  }
  if (!pathRequired) {
    return true
  }
  const normalizedPath = parsed.pathname.replace(/\/+/g, '/').replace(/^\/|\/$/g, '')
  return normalizedPath.length > 0
}

type InlineFieldType = 'text' | 'email' | 'tel' | 'url'

type InlineFieldProps = {
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

function InlineTextEditor({
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
    [currentRecordId, editing, error, isPhoneField, saving]
  )
  const containerClasses = cn(
    'group',
    variant === 'muted'
      ? 'relative rounded border bg-muted/20 p-3'
      : variant === 'plain'
        ? 'relative flex items-center gap-3 rounded-none border-0 p-0'
        : 'rounded-lg border p-4',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    containerClassName || null
  )
  const readOnlyWrapperClasses = cn(
    'flex-1 min-w-0',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    variant === 'plain' ? 'flex items-center gap-2' : null
  )
  const triggerSize = variant === 'plain' ? 'icon' : 'sm'
  const triggerClasses = cn(
    'shrink-0 transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    variant === 'muted' ? 'h-8 w-8' : null,
    variant === 'plain' ? 'mt-1' : null,
    triggerClassName || null
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
    [activateOnClick, editing, handleActivate]
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
    [activateOnClick, editing, handleActivate]
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
      if (!trimmedDraft.length) return
      try {
        formRef.current?.requestSubmit()
      } catch {
        // ignore environments without form.requestSubmit
      }
    },
    [saving, trimmedDraft]
  )
  const handleFormSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (saving) return
      void handleSave()
    },
    [handleSave, saving]
  )

  const displayContent = React.useMemo(() => {
    if (renderDisplay) {
      return renderDisplay({ value, emptyLabel, type })
    }
    const baseValue = value && typeof value === 'string' ? value : ''
    const anchorClass = variant === 'plain' ? 'inline-flex items-center gap-2 text-xl font-semibold leading-tight text-primary hover:text-primary/90 hover:underline' : 'flex items-center gap-2 text-sm text-primary hover:text-primary/90 hover:underline'
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
        <a
          className={textClass}
          href={baseValue}
          target="_blank"
          rel="noreferrer"
        >
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
          {hideLabel ? null : (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          )}
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
                  duplicateLabel={(match) => t('customers.people.form.phoneDuplicateNotice', { name: match.label })}
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
                  {t('customers.people.detail.inline.emailDuplicate', { name: duplicate.displayName })}{' '}
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
}

function InlineMultilineEditor({
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
}: InlineMultilineEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [isMarkdownEnabled, setIsMarkdownEnabled] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const formRef = React.useRef<HTMLFormElement | null>(null)
  const containerClasses = cn(
    'group',
    variant === 'muted' ? 'relative rounded border bg-muted/20 p-3' : 'rounded-lg border p-4',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    containerClassName || null,
  )
  const readOnlyWrapperClasses = cn(
    'flex-1 min-w-0',
    activateOnClick && !editing ? 'cursor-pointer' : null,
  )
  const triggerClasses = cn(
    'shrink-0 transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    variant === 'muted' ? 'h-8 w-8' : null,
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

  React.useEffect(() => {
    const preference = readMarkdownPreferenceCookie()
    if (preference !== null) {
      setIsMarkdownEnabled(preference)
    }
  }, [])

  const adjustTextareaSize = React.useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [])

  React.useEffect(() => {
    if (!editing) return
    const frame = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      adjustTextareaSize(textarea)
      if (textarea) {
        textarea.focus()
        const end = textarea.value.length
        textarea.setSelectionRange(end, end)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [adjustTextareaSize, editing])

  React.useEffect(() => {
    if (!editing) return
    adjustTextareaSize(textareaRef.current)
  }, [adjustTextareaSize, draft, editing, isMarkdownEnabled])

  const handleMarkdownToggle = React.useCallback(() => {
    setIsMarkdownEnabled((prev) => {
      const next = !prev
      writeMarkdownPreferenceCookie(next)
      return next
    })
  }, [])

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
      if (!draft.trim()) return
      try {
        formRef.current?.requestSubmit()
      } catch {
        // ignore environments without form.requestSubmit
      }
    },
    [draft, saving]
  )

  const handleSave = React.useCallback(async () => {
    const normalized = draft.trim()
    if (validator) {
      const validationError = validator(normalized)
      if (validationError) {
        setError(validationError)
        return
      }
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(normalized.length ? normalized : null)
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [draft, onSave, t, validator])

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
            <form
              ref={formRef}
              className={editingContainerClass}
              onSubmit={(event) => {
                event.preventDefault()
                if (saving) return
                void handleSave()
              }}
              onKeyDown={handleFormKeyDown}
            >
              <div className="flex w-full items-center justify-end gap-2">
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
                  <FileCode className="h-4 w-4" />
                  <span className="sr-only">
                    {isMarkdownEnabled
                      ? t('customers.people.detail.notes.markdownDisable')
                      : t('customers.people.detail.notes.markdownEnable')}
                  </span>
                </Button>
              </div>
              <textarea
                ref={textareaRef}
                rows={isMarkdownEnabled ? 6 : 3}
                className={cn(
                  'w-full resize-none overflow-hidden rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
                  isMarkdownEnabled ? 'font-mono' : null,
                )}
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
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
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
            <div className="mt-1 text-sm whitespace-pre-wrap break-words">
              {value && typeof value === 'string' && value.trim().length ? (
                value
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

const renderLinkedInDisplay = createSocialRenderDisplay(Linkedin)
const renderTwitterDisplay = createSocialRenderDisplay(Twitter)

type DictionaryEditorProps = {
  label: string
  value: string | null | undefined
  emptyLabel: string
  labels: Parameters<typeof DictionarySelectField>[0]['labels']
  onSave: (value: string | null) => Promise<void>
  dictionaryMap?: CustomerDictionaryMap | null
  onAfterSave?: () => void | Promise<void>
  kind: CustomerDictionaryKind
  variant?: 'default' | 'muted'
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
  selectClassName?: string
}

function InlineDictionaryEditor({
  label,
  value,
  emptyLabel,
  labels,
  onSave,
  dictionaryMap,
  onAfterSave,
  kind,
  variant = 'default',
  activateOnClick = false,
  containerClassName,
  triggerClassName,
  selectClassName,
}: DictionaryEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string | undefined>(value && value.length ? value : undefined)
  const [saving, setSaving] = React.useState(false)
  const containerClasses = cn(
    'group',
    variant === 'muted' ? 'relative rounded border bg-muted/20 p-3' : 'rounded-lg border p-4',
    activateOnClick && !editing ? 'cursor-pointer' : null,
    containerClassName || null
  )
  const readOnlyWrapperClasses = cn(
    'flex-1',
    activateOnClick && !editing ? 'cursor-pointer' : null
  )
  const triggerClasses = cn(
    'shrink-0 transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    variant === 'muted' ? 'h-8 w-8' : null,
    triggerClassName || null
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
    [activateOnClick, editing, handleActivate]
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
    [activateOnClick, editing, handleActivate]
  )

  React.useEffect(() => {
    if (!editing) setDraft(value && value.length ? value : undefined)
  }, [editing, value])

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    try {
      await onSave(draft ?? null)
      if (onAfterSave) {
        await onAfterSave()
      }
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [draft, onAfterSave, onSave, t])

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
                labels={labels}
                selectClassName={selectClassName}
              />
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('customers.people.detail.inline.save')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  {t('customers.people.detail.inline.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-sm">
              <DictionaryValue
                value={value}
                map={dictionaryMap}
                fallback={<span className="text-sm text-muted-foreground">{emptyLabel}</span>}
                className="text-sm"
                iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
                iconClassName="h-4 w-4"
                colorClassName="h-3 w-3 rounded-full"
              />
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

type DetailFieldCommon = {
  key: string
  label: string
  emptyLabel: string
  gridClassName?: string
}

type DetailFieldConfig =
  | (DetailFieldCommon & {
      kind: 'text'
      value: string | null | undefined
      placeholder: string
      onSave: (value: string | null) => Promise<void>
      inputType?: InlineFieldType
      validator?: (value: string) => string | null
      renderDisplay?: InlineFieldProps['renderDisplay']
    })
  | (DetailFieldCommon & {
      kind: 'multiline'
      value: string | null | undefined
      placeholder: string
      onSave: (value: string | null) => Promise<void>
      validator?: (value: string) => string | null
    })
  | (DetailFieldCommon & {
      kind: 'dictionary'
      value: string | null | undefined
      dictionaryKind: CustomerDictionaryKind
      labels: Parameters<typeof DictionarySelectField>[0]['labels']
      onSave: (value: string | null) => Promise<void>
      dictionaryMap?: CustomerDictionaryMap | null
      onAfterSave?: () => void | Promise<void>
      selectClassName?: string
    })

type ProfileEditableField = 'firstName' | 'lastName' | 'jobTitle' | 'department' | 'linkedInUrl' | 'twitterUrl'

type NextInteractionPayload = {
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

function InlineNextInteractionEditor({
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
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const containerClasses = cn(
    'group relative rounded-lg border p-4',
    activateOnClick && !editing ? 'cursor-pointer' : null
  )

  React.useEffect(() => {
    if (!editing) {
      setDraftDate(valueAt ? valueAt.slice(0, 16) : '')
      setDraftName(valueName ?? '')
      setDraftRefId(valueRefId ?? '')
      setDraftIcon(valueIcon ?? '')
      setDraftColor(valueColor ?? null)
      setDateError(null)
      setSubmitError(null)
    }
  }, [editing, valueAt, valueName, valueRefId, valueIcon, valueColor])

  const appearanceLabels = React.useMemo(() => ({
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
  }), [t])

  const handleSave = React.useCallback(async () => {
    setSubmitError(null)
    if (!draftDate) {
      await onSave(null)
      setEditing(false)
      return
    }
    const iso = new Date(draftDate).toISOString()
    if (Number.isNaN(new Date(iso).getTime())) {
      setDateError(t('customers.people.detail.inline.nextInteractionInvalid'))
      return
    }
    setDateError(null)
    const trimmedName = draftName.trim()
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
  }, [draftColor, draftDate, draftIcon, draftName, draftRefId, onSave, t])

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
    [activateOnClick, editing, handleActivate]
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
    [activateOnClick, editing, handleActivate]
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
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
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
            <div
              className="mt-2 space-y-4"
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
              <input
                type="datetime-local"
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draftDate}
                onChange={(event) => {
                  if (dateError) setDateError(null)
                  if (submitError) setSubmitError(null)
                  setDraftDate(event.target.value)
                }}
              />
              <input
                placeholder={t('customers.people.detail.inline.nextInteractionName')}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draftName}
                onChange={(event) => {
                  if (submitError) setSubmitError(null)
                  setDraftName(event.target.value)
                }}
              />
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
              {dateError ? <p className="text-xs text-red-600">{dateError}</p> : null}
              {submitError && !dateError ? <p className="text-xs text-red-600">{submitError}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('customers.people.detail.inline.save')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  {t('customers.people.detail.inline.cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setDraftDate('')
                    setDraftName('')
                    setDraftRefId('')
                    setDraftIcon('')
                    setDraftColor(null)
                    setDateError(null)
                    setSubmitError(null)
                  }}
                  disabled={saving}
                >
                  {t('customers.people.detail.inline.clear')}
                </Button>
              </div>
            </div>
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
                <span>{emptyLabel}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type SectionLoaderProps = { isLoading: boolean }

function SectionLoader({ isLoading }: SectionLoaderProps) {
  if (!isLoading) return null
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="h-4 w-4" />
      <span>Loading…</span>
    </div>
  )
}

export default function CustomerPersonDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = React.useMemo(() => {
    const raw = searchParams?.get('tab')
    if (raw === 'notes' || raw === 'activities' || raw === 'deals' || raw === 'addresses' || raw === 'tasks') {
      return raw
    }
    return 'notes'
  }, [searchParams])
  const [data, setData] = React.useState<PersonOverview | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<SectionKey>(initialTab)
  const [sectionPending, setSectionPending] = React.useState<Record<SectionKey, boolean>>({
    notes: false,
    activities: false,
    deals: false,
    addresses: false,
    tasks: false,
  })
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)
  const [pendingTaskId, setPendingTaskId] = React.useState<string | null>(null)
  const [pendingActivityId, setPendingActivityId] = React.useState<string | null>(null)
  const [pendingActivityAction, setPendingActivityAction] = React.useState<'create' | 'update' | 'delete' | null>(null)
  const scopeVersion = useOrganizationScopeVersion()
  const [dictionaryMaps, setDictionaryMaps] = React.useState<Record<CustomerDictionaryKind, CustomerDictionaryMap>>({
    statuses: {},
    sources: {},
    'lifecycle-stages': {},
    'address-types': {},
    'activity-types': {},
    'job-titles': {},
  })
  const [isDeleting, setIsDeleting] = React.useState(false)

  const handleSectionActionChange = React.useCallback((action: SectionAction | null) => {
    setSectionAction(action)
  }, [])

  const handleSectionAction = React.useCallback(() => {
    if (!sectionAction || sectionAction.disabled) return
    sectionAction.onClick()
  }, [sectionAction])

  React.useEffect(() => {
    setSectionAction(null)
  }, [activeTab])

  const personId = data?.person?.id ?? null

  const loadDictionaryEntries = React.useCallback(async (kind: CustomerDictionaryKind, signal?: AbortSignal) => {
    try {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) return []
      const normalized = normalizeDictionaryEntries(payload.items)
      if (signal?.aborted) return normalized
      setDictionaryMaps((prev) => ({
        ...prev,
        [kind]: createDictionaryMap(normalized),
      }))
      return normalized
    } catch {
      return []
    }
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()

    async function loadAll() {
      setDictionaryMaps({
        statuses: {},
        sources: {},
        'lifecycle-stages': {},
        'address-types': {},
        'activity-types': {},
        'job-titles': {},
      })
      await Promise.all([
        loadDictionaryEntries('statuses', controller.signal),
        loadDictionaryEntries('sources', controller.signal),
        loadDictionaryEntries('lifecycle-stages', controller.signal),
        loadDictionaryEntries('address-types', controller.signal),
        loadDictionaryEntries('activity-types', controller.signal),
        loadDictionaryEntries('job-titles', controller.signal),
      ])
    }

    loadAll().catch(() => {})
    return () => {
      controller.abort()
    }
  }, [id, loadDictionaryEntries, scopeVersion])

  const refreshActivityTypes = React.useCallback(() => {
    loadDictionaryEntries('activity-types').catch(() => {})
  }, [loadDictionaryEntries])

  const validators = React.useMemo(() => ({
    email: (value: string) => {
      if (!value) return null
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(value) ? null : t('customers.people.detail.inline.emailInvalid')
    },
    phone: (value: string) => {
      if (!value) return null
      return value.length >= 3 ? null : t('customers.people.detail.inline.phoneInvalid')
    },
    displayName: (value: string) => {
      const trimmed = value.trim()
      return trimmed.length ? null : t('customers.people.form.displayName.error')
    },
    linkedInUrl: (value: string) => {
      if (!value) return null
      const candidate = value.trim()
      return isValidSocialUrl(candidate, { hosts: ['linkedin.com'], pathRequired: true })
        ? null
        : t('customers.people.detail.inline.linkedInInvalid')
    },
    twitterUrl: (value: string) => {
      if (!value) return null
      const candidate = value.trim()
      return isValidSocialUrl(candidate, { hosts: ['twitter.com', 'x.com'], pathRequired: true })
        ? null
        : t('customers.people.detail.inline.twitterInvalid')
    },
  }), [t])

  const dictionaryLabels = React.useMemo(() => {
    const base = {
      valueLabel: t('customers.people.form.dictionary.valueLabel', 'Name'),
      valuePlaceholder: t('customers.people.form.dictionary.valuePlaceholder', 'Name'),
      labelLabel: t('customers.people.form.dictionary.labelLabel', 'Label'),
      labelPlaceholder: t('customers.people.form.dictionary.labelPlaceholder', 'Display name shown in UI'),
      emptyError: t('customers.people.form.dictionary.errorRequired'),
      cancelLabel: t('customers.people.form.dictionary.cancel'),
      saveLabel: t('customers.people.form.dictionary.save'),
      errorLoad: t('customers.people.form.dictionary.errorLoad'),
      errorSave: t('customers.people.form.dictionary.error'),
      loadingLabel: t('customers.people.form.dictionary.loading'),
      manageTitle: t('customers.people.form.dictionary.manage'),
    }
    return {
      statuses: {
        ...base,
        placeholder: t('customers.people.form.status.placeholder'),
        addLabel: t('customers.people.form.dictionary.addStatus'),
        addPrompt: t('customers.people.form.dictionary.promptStatus'),
        dialogTitle: t('customers.people.form.dictionary.dialogTitleStatus'),
      },
      lifecycleStages: {
        ...base,
        placeholder: t('customers.people.form.lifecycleStage.placeholder'),
        addLabel: t('customers.people.form.dictionary.addLifecycleStage'),
        addPrompt: t('customers.people.form.dictionary.promptLifecycleStage'),
        dialogTitle: t('customers.people.form.dictionary.dialogTitleLifecycleStage'),
      },
      sources: {
        ...base,
        placeholder: t('customers.people.form.source.placeholder'),
        addLabel: t('customers.people.form.dictionary.addSource'),
        addPrompt: t('customers.people.form.dictionary.promptSource'),
        dialogTitle: t('customers.people.form.dictionary.dialogTitleSource'),
      },
      activityTypes: {
        ...base,
        placeholder: t('customers.people.form.activityType.placeholder'),
        addLabel: t('customers.people.form.dictionary.addActivityType'),
        addPrompt: t('customers.people.form.dictionary.promptActivityType'),
        dialogTitle: t('customers.people.form.dictionary.dialogTitleActivityType'),
      },
      jobTitles: {
        ...base,
        placeholder: t('customers.people.form.jobTitle.placeholder'),
        addLabel: t('customers.people.form.dictionary.addJobTitle'),
        addPrompt: t('customers.people.form.dictionary.promptJobTitle'),
        dialogTitle: t('customers.people.form.dictionary.dialogTitleJobTitle'),
      },
    }
  }, [t])

  const loadActivityTypeOptions = React.useCallback(async () => {
    const entries = await loadDictionaryEntries('activity-types')
    return entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      color: entry.color ?? null,
      icon: entry.icon ?? null,
    }))
  }, [loadDictionaryEntries])

  const createActivityTypeOption = React.useCallback(
    async (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => {
      const res = await apiFetch('/api/customers/dictionaries/activity-types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          value: input.value,
          label: input.label,
          color: input.color ?? undefined,
          icon: input.icon ?? undefined,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : dictionaryLabels.activityTypes.errorSave
        throw new Error(message)
      }
      const value = typeof payload?.value === 'string' ? payload.value : input.value
      const label =
        typeof payload?.label === 'string' && payload.label.trim().length
          ? payload.label
          : input.label ?? value
      const color = typeof payload?.color === 'string' ? payload.color : input.color ?? null
      const icon = typeof payload?.icon === 'string' ? payload.icon : input.icon ?? null
      setDictionaryMaps((prev) => ({
        ...prev,
        'activity-types': {
          ...prev['activity-types'],
          [value]: { value, label, color, icon },
        },
      }))
      return { value, label, color, icon }
    },
    [dictionaryLabels.activityTypes.errorSave]
  )

  const tabs = React.useMemo(
    () => [
      { id: 'notes' as const, label: t('customers.people.detail.tabs.notes') },
      { id: 'activities' as const, label: t('customers.people.detail.tabs.activities') },
      { id: 'deals' as const, label: t('customers.people.detail.tabs.deals') },
      { id: 'addresses' as const, label: t('customers.people.detail.tabs.addresses') },
      { id: 'tasks' as const, label: t('customers.people.detail.tabs.tasks') },
    ],
    [t]
  )

  const personName = React.useMemo(
    () => (data?.person?.displayName ? data.person.displayName : t('customers.people.list.deleteFallbackName')),
    [data?.person?.displayName, t]
  )

  React.useEffect(() => {
    if (!id) {
      setError(t('customers.people.detail.error.notFound'))
      setIsLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const res = await apiFetch(`/api/customers/people/${encodeURIComponent(id)}`)
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          const message =
            typeof payload?.error === 'string' ? payload.error : t('customers.people.detail.error.load')
          throw new Error(message)
        }
        const payload = await res.json()
        if (cancelled) return
        setData(payload as PersonOverview)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('customers.people.detail.error.load')
        setError(message)
        setData(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, t])

  const savePerson = React.useCallback(
    async (patch: Record<string, unknown>, apply: (prev: PersonOverview) => PersonOverview) => {
      if (!data) return
      const res = await apiFetch('/api/customers/people', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: data.person.id, ...patch }),
      })
      if (!res.ok) {
        let message = t('customers.people.detail.inline.error')
        try {
          const details = await res.clone().json()
          if (details && typeof details.error === 'string') message = details.error
        } catch {}
        throw new Error(message)
      }
      setData((prev) => (prev ? apply(prev) : prev))
    },
    [data, t]
  )

  const updateDisplayName = React.useCallback(
    async (next: string | null) => {
      const send = typeof next === 'string' ? next : ''
      await savePerson(
        { displayName: send },
        (prev) => ({
          ...prev,
          person: {
            ...prev.person,
            displayName: next && next.length ? next : prev.person.displayName,
          },
        })
      )
    },
    [savePerson]
  )

  const updateProfileField = React.useCallback(
    async (field: ProfileEditableField, next: string | null) => {
      const send = typeof next === 'string' ? next : ''
      await savePerson(
        { [field]: send },
        (prev) => {
          if (!prev.profile) return prev
          const nextValue = next && next.length ? next : null
          return {
            ...prev,
            profile: {
              ...prev.profile,
              [field]: nextValue,
            },
          }
        }
      )
    },
    [savePerson]
  )

  const handleDelete = React.useCallback(async () => {
    if (!personId) return
    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(t('customers.people.list.deleteConfirm', { name: personName }))
    if (!confirmed) return
    setIsDeleting(true)
    try {
      const res = await apiFetch(`/api/customers/people?id=${encodeURIComponent(personId)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      })
      if (!res.ok) {
        const details = await res.json().catch(() => ({}))
        const message =
          typeof details?.error === 'string' ? details.error : t('customers.people.list.deleteError')
        throw new Error(message)
      }
      flash(t('customers.people.list.deleteSuccess'), 'success')
      router.push('/backend/customers/people')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.list.deleteError')
      flash(message, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [personId, personName, router, t])

  const handleCreateNote = React.useCallback(
    async (note: { body: string; appearanceIcon: string | null; appearanceColor: string | null }) => {
      if (!personId) return
      setSectionPending((prev) => ({ ...prev, notes: true }))
      try {
        const body = note.body.trim()
        const icon = note.appearanceIcon && note.appearanceIcon.trim().length ? note.appearanceIcon.trim() : null
        const color =
          note.appearanceColor && /^#([0-9a-f]{6})$/i.test(note.appearanceColor.trim())
            ? note.appearanceColor.trim().toLowerCase()
            : null
        const res = await apiFetch('/api/customers/comments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entityId: personId,
            body,
            appearanceIcon: icon ?? undefined,
            appearanceColor: color ?? undefined,
          }),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.notes.error')
          try {
            const details = await res.clone().json()
            if (details && typeof details.error === 'string') message = details.error
          } catch {}
          throw new Error(message)
        }
        const responseBody = await res.json().catch(() => ({}))
        const serverAuthorId = typeof responseBody?.authorUserId === 'string' ? responseBody.authorUserId : null
        const serverAuthorName = typeof responseBody?.authorName === 'string' ? responseBody.authorName : null
        const serverAuthorEmail = typeof responseBody?.authorEmail === 'string' ? responseBody.authorEmail : null
        setData((prev) => {
          if (!prev) return prev
          const viewerInfo = prev.viewer ?? null
          const viewerId = viewerInfo?.userId ?? null
          const viewerNameValue = viewerInfo?.name ?? null
          const viewerEmailValue = viewerInfo?.email ?? null
          const resolvedAuthorId = serverAuthorId ?? viewerId ?? null
          const resolvedAuthorName = (() => {
            if (resolvedAuthorId && viewerId && resolvedAuthorId === viewerId) {
              return viewerNameValue ?? viewerEmailValue ?? null
            }
            return serverAuthorName
          })()
          const resolvedAuthorEmail = (() => {
            if (resolvedAuthorId && viewerId && resolvedAuthorId === viewerId) {
              return viewerEmailValue ?? null
            }
            return serverAuthorEmail
          })()
          const newNote: CommentSummary = {
            id: typeof responseBody?.id === 'string' ? responseBody.id : randomId(),
            body,
            createdAt: new Date().toISOString(),
            authorUserId: resolvedAuthorId,
            authorName: resolvedAuthorName,
            authorEmail: resolvedAuthorEmail,
            dealId: null,
            appearanceIcon: icon,
            appearanceColor: color,
          }
          return { ...prev, comments: [newNote, ...prev.comments] }
        })
        flash(t('customers.people.detail.notes.success'), 'success')
      } finally {
        setSectionPending((prev) => ({ ...prev, notes: false }))
      }
    },
    [personId, t]
  )

  const handleUpdateNote = React.useCallback(
    async (noteId: string, patch: { body?: string; appearanceIcon?: string | null; appearanceColor?: string | null }) => {
      try {
        const res = await apiFetch('/api/customers/comments', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: noteId, ...patch }),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.notes.updateError')
          try {
            const details = await res.clone().json()
            if (details && typeof details.error === 'string') message = details.error
          } catch {}
          throw new Error(message)
        }
        setData((prev) => {
          if (!prev) return prev
          const nextComments = prev.comments.map((comment) => {
            if (comment.id !== noteId) return comment
            const next = { ...comment }
            if (patch.body !== undefined) next.body = patch.body
            if (patch.appearanceIcon !== undefined) next.appearanceIcon = patch.appearanceIcon ?? null
            if (patch.appearanceColor !== undefined) next.appearanceColor = patch.appearanceColor ?? null
            return next
          })
          return { ...prev, comments: nextComments }
        })
        flash(t('customers.people.detail.notes.updateSuccess'), 'success')
      } catch (error) {
        const message = error instanceof Error ? error.message : t('customers.people.detail.notes.updateError')
        flash(message, 'error')
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [t]
  )

  const handleDeleteNote = React.useCallback(
    async (noteId: string) => {
      setSectionPending((prev) => ({ ...prev, notes: true }))
      try {
        const res = await apiFetch('/api/customers/comments', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: noteId }),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.notes.deleteError')
          try {
            const details = await res.clone().json()
            if (details && typeof details.error === 'string') message = details.error
          } catch {}
          throw new Error(message)
        }
        setData((prev) => {
          if (!prev) return prev
          return { ...prev, comments: prev.comments.filter((comment) => comment.id !== noteId) }
        })
        flash(t('customers.people.detail.notes.deleteSuccess'), 'success')
      } catch (error) {
        const message = error instanceof Error ? error.message : t('customers.people.detail.notes.deleteError')
        flash(message, 'error')
        throw error instanceof Error ? error : new Error(message)
      } finally {
        setSectionPending((prev) => ({ ...prev, notes: false }))
      }
    },
    [t]
  )

  const handleCreateActivity = React.useCallback(
      async ({ base, custom }: ActivityFormSubmitPayload) => {
        if (!personId) return
        setPendingActivityId(null)
        setPendingActivityAction('create')
        setSectionPending((prev) => ({ ...prev, activities: true }))
        try {
          const payload: Record<string, unknown> = {
            entityId: personId,
            activityType: base.activityType,
            subject: base.subject ?? undefined,
            body: base.body ?? undefined,
            occurredAt: base.occurredAt ?? undefined,
          }
          if (Object.keys(custom).length) payload.customFields = custom
          const res = await apiFetch('/api/customers/activities', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) {
            let message = t('customers.people.detail.activities.error')
            try {
              const details = await res.clone().json()
              if (details && typeof details.error === 'string') message = details.error
            } catch {}
            throw new Error(message)
          }
          const responseBody = await res.json().catch(() => ({}))
          const nowIso = new Date().toISOString()
          setData((prev) => {
            if (!prev) return prev
            const viewer = prev.viewer ?? null
            const viewerId = viewer?.userId ?? null
            const viewerNameValue = viewer?.name ?? null
            const viewerEmailValue = viewer?.email ?? null
            const trackedActivity: ActivitySummary = {
              id: typeof responseBody?.id === 'string' ? responseBody.id : randomId(),
              activityType: base.activityType,
              subject: base.subject ?? null,
              body: base.body ?? null,
              occurredAt: base.occurredAt ?? null,
              createdAt: nowIso,
              appearanceIcon: null,
              appearanceColor: null,
              authorUserId: viewerId,
              authorName: viewerNameValue ?? viewerEmailValue ?? null,
              authorEmail: viewerEmailValue ?? null,
            }
            return { ...prev, activities: [trackedActivity, ...prev.activities] }
          })
          flash(t('customers.people.detail.activities.success'), 'success')
        } catch (err) {
          const message = err instanceof Error ? err.message : t('customers.people.detail.activities.error')
          flash(message, 'error')
          throw err instanceof Error ? err : new Error(message)
        } finally {
          setPendingActivityId(null)
          setPendingActivityAction(null)
          setSectionPending((prev) => ({ ...prev, activities: false }))
        }
      },
      [personId, t]
    )
  
    const handleUpdateActivity = React.useCallback(
      async (activityId: string, { base, custom }: ActivityFormSubmitPayload) => {
        if (!personId) return
        setPendingActivityId(activityId)
        setPendingActivityAction('update')
        setSectionPending((prev) => ({ ...prev, activities: true }))
        try {
          const res = await apiFetch('/api/customers/activities', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: activityId,
              entityId: personId,
              activityType: base.activityType,
              subject: base.subject ?? undefined,
              body: base.body ?? undefined,
              occurredAt: base.occurredAt ?? undefined,
              ...(Object.keys(custom).length ? { customFields: custom } : {}),
            }),
          })
          if (!res.ok) {
            let message = t('customers.people.detail.activities.error')
            try {
              const details = await res.clone().json()
              if (details && typeof details.error === 'string') message = details.error
            } catch {}
            throw new Error(message)
          }
          setData((prev) => {
            if (!prev) return prev
            const nextActivities = prev.activities.map((activity) => {
              if (activity.id !== activityId) return activity
              return {
                ...activity,
                activityType: base.activityType,
                subject: base.subject ?? null,
                body: base.body ?? null,
                occurredAt: base.occurredAt ?? null,
              }
            })
            return { ...prev, activities: nextActivities }
          })
          flash(t('customers.people.detail.activities.updateSuccess', 'Activity updated.'), 'success')
        } catch (err) {
          const message = err instanceof Error ? err.message : t('customers.people.detail.activities.error')
          flash(message, 'error')
          throw err instanceof Error ? err : new Error(message)
        } finally {
          setPendingActivityId(null)
          setPendingActivityAction(null)
          setSectionPending((prev) => ({ ...prev, activities: false }))
        }
      },
      [personId, t]
    )
  
    const handleDeleteActivity = React.useCallback(
      async (activityId: string) => {
        if (!personId) return
        setPendingActivityId(activityId)
        setPendingActivityAction('delete')
        setSectionPending((prev) => ({ ...prev, activities: true }))
        try {
          const res = await apiFetch('/api/customers/activities', {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: activityId }),
          })
          if (!res.ok) {
            let message = t('customers.people.detail.activities.deleteError', 'Failed to delete activity.')
            try {
              const details = await res.clone().json()
              if (details && typeof details.error === 'string') message = details.error
            } catch {}
            throw new Error(message)
          }
          setData((prev) => {
            if (!prev) return prev
            return { ...prev, activities: prev.activities.filter((activity) => activity.id !== activityId) }
          })
          flash(t('customers.people.detail.activities.deleteSuccess', 'Activity deleted.'), 'success')
        } catch (err) {
          const message =
            err instanceof Error ? err.message : t('customers.people.detail.activities.deleteError', 'Failed to delete activity.')
          flash(message, 'error')
          throw err instanceof Error ? err : new Error(message)
        } finally {
          setPendingActivityId(null)
          setPendingActivityAction(null)
          setSectionPending((prev) => ({ ...prev, activities: false }))
        }
      },
      [personId, t]
    )
  
    const handleLoadTags = React.useCallback(async (query?: string) => {
      try {
        const params = new URLSearchParams({ pageSize: '200' })
        if (query) params.set('search', query)
        const res = await apiFetch(`/api/customers/tags?${params.toString()}`)
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : t('customers.people.detail.tags.loadError', 'Failed to load tags.')
          throw new Error(message)
        }
        const items = Array.isArray(payload?.items) ? payload.items : []
        return items
          .map((item: any) => {
            if (!item) return null
            const id = typeof item.id === 'string' ? item.id : String(item.id ?? '')
            if (!id) return null
            const labelRaw = typeof item.label === 'string' && item.label.trim().length ? item.label.trim() : null
            const label = labelRaw ?? (typeof item.slug === 'string' ? item.slug : id)
            const color = typeof item.color === 'string' && item.color.trim().length ? item.color.trim() : null
            return { id, label, color }
          })
          .filter(Boolean) as TagOption[]
      } catch (err) {
        const message = err instanceof Error ? err.message : t('customers.people.detail.tags.loadError', 'Failed to load tags.')
        throw new Error(message)
      }
    }, [t])
  
    const handleCreateTag = React.useCallback(async ({ label }: { label: string }) => {
      const trimmed = label.trim()
      if (!trimmed.length) {
        throw new Error(t('customers.people.detail.tags.labelRequired', 'Tag name is required.'))
      }
      try {
        const res = await apiFetch('/api/customers/tags', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            label: trimmed,
            slug: slugifyTagLabel(trimmed),
          }),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : t('customers.people.detail.tags.createError', 'Failed to create tag.')
          throw new Error(message)
        }
        const id = typeof payload?.id === 'string' ? payload.id : String(payload?.tagId ?? '')
        if (!id) throw new Error(t('customers.people.detail.tags.createError', 'Failed to create tag.'))
        const color = typeof payload?.color === 'string' ? payload.color : null
        return { id, label: trimmed, color } satisfies TagOption
      } catch (err) {
        const message = err instanceof Error ? err.message : t('customers.people.detail.tags.createError', 'Failed to create tag.')
        throw new Error(message)
      }
    }, [t])
  
    const handleAssignTag = React.useCallback(async (tagId: string) => {
      if (!personId) throw new Error(t('customers.people.detail.tags.assignError', 'Failed to assign tag.'))
      const res = await apiFetch('/api/customers/tags/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagId, entityId: personId }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : t('customers.people.detail.tags.assignError', 'Failed to assign tag.')
        throw new Error(message)
      }
    }, [personId, t])
  
    const handleUnassignTag = React.useCallback(async (tagId: string) => {
      if (!personId) throw new Error(t('customers.people.detail.tags.assignError', 'Failed to remove tag.'))
      const res = await apiFetch('/api/customers/tags/unassign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagId, entityId: personId }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : t('customers.people.detail.tags.unassignError', 'Failed to remove tag.')
        throw new Error(message)
      }
    }, [personId, t])
  
    const handleTagsChange = React.useCallback((nextTags: TagOption[]) => {
      setData((prev) => (prev ? { ...prev, tags: nextTags } : prev))
    }, [])
  
    const handleCreateDeal = React.useCallback(
      async (payload: {
        title: string
        status?: string
        pipelineStage?: string
        valueAmount?: number
        valueCurrency?: string
        probability?: number
        expectedCloseAt?: string
        description?: string
      }) => {
        if (!personId) return
        setSectionPending((prev) => ({ ...prev, deals: true }))
        try {
          const bodyPayload: Record<string, unknown> = {
            title: payload.title,
            personIds: [personId],
          }
          if (payload.status) bodyPayload.status = payload.status
          if (payload.pipelineStage) bodyPayload.pipelineStage = payload.pipelineStage
          if (typeof payload.valueAmount === 'number') bodyPayload.valueAmount = payload.valueAmount
          if (payload.valueCurrency) bodyPayload.valueCurrency = payload.valueCurrency.toUpperCase()
          if (typeof payload.probability === 'number') bodyPayload.probability = payload.probability
          if (payload.expectedCloseAt) bodyPayload.expectedCloseAt = payload.expectedCloseAt
          if (payload.description) bodyPayload.description = payload.description
          const res = await apiFetch('/api/customers/deals', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyPayload),
          })
          if (!res.ok) {
            let message = t('customers.people.detail.deals.error')
            try {
              const details = await res.clone().json()
              if (details && typeof details.error === 'string') message = details.error
            } catch {}
            throw new Error(message)
          }
          const body = await res.json().catch(() => ({}))
          const newDeal: DealSummary = {
            id: typeof body?.id === 'string' ? body.id : randomId(),
            title: payload.title,
            status: payload.status ?? null,
            pipelineStage: payload.pipelineStage ?? null,
            valueAmount:
              typeof payload.valueAmount === 'number' ? payload.valueAmount.toString() : null,
            valueCurrency: payload.valueCurrency ? payload.valueCurrency.toUpperCase() : null,
            probability: typeof payload.probability === 'number' ? payload.probability : null,
            expectedCloseAt: payload.expectedCloseAt ?? null,
          }
          setData((prev) => (prev ? { ...prev, deals: [newDeal, ...prev.deals] } : prev))
          flash(t('customers.people.detail.deals.success'), 'success')
        } catch (err) {
          const message = err instanceof Error ? err.message : t('customers.people.detail.deals.error')
          flash(message, 'error')
          throw err instanceof Error ? err : new Error(message)
        } finally {
          setSectionPending((prev) => ({ ...prev, deals: false }))
        }
      },
      [personId, t]
    )
  
    const handleCreateAddress = React.useCallback(
      async (payload: CustomerAddressInput) => {
        if (!personId) return
        setSectionPending((prev) => ({ ...prev, addresses: true }))
        try {
          const bodyPayload: Record<string, unknown> = {
            entityId: personId,
            addressLine1: payload.addressLine1,
            isPrimary: payload.isPrimary ?? false,
          }
          if (typeof payload.name === 'string') bodyPayload.name = payload.name
          if (typeof payload.purpose === 'string') bodyPayload.purpose = payload.purpose
          if (typeof payload.addressLine2 === 'string') bodyPayload.addressLine2 = payload.addressLine2
          if (typeof payload.buildingNumber === 'string') bodyPayload.buildingNumber = payload.buildingNumber
          if (typeof payload.flatNumber === 'string') bodyPayload.flatNumber = payload.flatNumber
          if (typeof payload.city === 'string') bodyPayload.city = payload.city
          if (typeof payload.region === 'string') bodyPayload.region = payload.region
          if (typeof payload.postalCode === 'string') bodyPayload.postalCode = payload.postalCode
          if (typeof payload.country === 'string') bodyPayload.country = payload.country.toUpperCase()
  
          const res = await apiFetch('/api/customers/addresses', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyPayload),
          })
          if (!res.ok) {
            let message = t('customers.people.detail.addresses.error')
            let detailsPayload: unknown = null
            try {
              detailsPayload = await res.clone().json()
              if (
                detailsPayload &&
                typeof detailsPayload === 'object' &&
                typeof (detailsPayload as { error?: unknown }).error === 'string'
              ) {
                message = (detailsPayload as { error: string }).error
              }
            } catch {}
            const error = new Error(message)
            if (
              detailsPayload &&
              typeof detailsPayload === 'object' &&
              Array.isArray((detailsPayload as { details?: unknown }).details)
            ) {
              ;(error as Error & { details?: unknown }).details = (detailsPayload as {
                details: unknown
              }).details
            }
            throw error
          }
          const body = await res.json().catch(() => ({}))
          const newAddress: AddressSummary = {
            id: typeof body?.id === 'string' ? body.id : randomId(),
            name: payload.name ?? null,
            purpose: payload.purpose ?? null,
            addressLine1: payload.addressLine1,
            addressLine2: payload.addressLine2 ?? null,
            buildingNumber: payload.buildingNumber ?? null,
            flatNumber: payload.flatNumber ?? null,
            city: payload.city ?? null,
            region: payload.region ?? null,
            postalCode: payload.postalCode ?? null,
            country: payload.country ? payload.country.toUpperCase() : null,
            isPrimary: payload.isPrimary ?? false,
          }
          setData((prev) => {
            if (!prev) return prev
            const existing = payload.isPrimary
              ? prev.addresses.map((addr) => ({ ...addr, isPrimary: false }))
              : prev.addresses
            return { ...prev, addresses: [newAddress, ...existing] }
          })
          flash(t('customers.people.detail.addresses.success'), 'success')
        } finally {
          setSectionPending((prev) => ({ ...prev, addresses: false }))
        }
      },
      [personId, t]
    )
  
    const handleUpdateAddress = React.useCallback(
      async (id: string, payload: CustomerAddressInput) => {
        if (!personId) return
        setSectionPending((prev) => ({ ...prev, addresses: true }))
        try {
          const bodyPayload: Record<string, unknown> = {
            id,
            addressLine1: payload.addressLine1,
            isPrimary: payload.isPrimary ?? false,
          }
          if (typeof payload.name === 'string') bodyPayload.name = payload.name
          if (typeof payload.purpose === 'string') bodyPayload.purpose = payload.purpose
          if (typeof payload.addressLine2 === 'string') bodyPayload.addressLine2 = payload.addressLine2
          if (typeof payload.buildingNumber === 'string') bodyPayload.buildingNumber = payload.buildingNumber
          if (typeof payload.flatNumber === 'string') bodyPayload.flatNumber = payload.flatNumber
          if (typeof payload.city === 'string') bodyPayload.city = payload.city
          if (typeof payload.region === 'string') bodyPayload.region = payload.region
          if (typeof payload.postalCode === 'string') bodyPayload.postalCode = payload.postalCode
          if (typeof payload.country === 'string') bodyPayload.country = payload.country.toUpperCase()
  
          const res = await apiFetch('/api/customers/addresses', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyPayload),
          })
          if (!res.ok) {
            let message = t('customers.people.detail.addresses.error')
            let detailsPayload: unknown = null
            try {
              detailsPayload = await res.clone().json()
              if (
                detailsPayload &&
                typeof detailsPayload === 'object' &&
                typeof (detailsPayload as { error?: unknown }).error === 'string'
              ) {
                message = (detailsPayload as { error: string }).error
              }
            } catch {}
            const error = new Error(message) as Error & { details?: unknown }
            if (
              detailsPayload &&
              typeof detailsPayload === 'object' &&
              Array.isArray((detailsPayload as { details?: unknown }).details)
            ) {
              error.details = (detailsPayload as { details: unknown }).details
            }
            throw error
          }
  
          setData((prev) => {
            if (!prev) return prev
            const updated = prev.addresses.map((address) => {
              if (address.id !== id) {
                return payload.isPrimary ? { ...address, isPrimary: false } : address
              }
              return {
                ...address,
                name: payload.name ?? null,
                purpose: payload.purpose ?? null,
                addressLine1: payload.addressLine1,
                addressLine2: payload.addressLine2 ?? null,
                buildingNumber: payload.buildingNumber ?? null,
                flatNumber: payload.flatNumber ?? null,
                city: payload.city ?? null,
                region: payload.region ?? null,
                postalCode: payload.postalCode ?? null,
                country: payload.country ? payload.country.toUpperCase() : null,
                isPrimary: payload.isPrimary ?? false,
              }
            })
            return { ...prev, addresses: updated }
          })
          flash(t('customers.people.detail.addresses.success'), 'success')
        } finally {
          setSectionPending((prev) => ({ ...prev, addresses: false }))
        }
      },
      [personId, t]
    )
  
    const handleDeleteAddress = React.useCallback(
      async (id: string) => {
        if (!personId) return
        setSectionPending((prev) => ({ ...prev, addresses: true }))
        try {
          const res = await apiFetch('/api/customers/addresses', {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          })
          if (!res.ok) {
            let message = t('customers.people.detail.addresses.error')
            try {
              const details = await res.clone().json()
              if (details && typeof details.error === 'string') message = details.error
            } catch {}
            throw new Error(message)
          }
          setData((prev) => {
            if (!prev) return prev
            return { ...prev, addresses: prev.addresses.filter((address) => address.id !== id) }
          })
          flash(t('customers.people.detail.addresses.deleted'), 'success')
        } finally {
          setSectionPending((prev) => ({ ...prev, addresses: false }))
        }
      },
      [personId, t]
    )
  
    const handleCreateTask = React.useCallback(
      async (payload: { title: string; isDone: boolean }) => {
        if (!personId) return
        setSectionPending((prev) => ({ ...prev, tasks: true }))
        try {
          const res = await apiFetch('/api/customers/todos', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ entityId: personId, ...payload }),
          })
          if (!res.ok) {
            let message = t('customers.people.detail.tasks.error')
            try {
              const details = await res.clone().json()
              if (details && typeof details.error === 'string') message = details.error
            } catch {}
            throw new Error(message)
          }
          const body = await res.json().catch(() => ({}))
          const newTask: TodoLinkSummary = {
            id: typeof body?.linkId === 'string' ? body.linkId : randomId(),
            todoId: typeof body?.todoId === 'string' ? body.todoId : randomId(),
            todoSource: 'example:todo',
            createdAt: new Date().toISOString(),
            createdByUserId: null,
            title: payload.title,
            isDone: payload.isDone,
            priority: null,
            dueAt: null,
          }
          setData((prev) => (prev ? { ...prev, todos: [newTask, ...prev.todos] } : prev))
          flash(t('customers.people.detail.tasks.success'), 'success')
        } finally {
          setSectionPending((prev) => ({ ...prev, tasks: false }))
        }
      },
      [personId, t]
    )
  
    const handleToggleTask = React.useCallback(
      async (task: TodoLinkSummary, nextIsDone: boolean) => {
        if (!task.todoId) {
          flash(t('customers.people.detail.tasks.toggleError'), 'error')
          return
        }
        const apiPath = resolveTodoApiPath(task.todoSource)
        if (!apiPath) {
          flash(t('customers.people.detail.tasks.toggleError'), 'error')
          return
        }
        setPendingTaskId(task.todoId)
        try {
          const res = await apiFetch(apiPath, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: task.todoId, is_done: nextIsDone }),
          })
          if (!res.ok) {
            let message = t('customers.people.detail.tasks.toggleError')
            try {
              const details = await res.clone().json()
              if (details && typeof details.error === 'string') message = details.error
            } catch {}
            throw new Error(message)
          }
          setData((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              todos: prev.todos.map((item) =>
                item.todoId === task.todoId ? { ...item, isDone: nextIsDone } : item
              ),
            }
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : t('customers.people.detail.tasks.toggleError')
          flash(message, 'error')
        } finally {
          setPendingTaskId(null)
        }
      },
      [setData, t]
    )
  
    const handleCustomFieldsSubmit = React.useCallback(
      async (values: Record<string, unknown>) => {
        if (!data) {
          throw new Error(t('customers.people.detail.inline.error'))
        }
        const customPayload: Record<string, unknown> = {}
        const prefixed: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(values)) {
          if (!key.startsWith('cf_')) continue
          const normalizedValue = value === undefined ? null : value
          customPayload[key.slice(3)] = normalizedValue
          prefixed[key] = normalizedValue
        }
        if (!Object.keys(customPayload).length) {
          flash(t('ui.forms.flash.saveSuccess'), 'success')
          return
        }
        const res = await apiFetch('/api/customers/people', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: data.person.id,
            customFields: customPayload,
          }),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.inline.error')
          let fieldErrors: Record<string, string> | null = null
          try {
            const details = await res.clone().json()
            if (details && typeof details.error === 'string') message = details.error
            if (details && typeof details.fields === 'object' && details.fields !== null) {
              fieldErrors = {}
              for (const [rawKey, rawValue] of Object.entries(details.fields as Record<string, unknown>)) {
                const formKey = rawKey.startsWith('cf_') ? rawKey : `cf_${rawKey}`
                fieldErrors[formKey] = typeof rawValue === 'string' ? rawValue : message
              }
            }
          } catch {
            // ignore json parsing errors
          }
          const err = new Error(message) as Error & { fieldErrors?: Record<string, string> }
          if (fieldErrors) err.fieldErrors = fieldErrors
          throw err
        }
        setData((prev) => {
          if (!prev) return prev
          const nextCustomFields = { ...prefixed }
          return { ...prev, customFields: nextCustomFields }
        })
        flash(t('ui.forms.flash.saveSuccess'), 'success')
      },
      [data, t]
    )
  
    if (isLoading) {
      return (
        <Page>
          <PageBody>
            <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
              <Spinner className="h-6 w-6" />
              <span>{t('customers.people.detail.loading')}</span>
            </div>
          </PageBody>
        </Page>
      )
    }
  
    if (error || !data || !personId) {
      return (
        <Page>
          <PageBody>
            <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
              <p>{error || t('customers.people.detail.error.notFound')}</p>
              <Button asChild variant="outline">
                <Link href="/backend/customers/people">
                  {t('customers.people.detail.actions.backToList')}
                </Link>
              </Button>
            </div>
          </PageBody>
        </Page>
      )
    }
  
    const { person, profile } = data
  
    const detailFields: DetailFieldConfig[] = [
      {
        key: 'displayName',
        kind: 'text',
        label: t('customers.people.detail.fields.displayName'),
        value: person.displayName,
        placeholder: t('customers.people.form.displayName.placeholder'),
        emptyLabel: t('customers.people.detail.noValue'),
        validator: validators.displayName,
        onSave: updateDisplayName,
      },
      {
        key: 'firstName',
        kind: 'text',
        label: t('customers.people.form.firstName'),
        value: profile?.firstName ?? null,
        placeholder: t('customers.people.form.firstName'),
        emptyLabel: t('customers.people.detail.noValue'),
        onSave: (next) => updateProfileField('firstName', next),
      },
      {
        key: 'lastName',
        kind: 'text',
        label: t('customers.people.form.lastName'),
        value: profile?.lastName ?? null,
        placeholder: t('customers.people.form.lastName'),
        emptyLabel: t('customers.people.detail.noValue'),
        onSave: (next) => updateProfileField('lastName', next),
      },
      {
        key: 'jobTitle',
        kind: 'dictionary',
        label: t('customers.people.form.jobTitle'),
        value: profile?.jobTitle ?? null,
        emptyLabel: t('customers.people.detail.noValue'),
        dictionaryKind: 'job-titles',
        labels: dictionaryLabels.jobTitles,
        dictionaryMap: dictionaryMaps['job-titles'],
        onSave: async (next) => updateProfileField('jobTitle', next),
        onAfterSave: () => loadDictionaryEntries('job-titles'),
        selectClassName: 'h-9 w-full rounded border px-3 text-sm',
      },
      {
        key: 'lifecycleStage',
        kind: 'dictionary',
        label: t('customers.people.detail.fields.lifecycleStage'),
        value: person.lifecycleStage ?? null,
        emptyLabel: t('customers.people.detail.noValue'),
        dictionaryKind: 'lifecycle-stages',
        labels: dictionaryLabels.lifecycleStages,
        dictionaryMap: dictionaryMaps['lifecycle-stages'],
        onSave: async (next) => {
          const send = typeof next === 'string' ? next : ''
          await savePerson(
            { lifecycleStage: send },
            (prev) => ({
              ...prev,
              person: { ...prev.person, lifecycleStage: next && next.length ? next : null },
            })
          )
        },
        onAfterSave: () => loadDictionaryEntries('lifecycle-stages'),
        selectClassName: 'h-9 w-full rounded border px-3 text-sm',
      },
      {
        key: 'source',
        kind: 'dictionary',
        label: t('customers.people.form.source'),
        value: person.source ?? null,
        emptyLabel: t('customers.people.detail.noValue'),
        dictionaryKind: 'sources',
        labels: dictionaryLabels.sources,
        dictionaryMap: dictionaryMaps.sources,
        onSave: async (next) => {
          const send = typeof next === 'string' ? next : ''
          await savePerson(
            { source: send },
            (prev) => ({
              ...prev,
              person: { ...prev.person, source: next && next.length ? next : null },
            })
          )
        },
        onAfterSave: () => loadDictionaryEntries('sources'),
        selectClassName: 'h-9 w-full rounded border px-3 text-sm',
      },
      {
        key: 'description',
        kind: 'multiline',
        label: t('customers.people.form.description'),
        value: person.description ?? null,
        placeholder: t('customers.people.form.description'),
        emptyLabel: t('customers.people.detail.noValue'),
        gridClassName: 'sm:col-span-2 xl:col-span-3',
        onSave: async (next) => {
          const send = typeof next === 'string' ? next : ''
          await savePerson(
            { description: send },
            (prev) => ({
              ...prev,
              person: { ...prev.person, description: next && next.length ? next : null },
            })
          )
        },
      },
      {
        key: 'department',
        kind: 'text',
        label: t('customers.people.detail.fields.department'),
        value: profile?.department ?? null,
        placeholder: t('customers.people.detail.fields.department'),
        emptyLabel: t('customers.people.detail.noValue'),
        onSave: (next) => updateProfileField('department', next),
      },
      {
        key: 'linkedInUrl',
        kind: 'text',
        label: t('customers.people.detail.fields.linkedIn'),
        value: profile?.linkedInUrl ?? null,
        placeholder: t('customers.people.detail.fields.linkedIn'),
        emptyLabel: t('customers.people.detail.noValue'),
        onSave: (next) => updateProfileField('linkedInUrl', next),
        inputType: 'url',
        validator: validators.linkedInUrl,
        renderDisplay: renderLinkedInDisplay,
      },
      {
        key: 'twitterUrl',
        kind: 'text',
        label: t('customers.people.detail.fields.twitter'),
        value: profile?.twitterUrl ?? null,
        placeholder: t('customers.people.detail.fields.twitter'),
        emptyLabel: t('customers.people.detail.noValue'),
        onSave: (next) => updateProfileField('twitterUrl', next),
        inputType: 'url',
        validator: validators.twitterUrl,
        renderDisplay: renderTwitterDisplay,
      },
    ]
  
    return (
      <Page>
        <PageBody className="space-y-8">
          <PersonHighlights
            person={person}
            profile={profile}
            dictionaryLabels={{ statuses: dictionaryLabels.statuses }}
            dictionaryMap={dictionaryMaps.statuses}
            validators={{
              email: validators.email,
              phone: validators.phone,
              displayName: validators.displayName,
            }}
            onDisplayNameSave={updateDisplayName}
            onPrimaryEmailSave={async (next) => {
              const send = typeof next === 'string' ? next : ''
              await savePerson(
                { primaryEmail: send },
                (prev) => ({
                  ...prev,
                  person: {
                    ...prev.person,
                    primaryEmail: next && next.length ? next.toLowerCase() : null,
                  },
                })
              )
            }}
            onPrimaryPhoneSave={async (next) => {
              const send = typeof next === 'string' ? next : ''
              await savePerson(
                { primaryPhone: send },
                (prev) => ({
                  ...prev,
                  person: {
                    ...prev.person,
                    primaryPhone: next && next.length ? next : null,
                  },
                })
              )
            }}
            onStatusSave={async (next) => {
              const send = typeof next === 'string' ? next : ''
              await savePerson(
                { status: send },
                (prev) => ({
                  ...prev,
                  person: {
                    ...prev.person,
                    status: next && next.length ? next : null,
                  },
                })
              )
              await loadDictionaryEntries('statuses')
            }}
            onNextInteractionSave={async (next) => {
              await savePerson(
                {
                  nextInteraction: next
                    ? {
                        at: next.at,
                        name: next.name,
                        refId: next.refId ?? undefined,
                        icon: next.icon ?? undefined,
                        color: next.color ?? undefined,
                      }
                    : null,
                },
                (prev) => ({
                  ...prev,
                  person: {
                    ...prev.person,
                    nextInteractionAt: next ? next.at : null,
                    nextInteractionName: next ? next.name || null : null,
                    nextInteractionRefId: next ? next.refId || null : null,
                    nextInteractionIcon: next ? next.icon || null : null,
                    nextInteractionColor: next ? next.color || null : null,
                  },
                })
              )
            }}
            onDelete={handleDelete}
            isDeleting={isDeleting}
            onCompanySave={async (next) => {
              const normalized = typeof next === 'string' && next.trim().length ? next.trim() : null
              await savePerson(
                { companyEntityId: normalized },
                (prev) => {
                  if (!prev.profile) return prev
                  return {
                    ...prev,
                    profile: {
                      ...prev.profile,
                      companyEntityId: normalized,
                    },
                  }
                }
              )
            }}
          />
  
          <div className="space-y-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
              <nav
                className="flex flex-wrap items-center gap-3 text-sm"
                role="tablist"
                aria-label={t('customers.people.detail.tabs.label', 'Person detail sections')}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'relative -mb-px border-b-2 px-0 py-1 text-sm font-medium transition-colors',
                      activeTab === tab.id
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
              {sectionAction ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSectionAction}
                  disabled={sectionAction.disabled}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {sectionAction.label}
                </Button>
              ) : null}
            </div>
            <div>
              <SectionLoader isLoading={sectionPending[activeTab as SectionKey]} />
              {activeTab === 'notes' && (
                <NotesSection
                  notes={data.comments}
                  onCreate={handleCreateNote}
                  onUpdate={handleUpdateNote}
                  isSubmitting={sectionPending.notes}
                  emptyLabel={t('customers.people.detail.empty.comments')}
                  viewerUserId={data.viewer?.userId ?? null}
                  viewerName={data.viewer?.name ?? null}
                  viewerEmail={data.viewer?.email ?? null}
                  addActionLabel={t('customers.people.detail.notes.addLabel')}
                  emptyState={{
                    title: t('customers.people.detail.emptyState.notes.title'),
                    actionLabel: t('customers.people.detail.emptyState.notes.action'),
                  }}
                  onActionChange={handleSectionActionChange}
                  translator={t}
                />
              )}
              {activeTab === 'activities' && (
                <ActivitiesSection
                  activities={data.activities}
                  onCreate={handleCreateActivity}
                  onUpdate={handleUpdateActivity}
                  onDelete={handleDeleteActivity}
                  isSubmitting={sectionPending.activities}
                  addActionLabel={t('customers.people.detail.activities.add')}
                  emptyState={{
                    title: t('customers.people.detail.emptyState.activities.title'),
                    actionLabel: t('customers.people.detail.emptyState.activities.action'),
                  }}
                  loadDictionaryOptions={loadActivityTypeOptions}
                  createDictionaryOption={createActivityTypeOption}
                  dictionaryLabels={dictionaryLabels.activityTypes}
                  dictionaryMap={dictionaryMaps['activity-types']}
                  onDictionaryChange={refreshActivityTypes}
                  onActionChange={handleSectionActionChange}
                  pendingActivityId={pendingActivityId}
                  pendingActivityAction={pendingActivityAction}
                />
              )}
              {activeTab === 'deals' && (
                <DealsSection
                  deals={data.deals}
                  onCreate={handleCreateDeal}
                  isSubmitting={sectionPending.deals}
                  emptyLabel={t('customers.people.detail.empty.deals')}
                  addActionLabel={t('customers.people.detail.actions.addDeal')}
                  emptyState={{
                    title: t('customers.people.detail.emptyState.deals.title'),
                    actionLabel: t('customers.people.detail.emptyState.deals.action'),
                  }}
                  onActionChange={handleSectionActionChange}
                  translator={t}
                />
              )}
              {activeTab === 'addresses' && (
                <AddressesSection
                  addresses={data.addresses}
                  onCreate={handleCreateAddress}
                  onUpdate={handleUpdateAddress}
                  onDelete={handleDeleteAddress}
                  isSubmitting={sectionPending.addresses}
                  emptyLabel={t('customers.people.detail.empty.addresses')}
                  addActionLabel={t('customers.people.detail.addresses.add')}
                  emptyState={{
                    title: t('customers.people.detail.emptyState.addresses.title'),
                    actionLabel: t('customers.people.detail.emptyState.addresses.action'),
                  }}
                  onActionChange={handleSectionActionChange}
                  translator={t}
                />
              )}
              {activeTab === 'tasks' && (
                <TasksSection
                  tasks={data.todos}
                  onCreate={handleCreateTask}
                  isSubmitting={sectionPending.tasks}
                  emptyLabel={t('customers.people.detail.empty.todos')}
                  addActionLabel={t('customers.people.detail.tasks.add')}
                  emptyState={{
                    title: t('customers.people.detail.emptyState.tasks.title'),
                    actionLabel: t('customers.people.detail.emptyState.tasks.action'),
                  }}
                  onActionChange={handleSectionActionChange}
                  onToggle={handleToggleTask}
                  pendingTaskId={pendingTaskId}
                  translator={t}
                />
              )}
            </div>
          </div>
  
          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.details')}</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {detailFields.map((field) => {
                  const wrapperClassName = field.gridClassName ? field.gridClassName : undefined
                  if (field.kind === 'text') {
                    return (
                      <div key={field.key} className={wrapperClassName}>
                        <InlineTextEditor
                          label={field.label}
                          value={field.value}
                        placeholder={field.placeholder}
                        emptyLabel={field.emptyLabel}
                        onSave={field.onSave}
                        type={field.inputType}
                        validator={field.validator}
                        renderDisplay={field.renderDisplay}
                          variant="muted"
                          activateOnClick
                          containerClassName="rounded border bg-muted/20 p-3"
                          triggerClassName="h-8 w-8 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                        />
                      </div>
                    )
                  }
                  if (field.kind === 'multiline') {
                    return (
                      <div key={field.key} className={wrapperClassName}>
                        <InlineMultilineEditor
                          label={field.label}
                          value={field.value}
                          placeholder={field.placeholder}
                          emptyLabel={field.emptyLabel}
                          onSave={field.onSave}
                          validator={field.validator}
                          variant="muted"
                          activateOnClick
                          containerClassName="rounded border bg-muted/20 p-3"
                          triggerClassName="h-8 w-8 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                        />
                      </div>
                    )
                  }
                  return (
                    <div key={field.key} className={wrapperClassName}>
                      <InlineDictionaryEditor
                        label={field.label}
                        value={field.value}
                        emptyLabel={field.emptyLabel}
                        labels={field.labels}
                        onSave={field.onSave}
                        dictionaryMap={field.dictionaryMap}
                        onAfterSave={field.onAfterSave}
                        kind={field.dictionaryKind}
                        variant="muted"
                        activateOnClick
                        containerClassName="rounded border bg-muted/20 p-3"
                        triggerClassName="h-8 w-8 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                        selectClassName={field.selectClassName}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
  
            <CustomDataSection
              entityIds={[E.customers.customer_entity, E.customers.customer_person_profile]}
              values={data.customFields ?? {}}
              onSubmit={handleCustomFieldsSubmit}
              title={t('customers.people.detail.sections.customFields')}
            />
  
            <TagsSection
              tags={data.tags}
              loadOptions={handleLoadTags}
              onAssign={handleAssignTag}
              onUnassign={handleUnassignTag}
              onCreate={handleCreateTag}
              onChange={handleTagsChange}
              isSubmitting={false}
            />
          </div>
  
          <Separator className="my-4" />
        </PageBody>
      </Page>
    )
  }
  
