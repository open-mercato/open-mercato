"use client"

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'

type WorkflowEvent = {
  id: string
  workflowInstanceId: string
  stepInstanceId: string | null
  eventType: string
  eventData: any
  occurredAt: string
  userId: string | null
  tenantId: string
  organizationId: string
  workflowInstance: {
    id: string
    workflowId: string
    version: number
    status: string
    currentStepId: string
    correlationKey: string | null
    startedAt: string | null
    completedAt: string | null
    context: any
  } | null
}

export default function WorkflowEventDetailPage() {
  const router = useRouter()
  const params = useParams()
  const t = useT()

  // Handle both {id: '17'} and {slug: ['events', '17']} formats
  let eventId: string | undefined
  if (params?.id) {
    eventId = Array.isArray(params.id) ? params.id[0] : params.id
  } else if (params?.slug && Array.isArray(params.slug)) {
    // If slug is ['events', '17'], extract '17'
    eventId = params.slug[params.slug.length - 1]
  }

  const { data: event, isLoading, error } = useQuery({
    queryKey: ['workflows', 'events', eventId],
    queryFn: async () => {
      const response = await apiFetch(`/api/workflows/events/${eventId}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(t('workflows.events.messages.loadFailed'))
      }
      const result = await response.json()
      return result as WorkflowEvent
    },
    enabled: !!eventId,
  })

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('workflows.common.loading')}</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !event) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <p>{error ? t('workflows.events.messages.loadFailed') : t('workflows.events.notFound')}</p>
            <Button asChild variant="outline">
              <Link href="/backend/events">
                {t('workflows.events.backToList')}
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const getEventTypeBadgeClass = (eventType: string) => {
    if (eventType.includes('STARTED')) return 'bg-blue-100 text-blue-800'
    if (eventType.includes('COMPLETED')) return 'bg-green-100 text-green-800'
    if (eventType.includes('FAILED') || eventType.includes('REJECTED')) return 'bg-red-100 text-red-800'
    if (eventType.includes('CANCELLED')) return 'bg-muted text-foreground dark:bg-muted dark:text-foreground'
    if (eventType.includes('ENTERED') || eventType.includes('EXITED')) return 'bg-purple-100 text-purple-800'
    return 'bg-muted text-foreground dark:bg-muted dark:text-foreground'
  }

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-100 text-green-800'
      case 'RUNNING':
        return 'bg-blue-100 text-blue-800'
      case 'FAILED':
        return 'bg-red-100 text-red-800'
      case 'CANCELLED':
        return 'bg-muted text-foreground dark:bg-muted dark:text-foreground'
      default:
        return 'bg-muted text-foreground dark:bg-muted dark:text-foreground'
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <FormHeader
            mode="detail"
            backHref="/backend/events"
            backLabel={t('workflows.events.backToList', 'Back to events')}
            entityTypeLabel={t('workflows.events.detail.type', 'Workflow event')}
            title={
              <div className="flex flex-wrap items-center gap-2">
                <span>{event.eventType}</span>
                <span className="font-mono text-sm text-muted-foreground">#{event.id.slice(0, 8)}</span>
              </div>
            }
            statusBadge={
              <span
                className={`inline-flex items-center px-3 py-1 rounded text-sm font-medium ${getEventTypeBadgeClass(event.eventType)}`}
              >
                {event.eventType}
              </span>
            }
          />

          {/* Event Summary */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">
              {t('workflows.events.detail.summary')}
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.events.fields.occurredAt')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {new Date(event.occurredAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.events.fields.eventType')}
                </dt>
                <dd className="mt-1">
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getEventTypeBadgeClass(
                      event.eventType
                    )}`}
                  >
                    {event.eventType}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.events.fields.userId')}
                </dt>
                <dd className="mt-1 text-sm text-foreground font-mono">
                  {event.userId || t('common.none')}
                </dd>
              </div>
              {event.stepInstanceId && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('workflows.events.detail.stepInstanceId')}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground font-mono">
                    {event.stepInstanceId}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Workflow Instance Information */}
          {event.workflowInstance && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">
                {t('workflows.events.detail.workflowInstance')}
              </h2>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('workflows.instances.fields.instanceId')}
                  </dt>
                  <dd className="mt-1">
                    <Link
                      href={`/backend/instances/${event.workflowInstance.id}`}
                      className="text-sm text-primary hover:underline font-mono"
                    >
                      {event.workflowInstance.id}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('workflows.instances.fields.status')}
                  </dt>
                  <dd className="mt-1">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClass(
                        event.workflowInstance.status
                      )}`}
                    >
                      {event.workflowInstance.status}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('workflows.instances.fields.workflowId')}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground font-mono">
                    {event.workflowInstance.workflowId}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('workflows.instances.fields.version')}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">
                    {event.workflowInstance.version}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('workflows.instances.fields.currentStep')}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground font-mono">
                    {event.workflowInstance.currentStepId}
                  </dd>
                </div>
                {event.workflowInstance.correlationKey && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">
                      {t('workflows.instances.fields.correlationKey')}
                    </dt>
                    <dd className="mt-1 text-sm text-foreground font-mono">
                      {event.workflowInstance.correlationKey}
                    </dd>
                  </div>
                )}
                {event.workflowInstance.startedAt && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">
                      {t('workflows.instances.fields.startedAt')}
                    </dt>
                    <dd className="mt-1 text-sm text-foreground">
                      {new Date(event.workflowInstance.startedAt).toLocaleString()}
                    </dd>
                  </div>
                )}
                {event.workflowInstance.completedAt && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">
                      {t('workflows.instances.fields.completedAt')}
                    </dt>
                    <dd className="mt-1 text-sm text-foreground">
                      {new Date(event.workflowInstance.completedAt).toLocaleString()}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Event Data */}
          <JsonDisplay
            data={event.eventData}
            title={t('workflows.events.detail.eventData')}
          />

          {/* Workflow Context (if available) */}
          {event.workflowInstance?.context && (
            <JsonDisplay
              data={event.workflowInstance.context}
              title={t('workflows.events.detail.workflowContext')}
            />
          )}

          {/* Technical Details */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">
              {t('workflows.events.detail.technicalDetails')}
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.events.detail.tenantId')}
                </dt>
                <dd className="mt-1 text-sm text-foreground font-mono">
                  {event.tenantId}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.events.detail.organizationId')}
                </dt>
                <dd className="mt-1 text-sm text-foreground font-mono">
                  {event.organizationId}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
