"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@/lib/i18n/context'

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

function formatDateTime(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

export default function CustomerPersonDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const [data, setData] = React.useState<PersonOverview | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

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
        flash(message, 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

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

  if (error || !data) {
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

  const highlights: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: t('customers.people.detail.highlights.primaryEmail'),
      value: person.primaryEmail || <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span>,
    },
    {
      label: t('customers.people.detail.highlights.primaryPhone'),
      value: person.primaryPhone || <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span>,
    },
    {
      label: t('customers.people.detail.highlights.status'),
      value: person.status || <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span>,
    },
    {
      label: t('customers.people.detail.highlights.nextInteraction'),
      value: person.nextInteractionAt
        ? (
          <span className="flex flex-col">
            <span>{formatDateTime(person.nextInteractionAt)}</span>
            {person.nextInteractionName && <span className="text-xs text-muted-foreground">{person.nextInteractionName}</span>}
          </span>
        )
        : <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span>,
    },
  ]

  const detailFields: Array<{ label: string; value: React.ReactNode }> = [
    { label: t('customers.people.detail.fields.displayName'), value: person.displayName },
    { label: t('customers.people.detail.fields.description'), value: person.description || <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span> },
    { label: t('customers.people.detail.fields.lifecycleStage'), value: person.lifecycleStage || <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span> },
    { label: t('customers.people.detail.fields.source'), value: person.source || <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span> },
    { label: t('customers.people.detail.fields.jobTitle'), value: profile?.jobTitle || <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span> },
    { label: t('customers.people.detail.fields.department'), value: profile?.department || <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span> },
    { label: t('customers.people.detail.fields.linkedIn'), value: profile?.linkedInUrl ? <Link href={profile.linkedInUrl} target="_blank" className="underline">{profile.linkedInUrl}</Link> : <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span> },
    { label: t('customers.people.detail.fields.twitter'), value: profile?.twitterUrl ? <Link href={profile.twitterUrl} target="_blank" className="underline">{profile.twitterUrl}</Link> : <span className="text-muted-foreground">{t('customers.people.detail.noValue')}</span> },
  ]

  const customFieldEntries = Object.entries(data.customFields || {})

  return (
    <Page>
      <PageBody className="space-y-6">
        <header className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('customers.people.detail.person')}</p>
            <h1 className="text-2xl font-semibold leading-tight">{person.displayName}</h1>
            {profile && (
              <p className="text-sm text-muted-foreground">
                {[profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.preferredName || ''}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/backend/customers/people">{t('customers.people.detail.actions.backToList')}</Link>
            </Button>
            <Button variant="default" disabled>
              {t('customers.people.detail.actions.edit')}
            </Button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {highlights.map((highlight) => (
            <div key={highlight.label} className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{highlight.label}</p>
              <div className="mt-2 text-sm font-medium">{highlight.value}</div>
            </div>
          ))}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),340px]">
          <main className="space-y-6">
            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.activities')}</h2>
              <Separator className="my-3" />
              {data.activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('customers.people.detail.empty.activities')}</p>
              ) : (
                <ul className="space-y-4">
                  {data.activities.map((activity) => (
                    <li key={activity.id} className="rounded border px-3 py-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-medium uppercase tracking-wide">{activity.activityType}</span>
                        <span>{formatDateTime(activity.occurredAt) || formatDateTime(activity.createdAt) || t('customers.people.detail.noValue')}</span>
                      </div>
                      {activity.subject && <p className="mt-1 text-sm font-medium">{activity.subject}</p>}
                      {activity.body && <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{activity.body}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.comments')}</h2>
              <Separator className="my-3" />
              {data.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('customers.people.detail.empty.comments')}</p>
              ) : (
                <ul className="space-y-4">
                  {data.comments.map((comment) => (
                    <li key={comment.id} className="rounded border px-3 py-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{comment.authorUserId || t('customers.people.detail.anonymous')}</span>
                        <span>{formatDateTime(comment.createdAt) || t('customers.people.detail.noValue')}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.deals')}</h2>
                <Button variant="outline" size="sm" disabled>{t('customers.people.detail.actions.addDeal')}</Button>
              </div>
              <Separator className="my-3" />
              {data.deals.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('customers.people.detail.empty.deals')}</p>
              ) : (
                <ul className="space-y-3">
                  {data.deals.map((deal) => (
                    <li key={deal.id} className="rounded border px-3 py-2">
                      <div className="flex items-center justify-between text-sm font-semibold">
                        <span>{deal.title}</span>
                        {deal.status && <span className="text-xs text-muted-foreground uppercase tracking-wide">{deal.status}</span>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {deal.pipelineStage && <span>{deal.pipelineStage}</span>}
                        {deal.valueAmount && deal.valueCurrency && (
                          <span className="ml-2">
                            {new Intl.NumberFormat(undefined, { style: 'currency', currency: deal.valueCurrency }).format(Number(deal.valueAmount))}
                          </span>
                        )}
                        {deal.expectedCloseAt && (
                          <span className="ml-2">
                            {formatDateTime(deal.expectedCloseAt)}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </main>

          <aside className="space-y-6">
            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.details')}</h2>
              <Separator className="my-3" />
              <dl className="space-y-3 text-sm">
                {detailFields.map((field) => (
                  <div key={field.label}>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">{field.label}</dt>
                    <dd className="mt-1">{field.value}</dd>
                  </div>
                ))}
                {customFieldEntries.length > 0 && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('customers.people.detail.sections.customFields')}</dt>
                    <dd className="mt-1 space-y-2">
                      {customFieldEntries.map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                          <span className="font-medium">{key}</span>
                          <span>{String(value ?? '')}</span>
                        </div>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.tags')}</h2>
                <Button variant="outline" size="sm" disabled>{t('customers.people.detail.actions.manageTags')}</Button>
              </div>
              <Separator className="my-3" />
              {data.tags.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('customers.people.detail.empty.tags')}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                      style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.addresses')}</h2>
                <Button variant="outline" size="sm" disabled>{t('customers.people.detail.actions.manageAddresses')}</Button>
              </div>
              <Separator className="my-3" />
              {data.addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('customers.people.detail.empty.addresses')}</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {data.addresses.map((address) => (
                    <li key={address.id} className="rounded border px-3 py-2">
                      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                        <span>{address.name || address.purpose || t('customers.people.detail.address')}</span>
                        {address.isPrimary && <span className="text-emerald-600">{t('customers.people.detail.primary')}</span>}
                      </div>
                      <div className="mt-1">
                        <p>{address.addressLine1}</p>
                        {address.addressLine2 && <p>{address.addressLine2}</p>}
                        <p>
                          {[address.postalCode, address.city].filter(Boolean).join(' ')}
                          {address.region ? `, ${address.region}` : ''}
                        </p>
                        {address.country && <p>{address.country}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t('customers.people.detail.sections.todos')}</h2>
                <Button variant="outline" size="sm" disabled>{t('customers.people.detail.actions.linkTodo')}</Button>
              </div>
              <Separator className="my-3" />
              {data.todos.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('customers.people.detail.empty.todos')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.todos.map((todo) => (
                    <li key={todo.id} className="flex flex-col rounded border px-3 py-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{todo.todoSource}</span>
                        <span>{formatDateTime(todo.createdAt) || t('customers.people.detail.noValue')}</span>
                      </div>
                      <span className="font-medium">{todo.todoId}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}
