"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { cn } from '@open-mercato/shared/lib/utils'
import { Plus } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
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
  renderLinkedInDisplay,
  renderTwitterDisplay,
} from '../../../../components/detail/InlineEditors'
import { DetailFieldsSection, type DetailFieldConfig } from '../../../../components/detail/DetailFieldsSection'
import { LoadingMessage } from '../../../../components/detail/LoadingMessage'
import { isValidSocialUrl } from '@open-mercato/core/modules/customers/lib/detailHelpers'
import type {
  ActivitySummary,
  CommentSummary,
  DealSummary,
  TagSummary,
  TodoLinkSummary,
  SectionAction,
} from '../../../../components/detail/types'
import { CustomDataSection } from '../../../../components/detail/CustomDataSection'
import { createTranslatorWithFallback } from '../../../../components/detail/utils'

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

type ProfileEditableField = 'firstName' | 'lastName' | 'jobTitle' | 'department' | 'linkedInUrl' | 'twitterUrl'



type SectionLoaderProps = { isLoading: boolean; label?: string }

function SectionLoader({ isLoading, label = 'Loading…' }: SectionLoaderProps) {
  if (!isLoading) return null
  return <LoadingMessage label={label} className="mb-4 mt-4 min-h-[160px]" />
}

export default function CustomerPersonDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
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
  const [isDeleting, setIsDeleting] = React.useState(false)
  const sectionLoaderLabel =
    activeTab === 'activities'
      ? t('customers.people.detail.activities.loading', 'Loading activities…')
      : activeTab === 'deals'
        ? t('customers.people.detail.deals.loading', 'Loading deals…')
        : t('customers.people.detail.sectionLoading', 'Loading…')

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

  const personId = data?.person?.id ?? null
  const dealsScope = React.useMemo(
    () => (personId ? ({ kind: 'person', entityId: personId } as const) : null),
    [personId],
  )
  const dealSelectOptions = React.useMemo(
    () =>
      Array.isArray(data?.deals)
        ? data.deals
            .map((deal) => {
              if (!deal || typeof deal !== 'object') return null
              const id = typeof (deal as Record<string, unknown>).id === 'string' ? (deal as Record<string, unknown>).id : ''
              if (!id) return null
              const title =
                typeof (deal as Record<string, unknown>).title === 'string' && (deal as Record<string, unknown>).title.trim().length
                  ? ((deal as Record<string, unknown>).title as string).trim()
                  : id
              return { id, label: title }
            })
            .filter((option): option is { id: string; label: string } => !!option)
        : [],
    [data?.deals],
  )
  const handleNotesLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, notes: loading }))
  }, [])

  const handleActivitiesLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, activities: loading }))
  }, [])

  const handleDealsLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, deals: loading }))
  }, [])

  const handleAddressesLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, addresses: loading }))
  }, [])

  const handleTasksLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, tasks: loading }))
  }, [])

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
        const res = await apiFetch(`/api/customers/people/${encodeURIComponent(id)}?include=todos`)
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

  const handleTagsChange = React.useCallback((nextTags: TagOption[]) => {
    setData((prev) => (prev ? { ...prev, tags: nextTags } : prev))
  }, [])
  
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
        onSave: async (next) => updateProfileField('jobTitle', next),
        selectClassName: 'h-9 w-full rounded border px-3 text-sm',
      },
      {
        key: 'lifecycleStage',
        kind: 'dictionary',
        label: t('customers.people.detail.fields.lifecycleStage'),
        value: person.lifecycleStage ?? null,
        emptyLabel: t('customers.people.detail.noValue'),
        dictionaryKind: 'lifecycle-stages',
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
        selectClassName: 'h-9 w-full rounded border px-3 text-sm',
      },
      {
        key: 'source',
        kind: 'dictionary',
        label: t('customers.people.form.source'),
        value: person.source ?? null,
        emptyLabel: t('customers.people.detail.noValue'),
        dictionaryKind: 'sources',
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
              {activeTab !== 'notes' ? (
                <SectionLoader
                  isLoading={sectionPending[activeTab as SectionKey]}
                  label={sectionLoaderLabel}
                />
              ) : null}
              {activeTab === 'notes' && (
                <NotesSection
                  entityId={personId}
                  dealOptions={dealSelectOptions}
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
                  translator={detailTranslator}
                  onLoadingChange={handleNotesLoadingChange}
                />
              )}
              {activeTab === 'activities' && (
                <ActivitiesSection
                  entityId={personId}
                  dealOptions={dealSelectOptions}
                  defaultEntityId={personId ?? undefined}
                  addActionLabel={t('customers.people.detail.activities.add')}
                  emptyState={{
                    title: t('customers.people.detail.emptyState.activities.title'),
                    actionLabel: t('customers.people.detail.emptyState.activities.action'),
                  }}
                  onActionChange={handleSectionActionChange}
                  onLoadingChange={handleActivitiesLoadingChange}
                />
              )}
              {activeTab === 'deals' && (
                <DealsSection
                  scope={dealsScope}
                  emptyLabel={t('customers.people.detail.empty.deals')}
                  addActionLabel={t('customers.people.detail.actions.addDeal')}
                  emptyState={{
                    title: t('customers.people.detail.emptyState.deals.title'),
                    actionLabel: t('customers.people.detail.emptyState.deals.action'),
                  }}
                  onActionChange={handleSectionActionChange}
                  onLoadingChange={handleDealsLoadingChange}
                  translator={detailTranslator}
                />
              )}
              {activeTab === 'addresses' && (
                <AddressesSection
                  entityId={personId}
                  emptyLabel={t('customers.people.detail.empty.addresses')}
                  addActionLabel={t('customers.people.detail.addresses.add')}
                  emptyState={{
                    title: t('customers.people.detail.emptyState.addresses.title'),
                    actionLabel: t('customers.people.detail.emptyState.addresses.action'),
                  }}
                  onActionChange={handleSectionActionChange}
                  onLoadingChange={handleAddressesLoadingChange}
                  translator={detailTranslator}
                />
              )}
              {activeTab === 'tasks' && (
                <TasksSection
                  entityId={personId}
                  initialTasks={data.todos}
                  emptyLabel={t('customers.people.detail.empty.todos')}
                  addActionLabel={t('customers.people.detail.tasks.add')}
                  emptyState={{
                    title: t('customers.people.detail.emptyState.tasks.title'),
                    actionLabel: t('customers.people.detail.emptyState.tasks.action'),
                  }}
                  onActionChange={handleSectionActionChange}
                  onLoadingChange={handleTasksLoadingChange}
                  translator={detailTranslator}
                  entityName={personName}
                  dialogContextKey="customers.people.detail.tasks.dialog.context"
                  dialogContextFallback="This task will be linked to {{name}}"
                />
              )}
            </div>
          </div>
  
          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.details')}</h2>
              <DetailFieldsSection fields={detailFields} />
            </div>

            <CustomDataSection
              entityIds={[E.customers.customer_entity, E.customers.customer_person_profile]}
              values={data.customFields ?? {}}
              onSubmit={handleCustomFieldsSubmit}
              title={t('customers.people.detail.sections.customFields')}
            />
  
            <TagsSection
              entityId={data.person.id}
              tags={data.tags}
              onChange={handleTagsChange}
              isSubmitting={false}
            />
          </div>
  
        </PageBody>
      </Page>
    )
  }
  
