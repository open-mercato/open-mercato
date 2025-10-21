"use client"

import * as React from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { PhoneNumberField } from '@open-mercato/ui/backend/inputs/PhoneNumberField'
import { Button } from '@open-mercato/ui/primitives/button'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { FileCode, Linkedin, Loader2, Mail, Palette, Pencil, Phone, Plus, Trash2, Twitter, X } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import {
  DictionarySelectField,
} from '../../../../components/formConfig'
import {
  DictionaryEntrySelect,
  type DictionarySelectLabels,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
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
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { CustomerAddressTiles, type CustomerAddressInput, type CustomerAddressValue } from '../../../../components/AddressTiles'
import { useEmailDuplicateCheck } from '../../../hooks/useEmailDuplicateCheck'
import { lookupPhoneDuplicate } from '../../../../utils/phoneDuplicates'
import { CustomFieldsSection } from '../../../../components/CustomFieldsSection'

type TagSummary = { id: string; label: string; color?: string | null }
type AddressSummary = {
  id: string
  name?: string | null
  purpose?: string | null
  addressLine1: string
  addressLine2?: string | null
  buildingNumber?: string | null
  flatNumber?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  isPrimary?: boolean
}

type CommentSummary = {
  id: string
  body: string
  createdAt: string
  authorUserId?: string | null
  authorName?: string | null
  authorEmail?: string | null
  dealId?: string | null
  appearanceIcon?: string | null
  appearanceColor?: string | null
}

type ActivitySummary = {
  id: string
  activityType: string
  subject?: string | null
  body?: string | null
  occurredAt?: string | null
  createdAt: string
  appearanceIcon?: string | null
  appearanceColor?: string | null
  authorUserId?: string | null
  authorName?: string | null
  authorEmail?: string | null
}

type DealSummary = {
  id: string
  title: string
  status?: string | null
  pipelineStage?: string | null
  valueAmount?: string | null
  valueCurrency?: string | null
  probability?: number | null
  expectedCloseAt?: string | null
}

type TodoLinkSummary = {
  id: string
  todoId: string
  todoSource: string
  createdAt: string
  createdByUserId?: string | null
  title?: string | null
  isDone?: boolean | null
  priority?: number | null
  dueAt?: string | null
  todoOrganizationId?: string | null
}

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

type Translator = ReturnType<typeof useT>

type SectionKey = 'notes' | 'activities' | 'deals' | 'addresses' | 'tasks'

type TabEmptyState = {
  title: string
  actionLabel: string
}

type SectionAction = {
  label: string
  onClick: () => void
  disabled?: boolean
}

function cn(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(' ')
}

function formatDateTime(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

function formatDate(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString()
}

function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (input: number) => `${input}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatRelativeTime(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const now = Date.now()
  const diffSeconds = (date.getTime() - now) / 1000
  const absSeconds = Math.abs(diffSeconds)
  const rtf = typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function'
    ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    : null
  const format = (unit: Intl.RelativeTimeFormatUnit, divisor: number) => {
    const valueToFormat = Math.round(diffSeconds / divisor)
    if (rtf) return rtf.format(valueToFormat, unit)
    const suffix = valueToFormat <= 0 ? 'ago' : 'from now'
    const magnitude = Math.abs(valueToFormat)
    return `${magnitude} ${unit}${magnitude === 1 ? '' : 's'} ${suffix}`
  }

  if (absSeconds < 45) return format('second', 1)
  if (absSeconds < 45 * 60) return format('minute', 60)
  if (absSeconds < 24 * 60 * 60) return format('hour', 60 * 60)
  if (absSeconds < 7 * 24 * 60 * 60) return format('day', 24 * 60 * 60)
  if (absSeconds < 30 * 24 * 60 * 60) return format('week', 7 * 24 * 60 * 60)
  if (absSeconds < 365 * 24 * 60 * 60) return format('month', 30 * 24 * 60 * 60)
  return format('year', 365 * 24 * 60 * 60)
}

function resolveTodoApiPath(source: string): string | null {
  if (!source) return null
  const [module] = source.split(':')
  if (!module) return null
  return `/api/${module}/todos`
}

function resolveTodoHref(source: string, todoId: string | null | undefined): string | null {
  if (!todoId) return null
  if (!source) return null
  const [module] = source.split(':')
  if (!module) return null
  return `/backend/${module}/todos/${encodeURIComponent(todoId)}/edit`
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `tmp-${Math.random().toString(36).slice(2)}`
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

const NOTES_MARKDOWN_COOKIE = 'customers_notes_markdown'

type UiMarkdownEditorProps = {
  value?: string
  height?: number
  onChange?: (value?: string) => void
  previewOptions?: { remarkPlugins?: unknown[] }
}

const UiMarkdownEditor = dynamic<UiMarkdownEditorProps>(() => import('@uiw/react-md-editor'), {
  ssr: false,
})

function writeMarkdownPreferenceCookie(enabled: boolean) {
  if (typeof document === 'undefined') return
  const expires = new Date()
  expires.setFullYear(expires.getFullYear() + 1)
  document.cookie = `${NOTES_MARKDOWN_COOKIE}=${enabled ? '1' : '0'}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`
}

function readMarkdownPreferenceCookie(): boolean | null {
  if (typeof document === 'undefined') return null
  const allCookies = document.cookie ? document.cookie.split('; ') : []
  const match = allCookies.find((entry) => entry.startsWith(`${NOTES_MARKDOWN_COOKIE}=`))
  if (!match) return null
  const value = match.split('=').slice(1).join('=')
  return value === '1'
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

type NotesTabProps = {
  notes: CommentSummary[]
  onCreate: (input: { body: string; appearanceIcon: string | null; appearanceColor: string | null }) => Promise<void>
  onUpdate: (
    noteId: string,
    patch: { body?: string; appearanceIcon?: string | null; appearanceColor?: string | null }
  ) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  viewerUserId: string | null
  viewerName?: string | null
  viewerEmail?: string | null
  t: Translator
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
}

function NotesTab({
  notes,
  onCreate,
  onUpdate,
  isSubmitting,
  emptyLabel,
  viewerUserId,
  viewerName,
  viewerEmail,
  t,
  addActionLabel,
  emptyState,
  onActionChange,
}: NotesTabProps) {
  const [draftBody, setDraftBody] = React.useState('')
  const [draftIcon, setDraftIcon] = React.useState<string | null>(null)
  const [draftColor, setDraftColor] = React.useState<string | null>(null)
  const [showAppearance, setShowAppearance] = React.useState(false)
  const [isMarkdownEnabled, setIsMarkdownEnabled] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const formRef = React.useRef<HTMLFormElement | null>(null)
  const focusComposer = React.useCallback(() => {
    const element = textareaRef.current
    if (!element) return
    element.focus()
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])
  const [appearanceEditor, setAppearanceEditor] = React.useState<{
    id: string
    icon: string | null
    color: string | null
  } | null>(null)
  const [appearanceSavingId, setAppearanceSavingId] = React.useState<string | null>(null)
  const [appearanceError, setAppearanceError] = React.useState<string | null>(null)
  const [contentEditor, setContentEditor] = React.useState<{ id: string; value: string }>({ id: '', value: '' })
  const [contentSavingId, setContentSavingId] = React.useState<string | null>(null)
  const [contentError, setContentError] = React.useState<string | null>(null)
  const contentTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [visibleCount, setVisibleCount] = React.useState(() => Math.min(5, notes.length))
  const noteAppearanceLabels = React.useMemo(() => ({
    colorLabel: t('customers.people.detail.notes.appearance.colorLabel'),
    colorHelp: t('customers.people.detail.notes.appearance.colorHelp'),
    colorClearLabel: t('customers.people.detail.notes.appearance.clearColor'),
    iconLabel: t('customers.people.detail.notes.appearance.iconLabel'),
    iconPlaceholder: t('customers.people.detail.notes.appearance.iconPlaceholder'),
    iconPickerTriggerLabel: t('customers.people.detail.notes.appearance.iconPicker'),
    iconSearchPlaceholder: t('customers.people.detail.notes.appearance.iconSearchPlaceholder'),
    iconSearchEmptyLabel: t('customers.people.detail.notes.appearance.iconSearchEmpty'),
    iconSuggestionsLabel: t('customers.people.detail.notes.appearance.iconSuggestions'),
    iconClearLabel: t('customers.people.detail.notes.appearance.iconClear'),
    previewEmptyLabel: t('customers.people.detail.notes.appearance.previewEmpty'),
  }), [t])
  const viewerLabel = React.useMemo(() => viewerName ?? viewerEmail ?? null, [viewerEmail, viewerName])
  const handleMarkdownToggle = React.useCallback(() => {
    setIsMarkdownEnabled((prev) => {
      const next = !prev
      writeMarkdownPreferenceCookie(next)
      return next
    })
  }, [])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: focusComposer,
      disabled: isSubmitting,
    })
    return () => onActionChange(null)
  }, [onActionChange, addActionLabel, focusComposer, isSubmitting])

  const adjustTextareaSize = React.useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [])

  React.useEffect(() => {
    adjustTextareaSize(textareaRef.current)
  }, [adjustTextareaSize, draftBody, isMarkdownEnabled])

  React.useEffect(() => {
    const preference = readMarkdownPreferenceCookie()
    if (preference !== null) {
      setIsMarkdownEnabled(preference)
    }
  }, [])

  React.useEffect(() => {
    if (!notes.length) {
      setVisibleCount(0)
      return
    }
    setVisibleCount((prev) => {
      const baseline = Math.min(5, notes.length)
      if (prev === 0) return baseline
      return Math.min(Math.max(prev, baseline), notes.length)
    })
  }, [notes.length])

  React.useEffect(() => {
    if (!contentEditor.id) return
    const textarea = contentTextareaRef.current
    if (!textarea) return
    const frame = window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    })
    return () => window.cancelAnimationFrame(frame)
  }, [contentEditor])

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmedBody = draftBody.trim()
      if (!trimmedBody || isSubmitting) return
      const bodyToSave = isMarkdownEnabled ? draftBody : trimmedBody
      const normalizedIcon = (draftIcon ?? '').trim()
      const normalizedColor = draftColor ? draftColor.trim().toLowerCase() : null
      await onCreate({
        body: bodyToSave,
        appearanceIcon: normalizedIcon.length ? normalizedIcon : null,
        appearanceColor: normalizedColor && /^#([0-9a-f]{6})$/.test(normalizedColor) ? normalizedColor : null,
      })
      setDraftBody('')
      setDraftIcon(null)
      setDraftColor(null)
      setShowAppearance(false)
    },
    [draftBody, draftIcon, draftColor, isMarkdownEnabled, isSubmitting, onCreate]
  )

  const handleFormKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if (event.key !== 'Enter') return
      if (!event.metaKey && !event.ctrlKey) return
      const trimmedBody = draftBody.trim()
      if (!trimmedBody || isSubmitting) return
      event.preventDefault()
      try {
        formRef.current?.requestSubmit()
      } catch {
        // ignore environments without form.requestSubmit
      }
    },
    [draftBody, isSubmitting]
  )

  const handleAppearanceSave = React.useCallback(async () => {
    if (!appearanceEditor) return
    setAppearanceSavingId(appearanceEditor.id)
    setAppearanceError(null)
    const icon = appearanceEditor.icon?.trim() ?? ''
    const color = appearanceEditor.color ? appearanceEditor.color.trim().toLowerCase() : null
    try {
      await onUpdate(appearanceEditor.id, {
        appearanceIcon: icon.length ? icon : null,
        appearanceColor: color && /^#([0-9a-f]{6})$/.test(color) ? color : null,
      })
      setAppearanceEditor(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('customers.people.detail.notes.updateError', 'Failed to update note')
      setAppearanceError(message)
    } finally {
      setAppearanceSavingId(null)
    }
  }, [appearanceEditor, onUpdate, t])

  const openAppearanceEditor = React.useCallback((note: CommentSummary) => {
    setAppearanceEditor({
      id: note.id,
      icon: note.appearanceIcon ?? null,
      color: note.appearanceColor ?? null,
    })
    setAppearanceError(null)
  }, [])

  const closeAppearanceEditor = React.useCallback(() => {
    setAppearanceEditor(null)
    setAppearanceError(null)
  }, [])

  const openContentEditor = React.useCallback((note: CommentSummary) => {
    setContentEditor({ id: note.id, value: note.body })
    setContentError(null)
  }, [])

  const closeContentEditor = React.useCallback(() => {
    setContentEditor({ id: '', value: '' })
    setContentError(null)
  }, [])

  const handleContentSave = React.useCallback(async () => {
    if (!contentEditor.id) return
    const trimmed = contentEditor.value.trim()
    if (!trimmed) {
      setContentError(t('customers.people.detail.notes.updateError'))
      return
    }
    const bodyToSave = isMarkdownEnabled ? contentEditor.value : trimmed
    setContentSavingId(contentEditor.id)
    setContentError(null)
    try {
      await onUpdate(contentEditor.id, { body: bodyToSave })
      closeContentEditor()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('customers.people.detail.notes.updateError', 'Failed to update note')
      setContentError(message)
    } finally {
      setContentSavingId(null)
    }
  }, [closeContentEditor, contentEditor, isMarkdownEnabled, onUpdate, t])

  const handleContentKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, note: CommentSummary) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openContentEditor(note)
      }
    },
    [openContentEditor]
  )

  const visibleNotes = React.useMemo(() => notes.slice(0, visibleCount), [notes, visibleCount])
  const hasVisibleNotes = React.useMemo(() => visibleCount > 0 && notes.length > 0, [visibleCount, notes.length])

  const handleLoadMore = React.useCallback(() => {
    setVisibleCount((prev) => {
      if (prev >= notes.length) return prev
      return Math.min(prev + 5, notes.length)
    })
  }, [notes.length])

  return (
    <div className="mt-2 space-y-3">
      <div className="rounded-xl bg-muted/10 py-4">
        <form ref={formRef} onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="space-y-2">
          <label htmlFor="new-note" className="sr-only">
            {t('customers.people.detail.notes.addLabel')}
          </label>
          {isMarkdownEnabled ? (
            <div className="w-full rounded-lg border border-muted-foreground/20 bg-background p-2">
              <div data-color-mode="light" className="w-full">
                <UiMarkdownEditor
                  value={draftBody}
                  height={220}
                  onChange={(value) => setDraftBody(typeof value === 'string' ? value : '')}
                  previewOptions={{ remarkPlugins: [remarkGfm] }}
                />
              </div>
            </div>
          ) : (
            <textarea
              id="new-note"
              ref={textareaRef}
              rows={1}
              className="w-full resize-none overflow-hidden rounded-lg border border-muted-foreground/20 bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              placeholder={t('customers.people.detail.notes.placeholder')}
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              onInput={(event) => adjustTextareaSize(event.currentTarget)}
              disabled={isSubmitting}
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {draftColor || draftIcon ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-muted/40 px-2 py-1">
                  {draftColor ? renderDictionaryColor(draftColor, 'h-3 w-3 rounded-full border border-border') : null}
                  {draftIcon ? renderDictionaryIcon(draftIcon, 'h-3.5 w-3.5 text-muted-foreground') : null}
                </span>
              ) : (
                <span>{t('customers.people.detail.notes.appearance.previewEmpty')}</span>
              )}
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAppearance((prev) => !prev)}
                  aria-label={
                    showAppearance
                      ? t('customers.people.detail.notes.appearance.toggleClose')
                      : t('customers.people.detail.notes.appearance.toggleOpen')
                  }
                  title={
                    showAppearance
                      ? t('customers.people.detail.notes.appearance.toggleClose')
                      : t('customers.people.detail.notes.appearance.toggleOpen')
                  }
                  disabled={isSubmitting}
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
                  <span className="sr-only">
                    {showAppearance
                      ? t('customers.people.detail.notes.appearance.toggleClose')
                      : t('customers.people.detail.notes.appearance.toggleOpen')}
                  </span>
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
                  disabled={isSubmitting}
                >
                  <FileCode className="h-4 w-4" />
                  <span className="sr-only">
                    {isMarkdownEnabled
                      ? t('customers.people.detail.notes.markdownDisable')
                      : t('customers.people.detail.notes.markdownEnable')}
                  </span>
                </Button>
              </div>
            </div>
            <Button type="submit" disabled={isSubmitting || !draftBody.trim()}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('customers.people.detail.notes.saving')}
                </>
              ) : (
                t('customers.people.detail.notes.submit')
              )}
            </Button>
          </div>
          {showAppearance ? (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 p-3">
              <AppearanceSelector
                icon={draftIcon}
                color={draftColor}
                onIconChange={setDraftIcon}
                onColorChange={setDraftColor}
                labels={noteAppearanceLabels}
              />
            </div>
          ) : null}
        </form>
      </div>

      {hasVisibleNotes
        ? visibleNotes.map((note) => {
            const isEditingAppearance = appearanceEditor?.id === note.id
            const displayColor = isEditingAppearance ? appearanceEditor?.color : note.appearanceColor ?? null
            const displayIcon = isEditingAppearance ? appearanceEditor?.icon : note.appearanceIcon ?? null
            const authorLabel = note.authorUserId
              ? note.authorUserId === viewerUserId
                ? viewerLabel ?? t('customers.people.detail.notes.you')
                : note.authorName ?? note.authorEmail ?? note.authorUserId
              : t('customers.people.detail.anonymous')
            const isAppearanceSaving = appearanceSavingId === note.id
            const isEditingContent = contentEditor.id === note.id
            const isContentSaving = contentSavingId === note.id
            return (
              <div key={note.id} className="group rounded-xl bg-card p-4 shadow-sm transition-shadow">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span>{formatRelativeTime(note.createdAt) ?? formatDateTime(note.createdAt) ?? emptyLabel}</span>
                      {displayColor ? renderDictionaryColor(displayColor, 'h-2.5 w-2.5 rounded-full border border-border') : null}
                      {displayIcon ? renderDictionaryIcon(displayIcon, 'h-3.5 w-3.5 text-muted-foreground') : null}
                      {!displayColor && !displayIcon ? (
                        <span>{t('customers.people.detail.notes.appearance.none')}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span>{authorLabel}</span>
                      {!isEditingContent ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => openContentEditor(note)}
                          aria-label={t('customers.people.detail.notes.edit', 'Edit note')}
                          title={t('customers.people.detail.notes.edit', 'Edit note')}
                          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">{t('customers.people.detail.notes.edit', 'Edit note')}</span>
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => (isEditingAppearance ? closeAppearanceEditor() : openAppearanceEditor(note))}
                        disabled={isAppearanceSaving}
                        aria-label={
                          isEditingAppearance
                            ? t('customers.people.detail.notes.appearance.toggleClose')
                            : t('customers.people.detail.notes.appearance.toggleOpen')
                        }
                        title={
                          isEditingAppearance
                            ? t('customers.people.detail.notes.appearance.toggleClose')
                            : t('customers.people.detail.notes.appearance.toggleOpen')
                        }
                      >
                        {isAppearanceSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Palette className="h-4 w-4" />
                        )}
                        <span className="sr-only">
                          {isEditingAppearance
                            ? t('customers.people.detail.notes.appearance.toggleClose')
                            : t('customers.people.detail.notes.appearance.toggleOpen')}
                        </span>
                      </Button>
                    </div>
                  </div>
                  {isEditingContent ? (
                    <div className="space-y-2">
                      {isMarkdownEnabled ? (
                        <div className="w-full rounded-md border border-muted-foreground/20 bg-background p-2">
                          <div data-color-mode="light" className="w-full">
                            <UiMarkdownEditor
                              value={contentEditor.value}
                              height={220}
                              onChange={(value) =>
                                setContentEditor((prev) => ({ ...prev, value: typeof value === 'string' ? value : '' }))
                              }
                              previewOptions={{ remarkPlugins: [remarkGfm] }}
                            />
                          </div>
                        </div>
                      ) : (
                        <textarea
                          ref={contentTextareaRef}
                          value={contentEditor.value}
                          onChange={(event) => {
                            setContentEditor((prev) => ({ ...prev, value: event.target.value }))
                            adjustTextareaSize(event.currentTarget)
                          }}
                          rows={3}
                          className="w-full resize-none overflow-hidden rounded-md border border-border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        />
                      )}
                      {contentError ? <p className="text-xs text-red-600">{contentError}</p> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" onClick={handleContentSave} disabled={isContentSaving}>
                          {isContentSaving ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {t('customers.people.detail.notes.saving')}
                            </>
                          ) : (
                            t('customers.people.detail.inline.save')
                          )}
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
                          disabled={isContentSaving}
                        >
                          <FileCode className="h-4 w-4" />
                          <span className="sr-only">
                            {isMarkdownEnabled
                              ? t('customers.people.detail.notes.markdownDisable')
                              : t('customers.people.detail.notes.markdownEnable')}
                          </span>
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={closeContentEditor} disabled={isContentSaving}>
                          {t('customers.people.detail.inline.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer text-sm"
                      onClick={() => openContentEditor(note)}
                      onKeyDown={(event) => handleContentKeyDown(event, note)}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        className="break-words text-foreground [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs"
                      >
                        {note.body}
                      </ReactMarkdown>
                    </div>
                  )}
                  {isEditingAppearance ? (
                    <div className="space-y-3 rounded-lg border border-dashed border-muted-foreground/30 p-3">
                      <AppearanceSelector
                        icon={appearanceEditor?.icon ?? null}
                        color={appearanceEditor?.color ?? null}
                        onIconChange={(value) => setAppearanceEditor((prev) => (prev ? { ...prev, icon: value ?? null } : prev))}
                        onColorChange={(value) => setAppearanceEditor((prev) => (prev ? { ...prev, color: value ?? null } : prev))}
                        labels={noteAppearanceLabels}
                        disabled={isAppearanceSaving}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            void handleAppearanceSave()
                          }}
                          disabled={isAppearanceSaving}
                        >
                          {isAppearanceSaving ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {t('customers.people.detail.notes.appearance.saving')}
                            </>
                          ) : (
                            t('customers.people.detail.notes.appearance.save')
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setAppearanceEditor((prev) => (prev ? { ...prev, icon: null, color: null } : prev))}
                          disabled={isAppearanceSaving}
                        >
                          {t('customers.people.detail.notes.appearance.reset')}
                        </Button>
                      </div>
                      {appearanceError ? <p className="text-xs text-red-600">{appearanceError}</p> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })
        : (
          <div className="rounded-xl bg-background p-6">
            <EmptyState
              title={emptyState.title}
              action={{
                label: emptyState.actionLabel,
                onClick: focusComposer,
                disabled: isSubmitting,
              }}
            />
          </div>
        )}
      {visibleCount < notes.length ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={handleLoadMore}>
            {t('customers.people.detail.notes.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

type ActivitiesTabProps = {
  activities: ActivitySummary[]
  onCreate: (payload: {
    activityType: string
    subject?: string
    body?: string
    occurredAt?: string
    appearanceIcon?: string | null
    appearanceColor?: string | null
  }) => Promise<void>
  onUpdate: (
    activityId: string,
    payload: {
      activityType: string
      subject?: string
      body?: string
      occurredAt?: string
      appearanceIcon?: string | null
      appearanceColor?: string | null
    },
  ) => Promise<void>
  onDelete: (activityId: string) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  t: Translator
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  activityLabels: DictionarySelectLabels
  activityMap: CustomerDictionaryMap
  onActivityDictionaryChange?: () => void
  pendingActivityId: string | null
  pendingActivityAction: 'create' | 'update' | 'delete' | null
}

function ActivitiesTab({
  activities,
  onCreate,
  onUpdate,
  onDelete,
  isSubmitting,
  emptyLabel,
  t,
  addActionLabel,
  emptyState,
  onActionChange,
  activityLabels,
  activityMap,
  onActivityDictionaryChange,
  pendingActivityId,
  pendingActivityAction,
}: ActivitiesTabProps) {
  const [open, setOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit'>('create')
  const [editingActivityId, setEditingActivityId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState({
    activityType: '',
    subject: '',
    body: '',
    occurredAt: '',
  })
  const [localActivityMap, setLocalActivityMap] = React.useState<CustomerDictionaryMap>({})

  const resetDraft = React.useCallback(() => {
    setDraft({
      activityType: '',
      subject: '',
      body: '',
      occurredAt: '',
    })
  }, [])

  const openCreateDialog = React.useCallback(() => {
    setDialogMode('create')
    setEditingActivityId(null)
    resetDraft()
    setOpen(true)
  }, [resetDraft])

  const openEditDialog = React.useCallback((activity: ActivitySummary) => {
    setDialogMode('edit')
    setEditingActivityId(activity.id)
    setDraft({
      activityType: activity.activityType ?? '',
      subject: activity.subject ?? '',
      body: activity.body ?? '',
      occurredAt: toLocalDateTimeInput(activity.occurredAt ?? activity.createdAt ?? null),
    })
    setOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setOpen(false)
    setDialogMode('create')
    setEditingActivityId(null)
    resetDraft()
  }, [resetDraft])

  const appearanceLabels = React.useMemo(
    () => ({
      colorLabel: t('customers.config.dictionaries.dialog.colorLabel', 'Color'),
      colorHelp: t('customers.config.dictionaries.dialog.colorHelp', 'Pick a highlight color for this entry.'),
      colorClearLabel: t('customers.config.dictionaries.dialog.colorClear', 'Remove color'),
      iconLabel: t('customers.config.dictionaries.dialog.iconLabel', 'Icon or emoji'),
      iconPlaceholder: t('customers.config.dictionaries.dialog.iconPlaceholder', 'Type an emoji or pick one of the suggestions.'),
      iconPickerTriggerLabel: t('customers.config.dictionaries.dialog.iconBrowse', 'Browse icons and emojis'),
      iconSearchPlaceholder: t('customers.config.dictionaries.dialog.iconSearchPlaceholder', 'Search icons or emojis…'),
      iconSearchEmptyLabel: t('customers.config.dictionaries.dialog.iconSearchEmpty', 'No icons match your search.'),
      iconSuggestionsLabel: t('customers.config.dictionaries.dialog.iconSuggestions', 'Suggestions'),
      iconClearLabel: t('customers.config.dictionaries.dialog.iconClear', 'Remove icon'),
      previewEmptyLabel: t('customers.config.dictionaries.dialog.previewEmpty', 'No appearance selected'),
    }),
    [t],
  )

  const fetchActivityOptions = React.useCallback(async () => {
    const res = await apiFetch('/api/customers/dictionaries/activity-types')
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = typeof payload?.error === 'string' ? payload.error : activityLabels.errorLoad
      throw new Error(message)
    }
    const entries = normalizeDictionaryEntries(payload.items)
    setLocalActivityMap(createDictionaryMap(entries))
    return entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      color: entry.color ?? null,
      icon: entry.icon ?? null,
    }))
  }, [activityLabels.errorLoad])

  const createActivityOption = React.useCallback(
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
        const message = typeof payload?.error === 'string' ? payload.error : activityLabels.errorSave
        throw new Error(message)
      }
      const value = typeof payload?.value === 'string' ? payload.value : input.value
      const label = typeof payload?.label === 'string' && payload.label.trim().length ? payload.label : input.label ?? value
      const color = typeof payload?.color === 'string' ? payload.color : input.color ?? null
      const icon = typeof payload?.icon === 'string' ? payload.icon : input.icon ?? null
      setLocalActivityMap((prev) => ({
        ...prev,
        [value]: {
          value,
          label,
          color: color ?? null,
          icon: icon ?? null,
        },
      }))
      if (typeof onActivityDictionaryChange === 'function') {
        onActivityDictionaryChange()
      }
      return { value, label, color: color ?? null, icon: icon ?? null }
    },
    [activityLabels.errorSave, onActivityDictionaryChange]
  )

  const selectedActivityEntry = React.useMemo(() => {
    return localActivityMap[draft.activityType] ?? activityMap[draft.activityType] ?? null
  }, [activityMap, localActivityMap, draft.activityType])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: openCreateDialog,
      disabled: isSubmitting,
    })
    return () => onActionChange(null)
  }, [onActionChange, addActionLabel, openCreateDialog, isSubmitting])

  const isCreatePending = pendingActivityAction === 'create'
  const isUpdatePending =
    pendingActivityAction === 'update' && editingActivityId !== null && pendingActivityId === editingActivityId
  const isDialogSubmitting = dialogMode === 'edit' ? isSubmitting || isUpdatePending : isSubmitting || isCreatePending
  const dialogTitle =
    dialogMode === 'edit'
      ? t('customers.people.detail.activities.editTitle', 'Edit activity')
      : t('customers.people.detail.activities.addTitle')

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (
        !draft.activityType.trim() ||
        isSubmitting ||
        (dialogMode === 'edit' && isUpdatePending) ||
        (dialogMode === 'create' && isCreatePending)
      ) {
        flash(t('customers.people.detail.activities.typeRequired'), 'error')
        return
      }
      const payload = {
        activityType: draft.activityType.trim(),
        subject: draft.subject.trim() || undefined,
        body: draft.body.trim() || undefined,
        occurredAt: draft.occurredAt ? new Date(draft.occurredAt).toISOString() : undefined,
        appearanceIcon: selectedActivityEntry?.icon ?? null,
        appearanceColor: selectedActivityEntry?.color ?? null,
      }
      try {
        if (dialogMode === 'edit' && editingActivityId) {
          await onUpdate(editingActivityId, payload)
        } else {
          await onCreate(payload)
        }
        closeDialog()
      } catch {
        // parent handler surfaces errors via flash messages; keep dialog open for corrections
      }
    },
    [
      draft,
      isSubmitting,
      onCreate,
      onUpdate,
      selectedActivityEntry,
      dialogMode,
      editingActivityId,
      closeDialog,
      isCreatePending,
      isUpdatePending,
      t,
    ]
  )

  const handleDeleteClick = React.useCallback(
    (activity: ActivitySummary) => {
      const confirmed =
        typeof window === 'undefined'
          ? true
          : window.confirm(
              t('customers.people.detail.activities.deleteConfirm', 'Delete this activity? This action cannot be undone.'),
            )
      if (!confirmed) return
      void onDelete(activity.id)
    },
    [onDelete, t],
  )

  return (
    <div className="mt-4 space-y-6">
      <div className="space-y-4">
        {activities.length === 0 ? (
          <EmptyState
            title={emptyState.title}
            action={{
              label: emptyState.actionLabel,
              onClick: openCreateDialog,
              disabled: isSubmitting,
            }}
          />
        ) : (
          activities.map((activity) => {
            const dictionaryEntry = localActivityMap[activity.activityType] ?? activityMap[activity.activityType] ?? null
            const displayIcon = dictionaryEntry?.icon ?? activity.appearanceIcon ?? null
            const displayColor = dictionaryEntry?.color ?? activity.appearanceColor ?? null
            const displayLabel = dictionaryEntry?.label ?? activity.activityType
            const occurredLabel =
              formatDateTime(activity.occurredAt) ??
              formatDateTime(activity.createdAt) ??
              t('customers.people.detail.activities.noDate', 'No date provided')
            const relativeLabel = formatRelativeTime(activity.occurredAt ?? activity.createdAt ?? null)
            const authorLabel = activity.authorName ?? activity.authorEmail ?? null
            const isActivityPending =
              pendingActivityAction !== 'create' && pendingActivityId === activity.id && pendingActivityAction !== null
            return (
              <div key={activity.id} className="space-y-3 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {displayIcon ? (
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-muted/40">
                        {renderDictionaryIcon(displayIcon, 'h-4 w-4')}
                      </span>
                    ) : null}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{displayLabel}</span>
                        {displayColor ? renderDictionaryColor(displayColor, 'h-3 w-3 rounded-full border border-border') : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span>{occurredLabel}</span>
                        {relativeLabel ? <span className="ml-1">({relativeLabel})</span> : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(activity)}
                      disabled={isSubmitting || isActivityPending}
                    >
                      {pendingActivityAction === 'update' && isActivityPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Pencil className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteClick(activity)}
                      disabled={isSubmitting || isActivityPending}
                    >
                      {pendingActivityAction === 'delete' && isActivityPending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                {activity.subject ? <p className="text-sm font-medium">{activity.subject}</p> : null}
                {activity.body ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{activity.body}</p> : null}
                {authorLabel ? (
                  <p className="text-xs text-muted-foreground">
                    {t('customers.people.detail.activities.loggedBy', 'Logged by {{user}}', { user: authorLabel })}
                  </p>
                ) : null}
              </div>
            )
          })
        )}
      </div>
      <Dialog open={open} onOpenChange={(next) => { if (!next) closeDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('customers.people.detail.activities.fields.type')}</label>
              <DictionaryEntrySelect
                value={draft.activityType || undefined}
                onChange={(next) => setDraft((prev) => ({ ...prev, activityType: next ?? '' }))}
                fetchOptions={fetchActivityOptions}
                createOption={createActivityOption}
                labels={activityLabels}
                allowAppearance
                allowInlineCreate
                appearanceLabels={appearanceLabels}
                selectClassName="w-full"
                manageHref="/backend/config/customers"
                disabled={isDialogSubmitting}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('customers.people.detail.activities.fields.subject')}</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.subject}
                onChange={(event) => setDraft((prev) => ({ ...prev, subject: event.target.value }))}
                disabled={isDialogSubmitting}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('customers.people.detail.activities.fields.body')}</label>
              <textarea
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.body}
                onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))}
                disabled={isDialogSubmitting}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('customers.people.detail.activities.fields.occurredAt')}</label>
              <input
                type="datetime-local"
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.occurredAt}
                onChange={(event) => setDraft((prev) => ({ ...prev, occurredAt: event.target.value }))}
                disabled={isDialogSubmitting}
                onFocus={(event) => {
                  const target = event.currentTarget as HTMLInputElement & { showPicker?: () => void }
                  if (typeof target.showPicker === 'function') {
                    try {
                      target.showPicker()
                    } catch {
                      // ignore
                    }
                  }
                }}
                onClick={(event) => {
                  const target = event.currentTarget as HTMLInputElement & { showPicker?: () => void }
                  if (typeof target.showPicker === 'function') {
                    try {
                      target.showPicker()
                    } catch {
                      // ignore
                    }
                  }
                }}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={isDialogSubmitting}>
                {t('customers.people.detail.activities.cancel')}
              </Button>
              <Button type="submit" disabled={isDialogSubmitting}>
                {isDialogSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('customers.people.detail.activities.saving')}
                  </>
                ) : (
                  dialogMode === 'edit'
                    ? t('customers.people.detail.activities.update', 'Update activity')
                    : t('customers.people.detail.activities.save', 'Save activity')
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type AddressesTabProps = {
  addresses: AddressSummary[]
  onCreate: (payload: CustomerAddressInput) => Promise<void>
  onUpdate: (id: string, payload: CustomerAddressInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  t: Translator
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
}

function AddressesTab({
  addresses,
  onCreate,
  onUpdate,
  onDelete,
  isSubmitting,
  emptyLabel,
  t,
  addActionLabel,
  emptyState,
  onActionChange,
}: AddressesTabProps) {
  const displayAddresses = React.useMemo<CustomerAddressValue[]>(() => {
    return addresses.map((address) => ({
      id: address.id,
      name: address.name ?? null,
      purpose: address.purpose ?? null,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      buildingNumber: address.buildingNumber ?? null,
      flatNumber: address.flatNumber ?? null,
      city: address.city ?? null,
      region: address.region ?? null,
      postalCode: address.postalCode ?? null,
      country: address.country ?? null,
      isPrimary: address.isPrimary ?? false,
    }))
  }, [addresses])

  const handleAddActionChange = React.useCallback(
    (action: { openCreateForm: () => void; addDisabled: boolean } | null) => {
      if (!onActionChange) return
      if (!action) {
        onActionChange(null)
        return
      }
      onActionChange({
        label: addActionLabel,
        onClick: action.openCreateForm,
        disabled: action.addDisabled,
      })
    },
    [onActionChange, addActionLabel]
  )

  return (
    <div className="mt-4">
      <CustomerAddressTiles
        addresses={displayAddresses}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isSubmitting={isSubmitting}
        emptyLabel={emptyLabel}
        t={t}
        hideAddButton
        onAddActionChange={handleAddActionChange}
        emptyStateTitle={emptyState.title}
        emptyStateActionLabel={emptyState.actionLabel}
      />
    </div>
  )
}

type TasksTabProps = {
  tasks: TodoLinkSummary[]
  onCreate: (payload: { title: string; isDone: boolean }) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  t: Translator
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  onToggle: (task: TodoLinkSummary, nextIsDone: boolean) => Promise<void>
  pendingTaskId: string | null
}

function TasksTab({
  tasks,
  onCreate,
  isSubmitting,
  emptyLabel,
  t,
  addActionLabel,
  emptyState,
  onActionChange,
  onToggle,
  pendingTaskId,
}: TasksTabProps) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState({ title: '', isDone: false })
  const [visibleCount, setVisibleCount] = React.useState(() => Math.min(5, tasks.length))
  const openDialog = React.useCallback(() => setOpen(true), [])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: openDialog,
      disabled: isSubmitting,
    })
    return () => onActionChange(null)
  }, [onActionChange, addActionLabel, openDialog, isSubmitting])

  React.useEffect(() => {
    setVisibleCount((prev) => {
      if (!tasks.length) return 0
      const baseline = Math.min(5, tasks.length)
      if (prev === 0) return baseline
      return Math.min(Math.max(prev, baseline), tasks.length)
    })
  }, [tasks.length])

  const handleLoadMore = React.useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + 5, tasks.length))
  }, [tasks.length])

  const visibleTasks = React.useMemo(() => {
    if (!visibleCount) return []
    return tasks.slice(0, visibleCount)
  }, [tasks, visibleCount])

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!draft.title.trim() || isSubmitting) {
        flash(t('customers.people.detail.tasks.titleRequired'), 'error')
        return
      }
      await onCreate({ title: draft.title.trim(), isDone: draft.isDone })
      setDraft({ title: '', isDone: false })
      setOpen(false)
    },
    [draft, isSubmitting, onCreate, t]
  )

  return (
    <div className="mt-4 space-y-6">
      <div className="space-y-4">
        {visibleTasks.length === 0 ? (
          <EmptyState
            title={emptyState.title}
            action={{
              label: emptyState.actionLabel,
              onClick: openDialog,
              disabled: isSubmitting,
            }}
          />
        ) : (
          visibleTasks.map((task) => {
            const todoHref = resolveTodoHref(task.todoSource, task.todoId)
            const createdLabel = formatDateTime(task.createdAt) ?? emptyLabel
            const dueLabel = task.dueAt ? formatDate(task.dueAt) ?? formatDateTime(task.dueAt) ?? null : null
            const priorityLabel = task.priority != null ? t('customers.people.detail.tasks.priorityLabel', { priority: task.priority }) : null
            const title = task.title ?? t('customers.people.detail.tasks.untitled')
            const isDone = task.isDone === true
            const checkboxId = `person-task-${task.id}`
            const isPending = pendingTaskId === task.todoId
            return (
              <div key={task.id} className="rounded-lg border bg-card p-4 space-y-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-2">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={isDone}
                      onChange={(event) => { const next = event.target.checked; void onToggle(task, next) }}
                      disabled={isSubmitting || isPending}
                      className="mt-1 h-4 w-4"
                    />
                    <span className={cn('text-sm font-medium', isDone ? 'line-through text-muted-foreground' : undefined)}>{title}</span>
                  </label>
                  <span className="text-xs text-muted-foreground">{createdLabel}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{task.todoSource}</span>
                  {priorityLabel ? <span>{priorityLabel}</span> : null}
                  {dueLabel ? <span>{t('customers.people.detail.tasks.dueLabel', { date: dueLabel })}</span> : null}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {todoHref ? (
                    <Link href={todoHref} className="text-primary hover:underline">
                      {t('customers.people.detail.tasks.openTask')}
                    </Link>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
        {visibleCount < tasks.length ? (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={handleLoadMore}>
              {t('customers.people.detail.tasks.loadMore')}
            </Button>
          </div>
        ) : null}
        {tasks.length > 0 ? (
          <div className="flex justify-center text-xs">
            <Link href="/backend/customers/work-plan/todos" className="text-primary hover:underline">
              {t('customers.people.detail.tasks.viewAll')}
            </Link>
          </div>
        ) : null}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('customers.people.detail.tasks.addTitle')}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('customers.people.detail.tasks.fields.title')}</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.title}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                required
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isDone}
                onChange={(event) => setDraft((prev) => ({ ...prev, isDone: event.target.checked }))}
              />
              {t('customers.people.detail.tasks.fields.done')}
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
                {t('customers.people.detail.tasks.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('customers.people.detail.tasks.saving')}
                  </>
                ) : (
                  t('customers.people.detail.tasks.save')
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type DealsTabProps = {
  deals: DealSummary[]
  onCreate: (payload: {
    title: string
    status?: string
    pipelineStage?: string
    valueAmount?: number
    valueCurrency?: string
    probability?: number
    expectedCloseAt?: string
    description?: string
  }) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  t: Translator
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
}

function DealsTab({
  deals,
  onCreate,
  isSubmitting,
  emptyLabel,
  t,
  addActionLabel,
  emptyState,
  onActionChange,
}: DealsTabProps) {
  const [open, setOpen] = React.useState(false)
  const openDialog = React.useCallback(() => setOpen(true), [])
  const [draft, setDraft] = React.useState({
    title: '',
    status: '',
    pipelineStage: '',
    valueAmount: '',
    valueCurrency: '',
    probability: '',
    expectedCloseAt: '',
    description: '',
  })

  const resetDraft = React.useCallback(() => {
    setDraft({
      title: '',
      status: '',
      pipelineStage: '',
      valueAmount: '',
      valueCurrency: '',
      probability: '',
      expectedCloseAt: '',
      description: '',
    })
  }, [])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: openDialog,
      disabled: isSubmitting,
    })
    return () => onActionChange(null)
  }, [onActionChange, addActionLabel, openDialog, isSubmitting])

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmedTitle = draft.title.trim()
      if (!trimmedTitle || isSubmitting) {
        flash(t('customers.people.detail.deals.titleRequired'), 'error')
        return
      }
      const payload: {
        title: string
        status?: string
        pipelineStage?: string
        valueAmount?: number
        valueCurrency?: string
        probability?: number
        expectedCloseAt?: string
        description?: string
      } = { title: trimmedTitle }
      const normalizedStatus = draft.status.trim()
      if (normalizedStatus) payload.status = normalizedStatus
      const normalizedStage = draft.pipelineStage.trim()
      if (normalizedStage) payload.pipelineStage = normalizedStage
      const normalizedAmount = draft.valueAmount.trim()
      if (normalizedAmount) {
        const parsed = Number(normalizedAmount)
        if (!Number.isNaN(parsed)) payload.valueAmount = parsed
      }
      const normalizedCurrency = draft.valueCurrency.trim()
      if (normalizedCurrency) payload.valueCurrency = normalizedCurrency.toUpperCase()
      const normalizedProbability = draft.probability.trim()
      if (normalizedProbability) {
        const parsed = Number(normalizedProbability)
        if (!Number.isNaN(parsed)) payload.probability = parsed
      }
      if (draft.expectedCloseAt) payload.expectedCloseAt = draft.expectedCloseAt
      const normalizedDescription = draft.description.trim()
      if (normalizedDescription) payload.description = normalizedDescription
      try {
        await onCreate(payload)
        resetDraft()
        setOpen(false)
      } catch {
        // errors are surfaced via flash notifications in the handler
      }
    },
    [draft, isSubmitting, onCreate, resetDraft, t]
  )

  const handleClose = React.useCallback(() => {
    resetDraft()
    setOpen(false)
  }, [resetDraft])

  return (
    <div className="mt-4 space-y-6">
      <div className="space-y-4">
        {deals.length === 0 ? (
          <EmptyState
            title={emptyState.title}
            action={{
              label: emptyState.actionLabel,
              onClick: openDialog,
              disabled: isSubmitting,
            }}
          />
        ) : (
          deals.map((deal) => (
            <div key={deal.id} className="rounded-lg border p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">{deal.title}</h3>
                <span className="text-xs uppercase text-muted-foreground">{deal.status || emptyLabel}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {deal.pipelineStage ? <span>{deal.pipelineStage}</span> : null}
                {typeof deal.probability === 'number' ? <span>{deal.probability}%</span> : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {deal.valueAmount && deal.valueCurrency
                  ? `${deal.valueAmount} ${deal.valueCurrency}`
                  : emptyLabel}
              </div>
              <div className="text-xs text-muted-foreground">
                {deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) : emptyLabel}
              </div>
            </div>
          ))
        )}
      </div>
      <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); else setOpen(next) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('customers.people.detail.deals.addTitle')}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="deal-title">
                {t('customers.people.detail.deals.fields.title')}
              </label>
              <input
                id="deal-title"
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.title}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-status">
                  {t('customers.people.detail.deals.fields.status')}
                </label>
                <input
                  id="deal-status"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.status}
                  onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-stage">
                  {t('customers.people.detail.deals.fields.pipelineStage')}
                </label>
                <input
                  id="deal-stage"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.pipelineStage}
                  onChange={(event) => setDraft((prev) => ({ ...prev, pipelineStage: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-value">
                  {t('customers.people.detail.deals.fields.valueAmount')}
                </label>
                <input
                  id="deal-value"
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.valueAmount}
                  onChange={(event) => setDraft((prev) => ({ ...prev, valueAmount: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-currency">
                  {t('customers.people.detail.deals.fields.valueCurrency')}
                </label>
                <input
                  id="deal-currency"
                  className="w-full uppercase rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.valueCurrency}
                  onChange={(event) => setDraft((prev) => ({ ...prev, valueCurrency: event.target.value }))}
                  maxLength={3}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-probability">
                  {t('customers.people.detail.deals.fields.probability')}
                </label>
                <input
                  id="deal-probability"
                  type="number"
                  min="0"
                  max="100"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.probability}
                  onChange={(event) => setDraft((prev) => ({ ...prev, probability: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="deal-expected">
                  {t('customers.people.detail.deals.fields.expectedCloseAt')}
                </label>
                <input
                  id="deal-expected"
                  type="date"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.expectedCloseAt}
                  onChange={(event) => setDraft((prev) => ({ ...prev, expectedCloseAt: event.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="deal-description">
                {t('customers.people.detail.deals.fields.description')}
              </label>
              <textarea
                id="deal-description"
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.description}
                onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                {t('customers.people.detail.deals.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('customers.people.detail.deals.saving')}
                  </>
                ) : (
                  t('customers.people.detail.deals.save')
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
  const [activeTab, setActiveTab] = React.useState<'notes' | 'activities' | 'deals' | 'addresses' | 'tasks'>(initialTab)
  const [sectionPending, setSectionPending] = React.useState<Record<SectionKey, boolean>>({
    notes: false,
    activities: false,
    deals: false,
    addresses: false,
    tasks: false,
  })
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)
  const [pendingActivityId, setPendingActivityId] = React.useState<string | null>(null)
  const [pendingActivityAction, setPendingActivityAction] = React.useState<'create' | 'update' | 'delete' | null>(null)
  const [pendingTaskId, setPendingTaskId] = React.useState<string | null>(null)
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
  const scopeVersion = useOrganizationScopeVersion()
  const [dictionaryMaps, setDictionaryMaps] = React.useState<Record<CustomerDictionaryKind, CustomerDictionaryMap>>({
    statuses: {},
    sources: {},
    'lifecycle-stages': {},
    'address-types': {},
    'activity-types': {},
    'job-titles': {},
  })
  const personId = data?.person?.id ?? null
  const [isDeleting, setIsDeleting] = React.useState(false)

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
  }, [loadDictionaryEntries, scopeVersion, id])

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

  const personName = React.useMemo(
    () => (data?.person?.displayName ? data.person.displayName : t('customers.people.list.deleteFallbackName')),
    [data?.person?.displayName, t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!personId) return
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(t('customers.people.list.deleteConfirm', { name: personName }))
      : true
    if (!confirmed) return
    setIsDeleting(true)
    try {
      const res = await apiFetch(`/api/customers/people?id=${encodeURIComponent(personId)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      })
      if (!res.ok) {
        const details = await res.json().catch(() => ({}))
        const message = typeof details?.error === 'string' ? details.error : t('customers.people.list.deleteError')
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
          const message = typeof payload?.error === 'string' ? payload.error : t('customers.people.detail.error.load')
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
    load()
    return () => { cancelled = true }
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
        (prev) => {
          if (!prev) return prev
          const nextValue = next && next.length ? next : prev.person.displayName
          return { ...prev, person: { ...prev.person, displayName: nextValue } }
        }
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
          if (!prev || !prev.profile) return prev
          const nextValue = next && next.length ? next : null
          return { ...prev, profile: { ...prev.profile, [field]: nextValue } }
        }
      )
    },
    [savePerson]
  )

  const dictionaryLabels = React.useMemo(() => {
    const base = {
      valueLabel: t('customers.people.form.dictionary.valueLabel', 'Name'),
      valuePlaceholder: t('customers.people.form.dictionary.valuePlaceholder', 'Name'),
      labelLabel: t('customers.config.dictionaries.dialog.labelLabel', 'Label'),
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

  const handleCreateNote = React.useCallback(
    async (note: { body: string; appearanceIcon: string | null; appearanceColor: string | null }) => {
      if (!personId) return
      setSectionPending((prev) => ({ ...prev, notes: true }))
      try {
        const body = note.body.trim()
        const icon = note.appearanceIcon && note.appearanceIcon.trim().length ? note.appearanceIcon.trim() : null
        const color = note.appearanceColor && /^#([0-9a-f]{6})$/i.test(note.appearanceColor.trim())
          ? note.appearanceColor.trim().toLowerCase()
          : null
        const res = await apiFetch('/api/customers/comments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entityId: personId,
            body,
            appearanceIcon: icon,
            appearanceColor: color,
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

  const handleCreateActivity = React.useCallback(
    async (payload: {
      activityType: string
      subject?: string
      body?: string
      occurredAt?: string
      appearanceIcon?: string | null
      appearanceColor?: string | null
    }) => {
      if (!personId) return
      setPendingActivityId(null)
      setPendingActivityAction('create')
      setSectionPending((prev) => ({ ...prev, activities: true }))
      try {
        const res = await apiFetch('/api/customers/activities', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityId: personId, ...payload }),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.activities.error')
          try {
            const details = await res.clone().json()
            if (details && typeof details.error === 'string') message = details.error
          } catch {}
          throw new Error(message)
        }
        const body = await res.json().catch(() => ({}))
        const newActivity: ActivitySummary = {
          id: typeof body?.id === 'string' ? body.id : randomId(),
          activityType: payload.activityType,
          subject: payload.subject ?? null,
          body: payload.body ?? null,
          occurredAt: payload.occurredAt ?? null,
          createdAt: new Date().toISOString(),
          appearanceIcon: payload.appearanceIcon ?? null,
          appearanceColor: payload.appearanceColor ?? null,
        }
        setData((prev) => {
          if (!prev) return prev
          const viewer = prev.viewer ?? null
          const viewerId = viewer?.userId ?? null
          const viewerNameValue = viewer?.name ?? null
          const viewerEmailValue = viewer?.email ?? null
          const createdAtIso = new Date().toISOString()
          const trackedActivity: ActivitySummary = {
            ...newActivity,
            createdAt: createdAtIso,
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
    async (
      activityId: string,
      payload: {
        activityType: string
        subject?: string
        body?: string
        occurredAt?: string
        appearanceIcon?: string | null
        appearanceColor?: string | null
      },
    ) => {
      if (!personId) return
      setPendingActivityId(activityId)
      setPendingActivityAction('update')
      setSectionPending((prev) => ({ ...prev, activities: true }))
      try {
        const res = await apiFetch('/api/customers/activities', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: activityId, ...payload }),
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
              activityType: payload.activityType,
              subject: payload.subject ?? null,
              body: payload.body ?? null,
              occurredAt: payload.occurredAt ?? null,
              appearanceIcon: payload.appearanceIcon ?? null,
              appearanceColor: payload.appearanceColor ?? null,
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
            <Button variant="outline" onClick={() => router.push('/backend/customers/people')}>
              {t('customers.people.detail.actions.backToList')}
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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/backend/customers/people"
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <span aria-hidden className="mr-1 text-base">←</span>
              <span className="sr-only">{t('customers.people.detail.actions.backToList')}</span>
            </Link>
            <InlineTextEditor
              label={t('customers.people.form.displayName.label')}
              value={person.displayName}
              placeholder={t('customers.people.form.displayName.placeholder')}
              emptyLabel={t('customers.people.detail.noValue')}
              validator={validators.displayName}
              onSave={updateDisplayName}
              hideLabel
              variant="plain"
              activateOnClick
              triggerClassName="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
              containerClassName="max-w-full"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
              className="rounded-none border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
            >
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {t('customers.people.list.actions.delete')}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <InlineTextEditor
            label={t('customers.people.detail.highlights.primaryEmail')}
            value={person.primaryEmail || ''}
            placeholder={t('customers.people.form.primaryEmail')}
            emptyLabel={t('customers.people.detail.noValue')}
            type="email"
            validator={validators.email}
            recordId={person.id}
            activateOnClick
            onSave={async (next) => {
              const send = typeof next === 'string' ? next : ''
              await savePerson(
                { primaryEmail: send },
                (prev) => ({
                  ...prev,
                  person: { ...prev.person, primaryEmail: next && next.length ? next.toLowerCase() : null },
                })
              )
            }}
          />
          <InlineTextEditor
            label={t('customers.people.detail.highlights.primaryPhone')}
            value={person.primaryPhone || ''}
            placeholder={t('customers.people.form.primaryPhone')}
            emptyLabel={t('customers.people.detail.noValue')}
            type="tel"
            validator={validators.phone}
            recordId={person.id}
            activateOnClick
            onSave={async (next) => {
              const send = typeof next === 'string' ? next : ''
              await savePerson(
                { primaryPhone: send },
                (prev) => ({
                  ...prev,
                  person: { ...prev.person, primaryPhone: next && next.length ? next : null },
                })
              )
            }}
          />
          <InlineDictionaryEditor
            label={t('customers.people.detail.highlights.status')}
            value={person.status ?? null}
            emptyLabel={t('customers.people.detail.noValue')}
            labels={dictionaryLabels.statuses}
            activateOnClick
            onSave={async (next) => {
              const send = typeof next === 'string' ? next : ''
              await savePerson(
                { status: send },
                (prev) => ({
                  ...prev,
                  person: { ...prev.person, status: next && next.length ? next : null },
                })
              )
            }}
            dictionaryMap={dictionaryMaps.statuses}
            onAfterSave={() => loadDictionaryEntries('statuses')}
            kind="statuses"
            selectClassName="px-3"
          />
          <InlineNextInteractionEditor
            label={t('customers.people.detail.highlights.nextInteraction')}
            valueAt={person.nextInteractionAt || null}
            valueName={person.nextInteractionName || null}
            valueRefId={person.nextInteractionRefId || null}
            valueIcon={person.nextInteractionIcon || null}
            valueColor={person.nextInteractionColor || null}
            emptyLabel={t('customers.people.detail.noValue')}
            onSave={async (next) => {
              await savePerson(
                { nextInteraction: next },
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
            activateOnClick
          />
        </div>

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
              <NotesTab
                notes={data.comments}
                onCreate={handleCreateNote}
                onUpdate={handleUpdateNote}
                isSubmitting={sectionPending.notes}
                emptyLabel={t('customers.people.detail.empty.comments')}
                viewerUserId={data.viewer?.userId ?? null}
                viewerName={data.viewer?.name ?? null}
                viewerEmail={data.viewer?.email ?? null}
                t={t}
                addActionLabel={t('customers.people.detail.notes.addLabel')}
                emptyState={{
                  title: t('customers.people.detail.emptyState.notes.title'),
                  actionLabel: t('customers.people.detail.emptyState.notes.action'),
                }}
                onActionChange={handleSectionActionChange}
              />
            )}
            {activeTab === 'activities' && (
              <ActivitiesTab
                activities={data.activities}
                onCreate={handleCreateActivity}
                onUpdate={handleUpdateActivity}
                onDelete={handleDeleteActivity}
                isSubmitting={sectionPending.activities}
                emptyLabel={t('customers.people.detail.empty.activities')}
                t={t}
                addActionLabel={t('customers.people.detail.activities.add')}
                emptyState={{
                  title: t('customers.people.detail.emptyState.activities.title'),
                  actionLabel: t('customers.people.detail.emptyState.activities.action'),
                }}
                onActionChange={handleSectionActionChange}
                activityLabels={dictionaryLabels.activityTypes}
                activityMap={dictionaryMaps['activity-types']}
                onActivityDictionaryChange={refreshActivityTypes}
                pendingActivityId={pendingActivityId}
                pendingActivityAction={pendingActivityAction}
              />
            )}
            {activeTab === 'deals' && (
              <DealsTab
                deals={data.deals}
                onCreate={handleCreateDeal}
                isSubmitting={sectionPending.deals}
                emptyLabel={t('customers.people.detail.empty.deals')}
                t={t}
                addActionLabel={t('customers.people.detail.actions.addDeal')}
                emptyState={{
                  title: t('customers.people.detail.emptyState.deals.title'),
                  actionLabel: t('customers.people.detail.emptyState.deals.action'),
                }}
                onActionChange={handleSectionActionChange}
              />
            )}
            {activeTab === 'addresses' && (
              <AddressesTab
                addresses={data.addresses}
                onCreate={handleCreateAddress}
                onUpdate={handleUpdateAddress}
                onDelete={handleDeleteAddress}
                isSubmitting={sectionPending.addresses}
                emptyLabel={t('customers.people.detail.empty.addresses')}
                t={t}
                addActionLabel={t('customers.people.detail.addresses.add')}
                emptyState={{
                  title: t('customers.people.detail.emptyState.addresses.title'),
                  actionLabel: t('customers.people.detail.emptyState.addresses.action'),
                }}
                onActionChange={handleSectionActionChange}
              />
            )}
            {activeTab === 'tasks' && (
              <TasksTab
                tasks={data.todos}
                onCreate={handleCreateTask}
                isSubmitting={sectionPending.tasks}
                emptyLabel={t('customers.people.detail.empty.todos')}
                t={t}
                addActionLabel={t('customers.people.detail.tasks.add')}
                emptyState={{
                  title: t('customers.people.detail.emptyState.tasks.title'),
                  actionLabel: t('customers.people.detail.emptyState.tasks.action'),
                }}
                onActionChange={handleSectionActionChange}
                onToggle={handleToggleTask}
                pendingTaskId={pendingTaskId}
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

          <CustomFieldsSection
            entityIds={[E.customers.customer_entity, E.customers.customer_person_profile]}
            values={data.customFields ?? {}}
            onSubmit={handleCustomFieldsSubmit}
            title={t('customers.people.detail.sections.customFields')}
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.tags')}</h2>
              <Button variant="outline" size="sm" disabled>
                {t('customers.people.detail.actions.manageTags')}
              </Button>
            </div>
            {data.tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('customers.people.detail.empty.tags')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium"
                    style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <Separator className="my-4" />
      </PageBody>
    </Page>
  )
}
