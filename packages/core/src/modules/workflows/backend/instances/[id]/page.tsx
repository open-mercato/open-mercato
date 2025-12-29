'use client'

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { useT } from '@/lib/i18n/context'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { WorkflowInstance, WorkflowEvent } from '../../../data/entities'

export default function WorkflowInstanceDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: instance, isLoading, error } = useQuery({
    queryKey: ['workflow-instance', id],
    queryFn: async () => {
      const response = await apiFetch(`/api/workflows/instances/${id}`)
      if (!response.ok) {
        throw new Error(t('workflows.instances.notFound') || 'Instance not found')
      }
      const data = await response.json()
      return data.data as WorkflowInstance
    },
    enabled: !!id,
  })

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['workflow-events', instance?.id],
    queryFn: async () => {
      const response = await apiFetch(
        `/api/workflows/events?workflowInstanceId=${instance!.id}&sortField=occurredAt&sortDir=desc&pageSize=100`
      )
      if (!response.ok) {
        throw new Error('Failed to fetch events')
      }
      const data = await response.json()
      return (data.items || []) as WorkflowEvent[]
    },
    enabled: !!instance?.id,
  })

  const calculateDuration = (startedAt: string | Date, completedAt: string | Date | null | undefined) => {
    const start = typeof startedAt === 'string' ? new Date(startedAt).getTime() : startedAt.getTime()
    const end = completedAt ? (typeof completedAt === 'string' ? new Date(completedAt).getTime() : completedAt.getTime()) : Date.now()
    const duration = end - start

    if (duration < 1000) {
      return `${duration}ms`
    } else if (duration < 60000) {
      return `${Math.floor(duration / 1000)}s`
    } else if (duration < 3600000) {
      return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`
    } else {
      const hours = Math.floor(duration / 3600000)
      const minutes = Math.floor((duration % 3600000) / 60000)
      return `${hours}h ${minutes}m`
    }
  }

  const getStatusBadgeClass = (status: WorkflowInstance['status']) => {
    switch (status) {
      case 'RUNNING':
        return 'bg-blue-100 text-blue-800'
      case 'PAUSED':
        return 'bg-yellow-100 text-yellow-800'
      case 'COMPLETED':
        return 'bg-green-100 text-green-800'
      case 'FAILED':
        return 'bg-red-100 text-red-800'
      case 'CANCELLED':
        return 'bg-gray-100 text-gray-800'
      case 'COMPENSATING':
        return 'bg-orange-100 text-orange-800'
      case 'COMPENSATED':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-gray-100 text-gray-600'
    }
  }

  const getEventTypeBadgeClass = (eventType: string) => {
    if (eventType.includes('STARTED') || eventType.includes('ENTERED')) {
      return 'bg-blue-100 text-blue-800'
    } else if (eventType.includes('COMPLETED') || eventType.includes('EXITED')) {
      return 'bg-green-100 text-green-800'
    } else if (eventType.includes('FAILED') || eventType.includes('REJECTED')) {
      return 'bg-red-100 text-red-800'
    } else if (eventType.includes('CANCELLED')) {
      return 'bg-gray-100 text-gray-800'
    } else if (eventType.includes('PAUSED')) {
      return 'bg-yellow-100 text-yellow-800'
    } else {
      return 'bg-gray-100 text-gray-700'
    }
  }

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await apiFetch(`/api/workflows/instances/${instance!.id}/cancel`, {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(t('workflows.instances.cancelFailed'))
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-instance', id] })
    },
    onError: (error) => {
      console.error('Error cancelling instance:', error)
      alert(t('workflows.instances.cancelFailed'))
    },
  })

  const retryMutation = useMutation({
    mutationFn: async () => {
      const response = await apiFetch(`/api/workflows/instances/${instance!.id}/retry`, {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(t('workflows.instances.retryFailed'))
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-instance', id] })
    },
    onError: (error) => {
      console.error('Error retrying instance:', error)
      alert(t('workflows.instances.retryFailed'))
    },
  })

  const handleCancel = () => {
    if (!instance || !confirm(t('workflows.instances.confirmCancel'))) {
      return
    }
    cancelMutation.mutate()
  }

  const handleRetry = () => {
    if (!instance || !confirm(t('workflows.instances.confirmRetry'))) {
      return
    }
    retryMutation.mutate()
  }

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('workflows.instances.detail.loading') || 'Loading workflow instance...'}</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !instance) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <p>{error ? t('workflows.instances.loadFailed') : t('workflows.instances.detail.notFound') || 'Workflow instance not found.'}</p>
            <Button asChild variant="outline">
              <Link href="/backend/instances">
                {t('workflows.instances.actions.backToList') || 'Back to instances'}
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const canCancel = ['RUNNING', 'PAUSED'].includes(instance.status)
  const canRetry = instance.status === 'FAILED'
  const actionLoading = cancelMutation.isPending || retryMutation.isPending

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{instance.workflowId}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t('workflows.instances.fields.instanceId')}: <span className="font-mono">{instance.id}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              {canCancel && (
                <Button
                  onClick={handleCancel}
                  disabled={actionLoading}
                  variant="outline"
                  size="sm"
                >
                  {t('workflows.instances.actions.cancel')}
                </Button>
              )}
              {canRetry && (
                <Button
                  onClick={handleRetry}
                  disabled={actionLoading}
                  variant="outline"
                  size="sm"
                >
                  {t('workflows.instances.actions.retry')}
                </Button>
              )}
              <Button onClick={() => router.push('/backend/instances')} variant="outline">
                {t('workflows.instances.actions.backToList') || 'Back to list'}
              </Button>
            </div>
          </div>

          {/* Execution Summary */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">
              {t('workflows.instances.sections.overview')}
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.workflowId')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  <div className="font-mono">{instance.workflowId}</div>
                  <div className="text-xs text-muted-foreground">v{instance.version}</div>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.status')}
                </dt>
                <dd className="mt-1">
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClass(
                      instance.status
                    )}`}
                  >
                    {t(`workflows.instances.status.${instance.status}`)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.currentStep')}
                </dt>
                <dd className="mt-1 text-sm text-foreground font-mono">
                  {instance.currentStepId || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.correlationKey')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {instance.correlationKey || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.startedAt')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {new Date(instance.startedAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.completedAt')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {instance.completedAt ? new Date(instance.completedAt).toLocaleString() : '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.duration')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {calculateDuration(instance.startedAt, instance.completedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.retryCount')}
                </dt>
                <dd className="mt-1">
                  <span className={instance.retryCount > 0 ? 'text-orange-600 font-medium text-sm' : 'text-sm text-foreground'}>
                    {instance.retryCount}
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          {/* Error Message (if present) */}
          {instance.errorMessage && (
            <div className="rounded-lg border border-destructive bg-destructive/5 p-6">
              <h2 className="text-lg font-semibold mb-4 text-destructive">
                {t('workflows.instances.fields.lastError')}
              </h2>
              <pre className="text-sm text-destructive whitespace-pre-wrap font-mono">
                {instance.errorMessage}
              </pre>
              {instance.errorDetails && (
                <div className="mt-4">
                  <JsonDisplay
                    data={instance.errorDetails}
                    className="border-destructive/20 bg-destructive/5"
                    maxInitialDepth={1}
                  />
                </div>
              )}
            </div>
          )}

          {/* Context */}
          <JsonDisplay
            data={instance.context}
            title={t('workflows.instances.sections.context')}
          />

          {/* Metadata */}
          {instance.metadata && Object.keys(instance.metadata).length > 0 && (
            <JsonDisplay
              data={instance.metadata}
              title={t('workflows.instances.sections.metadata')}
            />
          )}

          {/* Execution Timeline */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">
              {t('workflows.instances.sections.executionTimeline') || 'Execution Timeline'}
            </h2>
            {eventsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="h-4 w-4" />
                <span className="text-sm">{t('common.loading')}</span>
              </div>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('workflows.instances.noExecutionHistory')}
              </p>
            ) : (
              <div className="space-y-2">
                {events
                  .filter(
                    (e) =>
                      e.eventType.includes('STEP_') ||
                      e.eventType.includes('WORKFLOW_STARTED') ||
                      e.eventType.includes('WORKFLOW_COMPLETED') ||
                      e.eventType.includes('WORKFLOW_FAILED')
                  )
                  .reverse()
                  .map((event, idx) => (
                    <div key={event.id} className="flex items-start gap-3 p-3 bg-muted rounded-lg border">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-background border-2 border-border flex items-center justify-center text-xs font-medium">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getEventTypeBadgeClass(
                              event.eventType
                            )}`}
                          >
                            {t(`workflows.events.types.${event.eventType}`) || event.eventType}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(event.occurredAt).toLocaleTimeString()}
                          </span>
                        </div>
                        {event.eventData && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {event.eventData.toStepId && `→ ${event.eventData.toStepId}`}
                            {event.eventData.fromStepId && `${event.eventData.fromStepId} → ${event.eventData.toStepId}`}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Event Log */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">
              {t('workflows.instances.sections.executionHistory')}
            </h2>
            {eventsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="h-4 w-4" />
                <span className="text-sm">{t('common.loading')}</span>
              </div>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('workflows.instances.noExecutionHistory')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t('workflows.events.occurredAt')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t('workflows.events.eventType')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t('workflows.events.eventData')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t('workflows.events.userId')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-background divide-y divide-border">
                    {events.map((event) => (
                      <tr key={event.id} className="hover:bg-muted/50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">
                          {new Date(event.occurredAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getEventTypeBadgeClass(
                              event.eventType
                            )}`}
                          >
                            {t(`workflows.events.types.${event.eventType}`) || event.eventType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <details className="cursor-pointer">
                            <summary className="text-primary hover:underline">
                              {t('common.details')}
                            </summary>
                            <div className="mt-2">
                              <JsonDisplay
                                data={event.eventData}
                                showCopy={false}
                                maxInitialDepth={1}
                              />
                            </div>
                          </details>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                          {event.userId || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
