"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Loader2, Mail, Pencil, Plus, Trash2, X } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import {
  DictionarySelectField,
} from '../../../../components/formConfig'
import {
  DictionaryValue,
  createDictionaryMap,
  normalizeCustomerDictionaryEntries,
  type CustomerDictionaryKind,
  type CustomerDictionaryMap,
} from '../../../../components/dictionaryAppearance'
import { CustomerAddressTiles, type CustomerAddressInput, type CustomerAddressValue } from '../../../../components/AddressTiles'
import { useEmailDuplicateCheck } from '../../../hooks/useEmailDuplicateCheck'

type TagSummary = { id: string; label: string; color?: string | null }
type AddressSummary = {
  id: string
  name?: string | null
  purpose?: string | null
  addressLine1: string
  addressLine2?: string | null
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
  dealId?: string | null
}

type ActivitySummary = {
  id: string
  activityType: string
  subject?: string | null
  body?: string | null
  occurredAt?: string | null
  createdAt: string
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
}

type Translator = ReturnType<typeof useT>

type SectionKey = 'notes' | 'activities' | 'deals' | 'addresses' | 'tasks'

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

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `tmp-${Math.random().toString(36).slice(2)}`
}

type InlineFieldProps = {
  label: string
  value: string | null | undefined
  placeholder: string
  emptyLabel: string
  type?: 'text' | 'email' | 'tel'
  validator?: (value: string) => string | null
  onSave: (value: string | null) => Promise<void>
  recordId?: string
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
}: InlineFieldProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const trimmedDraft = React.useMemo(() => draft.trim(), [draft])
  const isEmailField = type === 'email'
  const isValidEmailForLookup = React.useMemo(() => {
    if (!isEmailField) return false
    if (!trimmedDraft.length) return false
    if (!validator) return true
    return validator(trimmedDraft) === null
  }, [isEmailField, trimmedDraft, validator])
  const { duplicate, checking } = useEmailDuplicateCheck(draft, {
    recordId,
    disabled: !editing || !isEmailField || !!error || saving || !isValidEmailForLookup,
    matchMode: 'prefix',
  })

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

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <div className="mt-2 space-y-3">
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
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              {!error && duplicate ? (
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
              {!error && !duplicate && checking && type === 'email' ? (
                <p className="text-xs text-muted-foreground">
                  {t('customers.people.detail.inline.emailChecking')}
                </p>
              ) : null}
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
            <div className="mt-1">
              {value ? (
                type === 'email' ? (
                  <a
                    className="flex items-center gap-2 text-sm text-primary hover:text-primary/90 hover:underline"
                    href={`mailto:${value}`}
                  >
                    <Mail aria-hidden className="h-4 w-4 shrink-0" />
                    <span className="truncate">{value}</span>
                  </a>
                ) : (
                  <p className="text-sm break-words">{value}</p>
                )
              ) : (
                <p className="text-sm text-muted-foreground">{emptyLabel}</p>
              )}
            </div>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing((state) => !state)}>
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

type StatusEditorProps = {
  label: string
  value: string | null | undefined
  emptyLabel: string
  labels: Parameters<typeof DictionarySelectField>[0]['labels']
  onSave: (value: string | null) => Promise<void>
  dictionaryMap?: CustomerDictionaryMap | null
  onAfterSave?: () => void | Promise<void>
}

function InlineStatusEditor({ label, value, emptyLabel, labels, onSave, dictionaryMap, onAfterSave }: StatusEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string | undefined>(value && value.length ? value : undefined)
  const [saving, setSaving] = React.useState(false)

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

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <div className="mt-2 space-y-3">
              <DictionarySelectField
                kind="statuses"
                value={draft}
                onChange={setDraft}
                labels={labels}
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
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing((state) => !state)}>
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

type NextInteractionEditorProps = {
  label: string
  valueAt: string | null | undefined
  valueName: string | null | undefined
  valueRefId: string | null | undefined
  emptyLabel: string
  onSave: (next: { at: string; name: string; refId?: string | null } | null) => Promise<void>
}

function InlineNextInteractionEditor({
  label,
  valueAt,
  valueName,
  valueRefId,
  emptyLabel,
  onSave,
}: NextInteractionEditorProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draftDate, setDraftDate] = React.useState<string>(() => (valueAt ? valueAt.slice(0, 16) : ''))
  const [draftName, setDraftName] = React.useState(valueName ?? '')
  const [draftRefId, setDraftRefId] = React.useState(valueRefId ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!editing) {
      setDraftDate(valueAt ? valueAt.slice(0, 16) : '')
      setDraftName(valueName ?? '')
      setDraftRefId(valueRefId ?? '')
    }
  }, [editing, valueAt, valueName, valueRefId])

  const handleSave = React.useCallback(async () => {
    if (!draftDate) {
      await onSave(null)
      setEditing(false)
      return
    }
    const iso = new Date(draftDate).toISOString()
    if (Number.isNaN(new Date(iso).getTime())) {
      setError(t('customers.people.detail.inline.nextInteractionInvalid'))
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave({
        at: iso,
        name: draftName.trim(),
        refId: draftRefId.trim() || null,
      })
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.inline.error')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [draftDate, draftName, draftRefId, onSave, t])

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <div className="mt-2 space-y-3">
              <input
                type="datetime-local"
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draftDate}
                onChange={(event) => {
                  if (error) setError(null)
                  setDraftDate(event.target.value)
                }}
              />
              <input
                placeholder={t('customers.people.detail.inline.nextInteractionName')}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
              <input
                placeholder={t('customers.people.detail.inline.nextInteractionRef')}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draftRefId}
                onChange={(event) => setDraftRefId(event.target.value)}
              />
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
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
                    setError(null)
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
                <div className="flex flex-col">
                  <span>{formatDateTime(valueAt)}</span>
                  {valueName ? <span className="text-xs text-muted-foreground">{valueName}</span> : null}
                </div>
              ) : (
                <span>{emptyLabel}</span>
              )}
            </div>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing((state) => !state)}>
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

type NotesTabProps = {
  notes: CommentSummary[]
  onCreate: (body: string) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  t: Translator
}

function NotesTab({ notes, onCreate, isSubmitting, emptyLabel, t }: NotesTabProps) {
  const [draft, setDraft] = React.useState('')

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!draft.trim() || isSubmitting) return
      await onCreate(draft.trim())
      setDraft('')
    },
    [draft, isSubmitting, onCreate]
  )

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="rounded-lg border bg-muted/20 p-4 space-y-3">
        <label className="text-sm font-medium text-muted-foreground" htmlFor="new-note">
          {t('customers.people.detail.notes.addLabel')}
        </label>
        <textarea
          id="new-note"
          className="w-full min-h-[120px] rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={t('customers.people.detail.notes.placeholder')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={isSubmitting}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting || !draft.trim()}>
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
      </form>
      <div className="space-y-4">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatDateTime(note.createdAt) ?? emptyLabel}</span>
                {note.authorUserId ? <span>{note.authorUserId}</span> : <span>{t('customers.people.detail.anonymous')}</span>}
              </div>
              <p className="text-sm whitespace-pre-wrap">{note.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

type ActivitiesTabProps = {
  activities: ActivitySummary[]
  onCreate: (payload: { activityType: string; subject?: string; body?: string; occurredAt?: string }) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  t: Translator
}

function ActivitiesTab({ activities, onCreate, isSubmitting, emptyLabel, t }: ActivitiesTabProps) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState({
    activityType: '',
    subject: '',
    body: '',
    occurredAt: '',
  })

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!draft.activityType.trim() || isSubmitting) {
        flash(t('customers.people.detail.activities.typeRequired'), 'error')
        return
      }
      await onCreate({
        activityType: draft.activityType.trim(),
        subject: draft.subject.trim() || undefined,
        body: draft.body.trim() || undefined,
        occurredAt: draft.occurredAt ? new Date(draft.occurredAt).toISOString() : undefined,
      })
      setDraft({ activityType: '', subject: '', body: '', occurredAt: '' })
      setOpen(false)
    },
    [draft, isSubmitting, onCreate, t]
  )

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('customers.people.detail.activities.add')}
        </Button>
      </div>
      <div className="space-y-4">
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          activities.map((activity) => (
            <div key={activity.id} className="rounded-lg border p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium uppercase tracking-wide">{activity.activityType}</span>
                <span>{formatDateTime(activity.occurredAt) ?? emptyLabel}</span>
              </div>
              {activity.subject ? <p className="text-sm font-medium">{activity.subject}</p> : null}
              {activity.body ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{activity.body}</p> : null}
            </div>
          ))
        )}
      </div>
      <Dialog open={open} onOpenChange={(next) => { if (!next) setDraft((prev) => ({ ...prev, activityType: prev.activityType })); setOpen(next) }}>
        <DialogContent className="bottom-4 top-auto w-[calc(100vw-2rem)] max-w-lg translate-y-0 sm:bottom-auto sm:top-1/2 sm:w-full sm:-translate-y-1/2">
          <DialogHeader>
            <DialogTitle>{t('customers.people.detail.activities.addTitle')}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('customers.people.detail.activities.fields.type')}</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.activityType}
                onChange={(event) => setDraft((prev) => ({ ...prev, activityType: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('customers.people.detail.activities.fields.subject')}</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.subject}
                onChange={(event) => setDraft((prev) => ({ ...prev, subject: event.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('customers.people.detail.activities.fields.body')}</label>
              <textarea
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.body}
                onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('customers.people.detail.activities.fields.occurredAt')}</label>
              <input
                type="datetime-local"
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.occurredAt}
                onChange={(event) => setDraft((prev) => ({ ...prev, occurredAt: event.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
                {t('customers.people.detail.activities.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('customers.people.detail.activities.saving')}
                  </>
                ) : (
                  t('customers.people.detail.activities.save')
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
}

function AddressesTab({ addresses, onCreate, onUpdate, onDelete, isSubmitting, emptyLabel, t }: AddressesTabProps) {
  const displayAddresses = React.useMemo<CustomerAddressValue[]>(() => {
    return addresses.map((address) => ({
      id: address.id,
      name: address.name ?? null,
      purpose: address.purpose ?? null,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      city: address.city ?? null,
      region: address.region ?? null,
      postalCode: address.postalCode ?? null,
      country: address.country ?? null,
      isPrimary: address.isPrimary ?? false,
    }))
  }, [addresses])

  return (
    <CustomerAddressTiles
      addresses={displayAddresses}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      isSubmitting={isSubmitting}
      emptyLabel={emptyLabel}
      t={t}
    />
  )
}

type TasksTabProps = {
  tasks: TodoLinkSummary[]
  onCreate: (payload: { title: string; isDone: boolean }) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  t: Translator
}

function TasksTab({ tasks, onCreate, isSubmitting, emptyLabel, t }: TasksTabProps) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState({ title: '', isDone: false })

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
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('customers.people.detail.tasks.add')}
        </Button>
      </div>
      <div className="space-y-4">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="rounded-lg border p-4 space-y-1 text-sm">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{task.todoSource}</span>
                <span>{formatDateTime(task.createdAt) ?? emptyLabel}</span>
              </div>
              <div className="text-sm text-muted-foreground">ID: {task.todoId}</div>
            </div>
          ))
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bottom-4 top-auto w-[calc(100vw-2rem)] max-w-lg translate-y-0 sm:bottom-auto sm:top-1/2 sm:w-full sm:-translate-y-1/2">
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
  emptyLabel: string
}

function DealsTab({ deals, emptyLabel }: DealsTabProps) {
  return (
    <div className="space-y-4">
      {deals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        deals.map((deal) => (
          <div key={deal.id} className="rounded-lg border p-4 space-y-1 text-sm">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold">{deal.title}</h3>
              <span className="text-xs uppercase text-muted-foreground">{deal.status || emptyLabel}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {deal.pipelineStage ? `${deal.pipelineStage} • ` : ''}
              {deal.valueAmount && deal.valueCurrency ? `${deal.valueAmount} ${deal.valueCurrency}` : null}
            </div>
            <div className="text-xs text-muted-foreground">
              {deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) : emptyLabel}
            </div>
          </div>
        ))
      )}
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
  const scopeVersion = useOrganizationScopeVersion()
  const [dictionaryMaps, setDictionaryMaps] = React.useState<Record<CustomerDictionaryKind, CustomerDictionaryMap>>({
    statuses: {},
    sources: {},
    'lifecycle-stages': {},
  })
  const personId = data?.person?.id ?? null
  const [isDeleting, setIsDeleting] = React.useState(false)

  const loadDictionaryEntries = React.useCallback(async (kind: CustomerDictionaryKind, signal?: AbortSignal) => {
    try {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) return []
      const normalized = normalizeCustomerDictionaryEntries(payload.items)
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
      setDictionaryMaps({ statuses: {}, sources: {}, 'lifecycle-stages': {} })
      await Promise.all([
        loadDictionaryEntries('statuses', controller.signal),
        loadDictionaryEntries('sources', controller.signal),
        loadDictionaryEntries('lifecycle-stages', controller.signal),
      ])
    }
    loadAll().catch(() => {})
    return () => {
      controller.abort()
    }
  }, [loadDictionaryEntries, scopeVersion, id])

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

  const statusLabels = React.useMemo(() => ({
    placeholder: t('customers.people.form.status.placeholder'),
    addLabel: t('customers.people.form.dictionary.addStatus'),
    addPrompt: t('customers.people.form.dictionary.promptStatus'),
    dialogTitle: t('customers.people.form.dictionary.dialogTitleStatus'),
    inputLabel: t('customers.people.form.dictionary.valueLabel'),
    inputPlaceholder: t('customers.people.form.dictionary.valuePlaceholder'),
    emptyError: t('customers.people.form.dictionary.errorRequired'),
    cancelLabel: t('customers.people.form.dictionary.cancel'),
    saveLabel: t('customers.people.form.dictionary.save'),
    errorLoad: t('customers.people.form.dictionary.errorLoad'),
    errorSave: t('customers.people.form.dictionary.error'),
    loadingLabel: t('customers.people.form.dictionary.loading'),
    manageTitle: t('customers.people.form.dictionary.manage'),
  }), [t])

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
    async (body: string) => {
      if (!personId) return
      setSectionPending((prev) => ({ ...prev, notes: true }))
      try {
        const res = await apiFetch('/api/customers/comments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityId: personId, body }),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.notes.error')
          try {
            const details = await res.clone().json()
            if (details && typeof details.error === 'string') message = details.error
          } catch {}
          throw new Error(message)
        }
        const payload = await res.json().catch(() => ({}))
        const newNote: CommentSummary = {
          id: typeof payload?.id === 'string' ? payload.id : randomId(),
          body,
          createdAt: new Date().toISOString(),
          authorUserId: null,
          dealId: null,
        }
        setData((prev) => (prev ? { ...prev, comments: [newNote, ...prev.comments] } : prev))
        flash(t('customers.people.detail.notes.success'), 'success')
      } finally {
        setSectionPending((prev) => ({ ...prev, notes: false }))
      }
    },
    [personId, t]
  )

  const handleCreateActivity = React.useCallback(
    async (payload: { activityType: string; subject?: string; body?: string; occurredAt?: string }) => {
      if (!personId) return
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
        }
        setData((prev) => (prev ? { ...prev, activities: [newActivity, ...prev.activities] } : prev))
        flash(t('customers.people.detail.activities.success'), 'success')
      } finally {
        setSectionPending((prev) => ({ ...prev, activities: false }))
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
        if (typeof payload.addressLine2 === 'string') bodyPayload.addressLine2 = payload.addressLine2
        if (typeof payload.city === 'string') bodyPayload.city = payload.city
        if (typeof payload.region === 'string') bodyPayload.region = payload.region
        if (typeof payload.postalCode === 'string') bodyPayload.postalCode = payload.postalCode
        if (typeof payload.country === 'string') bodyPayload.country = payload.country

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
          purpose: null,
          addressLine1: payload.addressLine1,
          addressLine2: payload.addressLine2 ?? null,
          city: payload.city ?? null,
          region: payload.region ?? null,
          postalCode: payload.postalCode ?? null,
          country: payload.country ?? null,
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
        if (typeof payload.addressLine2 === 'string') bodyPayload.addressLine2 = payload.addressLine2
        if (typeof payload.city === 'string') bodyPayload.city = payload.city
        if (typeof payload.region === 'string') bodyPayload.region = payload.region
        if (typeof payload.postalCode === 'string') bodyPayload.postalCode = payload.postalCode
        if (typeof payload.country === 'string') bodyPayload.country = payload.country

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
              purpose: null,
              addressLine1: payload.addressLine1,
              addressLine2: payload.addressLine2 ?? null,
              city: payload.city ?? null,
              region: payload.region ?? null,
              postalCode: payload.postalCode ?? null,
              country: payload.country ?? null,
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
        }
        setData((prev) => (prev ? { ...prev, todos: [newTask, ...prev.todos] } : prev))
        flash(t('customers.people.detail.tasks.success'), 'success')
      } finally {
        setSectionPending((prev) => ({ ...prev, tasks: false }))
      }
    },
    [personId, t]
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

  const detailFields: Array<{ label: string; value: React.ReactNode }> = [
    { label: t('customers.people.detail.fields.displayName'), value: person.displayName || t('customers.people.detail.noValue') },
    { label: t('customers.people.form.firstName'), value: profile?.firstName || t('customers.people.detail.noValue') },
    { label: t('customers.people.form.lastName'), value: profile?.lastName || t('customers.people.detail.noValue') },
    { label: t('customers.people.form.jobTitle'), value: profile?.jobTitle || t('customers.people.detail.noValue') },
    {
      label: t('customers.people.detail.fields.lifecycleStage'),
      value: (
        <DictionaryValue
          value={person.lifecycleStage}
          map={dictionaryMaps['lifecycle-stages']}
          fallback={<span className="text-sm text-muted-foreground">{t('customers.people.detail.noValue')}</span>}
          className="text-sm"
          iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
          iconClassName="h-4 w-4"
          colorClassName="h-3 w-3 rounded-full"
        />
      ),
    },
    {
      label: t('customers.people.form.source'),
      value: (
        <DictionaryValue
          value={person.source}
          map={dictionaryMaps.sources}
          fallback={<span className="text-sm text-muted-foreground">{t('customers.people.detail.noValue')}</span>}
          className="text-sm"
          iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
          iconClassName="h-4 w-4"
          colorClassName="h-3 w-3 rounded-full"
        />
      ),
    },
    { label: t('customers.people.form.description'), value: person.description || t('customers.people.detail.noValue') },
    { label: t('customers.people.detail.fields.department'), value: profile?.department || t('customers.people.detail.noValue') },
    { label: t('customers.people.detail.fields.linkedIn'), value: profile?.linkedInUrl || t('customers.people.detail.noValue') },
    { label: t('customers.people.detail.fields.twitter'), value: profile?.twitterUrl || t('customers.people.detail.noValue') },
  ]

  const customFieldEntries = Object.entries(data.customFields ?? {})

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
            <h1 className="text-2xl font-semibold">{person.displayName}</h1>
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
          <InlineStatusEditor
            label={t('customers.people.detail.highlights.status')}
            value={person.status ?? null}
            emptyLabel={t('customers.people.detail.noValue')}
            labels={statusLabels}
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
          />
          <InlineNextInteractionEditor
            label={t('customers.people.detail.highlights.nextInteraction')}
            valueAt={person.nextInteractionAt || null}
            valueName={person.nextInteractionName || null}
            valueRefId={person.nextInteractionRefId || null}
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
                  },
                })
              )
            }}
          />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2 border-b">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'rounded-t-md px-3 py-2 text-sm font-medium transition',
                  activeTab === tab.id
                    ? 'bg-background text-foreground shadow-inner'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="rounded-b-md border border-t-0 p-6">
            <SectionLoader isLoading={sectionPending[activeTab as SectionKey]} />
            {activeTab === 'notes' && (
              <NotesTab
                notes={data.comments}
                onCreate={handleCreateNote}
                isSubmitting={sectionPending.notes}
                emptyLabel={t('customers.people.detail.empty.comments')}
                t={t}
              />
            )}
            {activeTab === 'activities' && (
              <ActivitiesTab
                activities={data.activities}
                onCreate={handleCreateActivity}
                isSubmitting={sectionPending.activities}
                emptyLabel={t('customers.people.detail.empty.activities')}
                t={t}
              />
            )}
            {activeTab === 'deals' && (
              <DealsTab deals={data.deals} emptyLabel={t('customers.people.detail.empty.deals')} />
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
              />
            )}
            {activeTab === 'tasks' && (
              <TasksTab
                tasks={data.todos}
                onCreate={handleCreateTask}
                isSubmitting={sectionPending.tasks}
                emptyLabel={t('customers.people.detail.empty.todos')}
                t={t}
              />
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.details')}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {detailFields.map((field) => (
                <div key={field.label} className="rounded border bg-muted/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{field.label}</p>
                  <div className="mt-1 text-sm break-words">{field.value}</div>
                </div>
              ))}
            </div>
          </div>

          {customFieldEntries.length ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.customFields')}</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {customFieldEntries.map(([key, value]) => (
                  <div key={key} className="rounded border bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{key.replace(/^cf_/, '')}</p>
                    <div className="mt-1 text-sm break-words">{String(value ?? t('customers.people.detail.noValue'))}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

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
