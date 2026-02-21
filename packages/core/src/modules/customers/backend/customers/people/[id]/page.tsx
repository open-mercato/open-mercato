"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { E } from '#generated/entities.ids.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  ActivitiesSection,
} from '../../../../components/detail/ActivitiesSection'
import {
  NotesSection,
  type CommentSummary,
  type SectionAction,
} from '@open-mercato/ui/backend/detail'
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
  renderMultilineMarkdownDisplay,
  InlineDictionaryEditor,
} from '../../../../components/detail/InlineEditors'
import { DetailFieldsSection, type DetailFieldConfig } from '@open-mercato/ui/backend/detail'
import { isValidSocialUrl } from '@open-mercato/core/modules/customers/lib/detailHelpers'
import type { ActivitySummary, DealSummary, TagSummary, TodoLinkSummary } from '../../../../components/detail/types'
import { CustomDataSection } from '../../../../components/detail/CustomDataSection'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { normalizeCustomFieldSubmitValue } from '../../../../components/detail/customFieldUtils'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { ICON_SUGGESTIONS } from '../../../../lib/dictionaries'
import { createCustomerNotesAdapter } from '../../../../components/detail/notesAdapter'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../../../lib/markdownPreference'
import { InjectionSpot, useInjectionSpotEvents, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { DetailTabsLayout } from '../../../../components/detail/DetailTabsLayout'
import {
  GLOBAL_MUTATION_INJECTION_SPOT_ID,
  dispatchBackendMutationError,
} from '@open-mercato/ui/backend/injection/mutationEvents'

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

type SectionKey = 'notes' | 'activities' | 'deals' | 'addresses' | 'tasks' | string

type ProfileEditableField = 'firstName' | 'lastName' | 'jobTitle' | 'department' | 'linkedInUrl' | 'twitterUrl'


export default function CustomerPersonDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
  const notesAdapter = React.useMemo(() => createCustomerNotesAdapter(detailTranslator), [detailTranslator])
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
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)
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

  const personId = data?.person?.id ?? null
  const lastMutationRef = React.useRef<{
    operation: () => Promise<unknown>
    payload: Record<string, unknown>
  } | null>(null)
  const runMutationRef = React.useRef<
    (operation: () => Promise<unknown>, mutationPayload?: Record<string, unknown>) => Promise<unknown>
  >(async (operation) => operation())
  const retryLastMutation = React.useCallback(async () => {
    const lastMutation = lastMutationRef.current
    if (!lastMutation) return false
    try {
      await runMutationRef.current(lastMutation.operation, lastMutation.payload)
      return true
    } catch {
      return false
    }
  }, [])
  const mutationContextId = React.useMemo(
    () => (personId ? `customer-person:${personId}` : `customer-person:${id ?? 'pending'}`),
    [id, personId],
  )
  const injectionContext = React.useMemo(
    () => ({
      formId: mutationContextId,
      personId,
      resourceKind: 'customers.person',
      resourceId: personId ?? (id ?? undefined),
      data,
      retryLastMutation,
    }),
    [data, id, mutationContextId, personId, retryLastMutation],
  )
  const mutationInjectionContext = injectionContext
  const { triggerEvent: triggerMutationInjectionEvent } = useInjectionSpotEvents(GLOBAL_MUTATION_INJECTION_SPOT_ID)
  const emitMutationSaveError = React.useCallback(
    (error: unknown) => {
      dispatchBackendMutationError({
        contextId: mutationContextId,
        formId: mutationContextId,
        error,
      })
    },
    [mutationContextId],
  )
  const runMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      const payload = mutationPayload ?? {}
      lastMutationRef.current = {
        operation: operation as () => Promise<unknown>,
        payload,
      }
      const beforeSave = await triggerMutationInjectionEvent('onBeforeSave', payload, mutationInjectionContext)
      if (!beforeSave.ok) {
        emitMutationSaveError(beforeSave.details ?? beforeSave)
        throw new Error(beforeSave.message || t('ui.forms.flash.saveBlocked', 'Save blocked by validation'))
      }
      try {
        const result =
          beforeSave.requestHeaders && Object.keys(beforeSave.requestHeaders).length > 0
            ? await withScopedApiRequestHeaders(beforeSave.requestHeaders, operation)
            : await operation()
        try {
          await triggerMutationInjectionEvent('onAfterSave', payload, mutationInjectionContext)
        } catch (afterSaveError) {
          console.error('[CustomerPersonDetailPage] Error in onAfterSave injection event:', afterSaveError)
        }
        return result
      } catch (error) {
        emitMutationSaveError(error)
        throw error
      }
    },
    [emitMutationSaveError, mutationInjectionContext, t, triggerMutationInjectionEvent],
  )
  React.useEffect(() => {
    runMutationRef.current = (operation, mutationPayload) => runMutation(operation as () => Promise<unknown>, mutationPayload)
  }, [runMutation])
  const { widgets: injectedTabWidgets } = useInjectionWidgets('customers.person.detail:tabs', {
    context: injectionContext,
    triggerOnLoad: true,
  })
  const injectedTabs = React.useMemo(
    () =>
      (injectedTabWidgets ?? [])
        .filter((widget) => (widget.placement?.kind ?? 'tab') === 'tab')
        .map((widget) => {
          const id = widget.placement?.groupId ?? widget.widgetId
          const label = widget.placement?.groupLabel ?? widget.module.metadata.title
          const priority = typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0
          const render = () => (
            <widget.module.Widget
              context={injectionContext}
              data={data}
              onDataChange={(next) => setData(next as PersonOverview)}
            />
          )
          return { id, label, priority, render }
        })
        .sort((a, b) => b.priority - a.priority),
    [data, injectedTabWidgets, injectionContext],
  )
  const injectedTabMap = React.useMemo(() => new Map(injectedTabs.map((tab) => [tab.id, tab.render])), [injectedTabs])

  const tabs = React.useMemo(
    () => [
      { id: 'notes' as const, label: t('customers.people.detail.tabs.notes') },
      { id: 'activities' as const, label: t('customers.people.detail.tabs.activities') },
      { id: 'deals' as const, label: t('customers.people.detail.tabs.deals') },
      { id: 'addresses' as const, label: t('customers.people.detail.tabs.addresses') },
      { id: 'tasks' as const, label: t('customers.people.detail.tabs.tasks') },
      ...injectedTabs.map((tab) => ({ id: tab.id as SectionKey, label: tab.label })),
    ],
    [injectedTabs, t]
  )

  const personName = React.useMemo(
    () => (data?.person?.displayName ? data.person.displayName : t('customers.people.list.deleteFallbackName')),
    [data?.person?.displayName, t]
  )

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
              const record = deal as Record<string, unknown>
              const id = typeof record.id === 'string' ? record.id : ''
              if (!id) return null
              const rawTitle = typeof record.title === 'string' ? record.title.trim() : ''
              const label = rawTitle.length ? rawTitle : id
              return { id, label }
            })
            .filter((option): option is { id: string; label: string } => option !== null)
        : [],
    [data?.deals],
  )
  const handleNotesLoadingChange = React.useCallback(() => {}, [])

  const handleActivitiesLoadingChange = React.useCallback(() => {}, [])

  const handleDealsLoadingChange = React.useCallback(() => {}, [])

  const handleAddressesLoadingChange = React.useCallback(() => {}, [])

  const handleTasksLoadingChange = React.useCallback(() => {}, [])

  React.useEffect(() => {
    if (!id) {
      setError(t('customers.people.detail.error.notFound'))
      setIsLoading(false)
      return
    }
    const personId = id
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<PersonOverview>(
          `/api/customers/people/${encodeURIComponent(personId)}?include=todos`,
          undefined,
          { errorMessage: t('customers.people.detail.error.load') },
        )
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
      const payload = { id: data.person.id, ...patch }
      await runMutation(
        () => apiCallOrThrow(
          '/api/customers/people',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('customers.people.detail.inline.error') },
        ),
        payload,
      )
      setData((prev) => (prev ? apply(prev) : prev))
    },
    [data, runMutation, t]
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
    const confirmed = await confirm({
      title: t('customers.people.list.deleteConfirm', undefined, { name: personName }),
      variant: 'destructive',
    })
    if (!confirmed) return
    setIsDeleting(true)
    try {
      await runMutation(
        () => apiCallOrThrow(
          `/api/customers/people?id=${encodeURIComponent(personId)}`,
          {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
          },
          { errorMessage: t('customers.people.list.deleteError') },
        ),
        { id: personId },
      )
      flash(t('customers.people.list.deleteSuccess'), 'success')
      router.push('/backend/customers/people')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.list.deleteError')
      flash(message, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [confirm, personId, personName, router, runMutation, t])

  const handleTagsChange = React.useCallback((nextTags: TagOption[]) => {
    setData((prev) => (prev ? { ...prev, tags: nextTags } : prev))
  }, [])
  
  const handleCustomFieldsSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      if (!data) {
        throw new Error(t('customers.people.detail.inline.error'))
      }
      const customPayload = collectCustomFieldValues(values, {
        transform: (value) => normalizeCustomFieldSubmitValue(value),
      })
      const prefixed: Record<string, unknown> = {}
      for (const [fieldId, value] of Object.entries(customPayload)) {
        prefixed[`cf_${fieldId}`] = value
      }
      if (!Object.keys(customPayload).length) {
        flash(t('ui.forms.flash.saveSuccess'), 'success')
        return
      }
      try {
        const payload = {
          id: data.person.id,
          customFields: customPayload,
        }
        await runMutation(
          () => apiCallOrThrow(
            '/api/customers/people',
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            },
            { errorMessage: t('customers.people.detail.inline.error') },
          ),
          payload,
        )
      } catch (err) {
        const { message: helperMessage, fieldErrors } = mapCrudServerErrorToFormErrors(err)
        const mappedErrors = fieldErrors
          ? Object.entries(fieldErrors).reduce<Record<string, string>>((acc, [key, value]) => {
              const formKey = key.startsWith('cf_') ? key : `cf_${key}`
              acc[formKey] = value
              return acc
            }, {})
          : undefined
        const error = new Error(helperMessage ?? t('customers.people.detail.inline.error')) as Error & {
          fieldErrors?: Record<string, string>
        }
        if (mappedErrors && Object.keys(mappedErrors).length) error.fieldErrors = mappedErrors
        throw error
      }
      setData((prev) => {
        if (!prev) return prev
        const nextCustomFields = { ...prefixed }
        return { ...prev, customFields: nextCustomFields }
      })
        flash(t('ui.forms.flash.saveSuccess'), 'success')
      },
      [data, runMutation, t]
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
        kind: 'custom',
        label: t('customers.people.form.jobTitle'),
        emptyLabel: t('customers.people.detail.noValue'),
        render: () => (
          <InlineDictionaryEditor
            label={t('customers.people.form.jobTitle')}
            value={profile?.jobTitle ?? null}
            emptyLabel={t('customers.people.detail.noValue')}
            kind="job-titles"
            onSave={async (next) => updateProfileField('jobTitle', next)}
            selectClassName="h-9 w-full rounded border px-3 text-sm"
            variant="muted"
            activateOnClick
          />
        ),
      },
      {
        key: 'lifecycleStage',
        kind: 'custom',
        label: t('customers.people.detail.fields.lifecycleStage'),
        emptyLabel: t('customers.people.detail.noValue'),
        render: () => (
          <InlineDictionaryEditor
            label={t('customers.people.detail.fields.lifecycleStage')}
            value={person.lifecycleStage ?? null}
            emptyLabel={t('customers.people.detail.noValue')}
            kind="lifecycle-stages"
            onSave={async (next) => {
              const send = typeof next === 'string' ? next : ''
              await savePerson(
                { lifecycleStage: send },
                (prev) => ({
                  ...prev,
                  person: { ...prev.person, lifecycleStage: next && next.length ? next : null },
                })
              )
            }}
            selectClassName="h-9 w-full rounded border px-3 text-sm"
            variant="muted"
            activateOnClick
          />
        ),
      },
      {
        key: 'source',
        kind: 'custom',
        label: t('customers.people.form.source'),
        emptyLabel: t('customers.people.detail.noValue'),
        render: () => (
          <InlineDictionaryEditor
            label={t('customers.people.form.source')}
            value={person.source ?? null}
            emptyLabel={t('customers.people.detail.noValue')}
            kind="sources"
            onSave={async (next) => {
              const send = typeof next === 'string' ? next : ''
              await savePerson(
                { source: send },
                (prev) => ({
                  ...prev,
                  person: { ...prev.person, source: next && next.length ? next : null },
                })
              )
            }}
            selectClassName="h-9 w-full rounded border px-3 text-sm"
            variant="muted"
            activateOnClick
          />
        ),
      },
      {
        key: 'description',
        kind: 'multiline',
        label: t('customers.people.form.description'),
        value: person.description ?? null,
        placeholder: t('customers.people.form.description'),
        emptyLabel: t('customers.people.detail.noValue'),
        gridClassName: 'sm:col-span-2 xl:col-span-3',
        renderDisplay: renderMultilineMarkdownDisplay,
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
  
          <DetailTabsLayout
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            sectionAction={sectionAction}
            onSectionAction={handleSectionAction}
            navAriaLabel={t('customers.people.detail.tabs.label', 'Person detail sections')}
            headerClassName="mb-1"
          >
            {(() => {
              const injected = injectedTabMap.get(activeTab)
              if (injected) return injected()
              if (activeTab === 'notes') {
                return (
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
                    dataAdapter={notesAdapter}
                    renderIcon={renderDictionaryIcon}
                    renderColor={renderDictionaryColor}
                    iconSuggestions={ICON_SUGGESTIONS}
                    readMarkdownPreference={readMarkdownPreferenceCookie}
                    writeMarkdownPreference={writeMarkdownPreferenceCookie}
                  />
                )
              }
              if (activeTab === 'activities') {
                return (
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
                )
              }
              if (activeTab === 'deals') {
                return (
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
                )
              }
              if (activeTab === 'addresses') {
                return (
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
                )
              }
              if (activeTab === 'tasks') {
                return (
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
                )
              }
              return null
            })()}
          </DetailTabsLayout>
  
          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.details')}</h2>
              <DetailFieldsSection fields={detailFields} />
              <InjectionSpot
                spotId="customers.person.detail:details"
                context={injectionContext}
                data={data}
                onDataChange={(next) => setData(next as PersonOverview)}
              />
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
        {ConfirmDialogElement}
      </Page>
    )
  }
  
