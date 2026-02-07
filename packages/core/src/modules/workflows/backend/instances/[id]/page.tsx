'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { WorkflowInstance, WorkflowEvent, WorkflowDefinition } from '../../../data/entities'
import { WorkflowGraphReadOnly } from '../../../components/WorkflowGraph'
import { WorkflowLegend } from '../../../components/WorkflowLegend'
import { definitionToGraph } from '../../../lib/graph-utils'
import { Node } from '@xyflow/react'

export default function WorkflowInstanceDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
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

  const { data: workflowDefinition, isLoading: definitionLoading } = useQuery({
    queryKey: ['workflow-definition-for-instance', instance?.definitionId],
    queryFn: async () => {
      // Fetch definition by ID
      const response = await apiFetch(`/api/workflows/definitions/${instance!.definitionId}`)
      if (!response.ok) {
        console.error('Failed to fetch workflow definition:', response.statusText)
        return null
      }
      const result = await response.json()
      return result.data as WorkflowDefinition
    },
    enabled: !!instance?.definitionId,
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
      case 'WAITING_FOR_ACTIVITIES':
        return 'bg-cyan-100 text-cyan-800'
      case 'COMPLETED':
        return 'bg-green-100 text-green-800'
      case 'FAILED':
        return 'bg-red-100 text-red-800'
      case 'CANCELLED':
        return 'bg-muted text-foreground dark:bg-muted dark:text-foreground'
      case 'COMPENSATING':
        return 'bg-orange-100 text-orange-800'
      case 'COMPENSATED':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  const getEventTypeBadgeClass = (eventType: string) => {
    if (eventType.includes('COMPENSATION') || eventType.includes('Compensation')) {
      return 'bg-orange-100 text-orange-800'
    } else if (eventType.includes('STARTED') || eventType.includes('ENTERED')) {
      return 'bg-blue-100 text-blue-800'
    } else if (eventType.includes('COMPLETED') || eventType.includes('EXITED')) {
      return 'bg-green-100 text-green-800'
    } else if (eventType.includes('FAILED') || eventType.includes('REJECTED')) {
      return 'bg-red-100 text-red-800'
    } else if (eventType.includes('CANCELLED')) {
      return 'bg-muted text-foreground dark:bg-muted dark:text-foreground'
    } else if (eventType.includes('PAUSED')) {
      return 'bg-yellow-100 text-yellow-800'
    } else {
      return 'bg-muted text-foreground'
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
      flash(t('workflows.instances.messages.cancelled'), 'success')
      queryClient.invalidateQueries({ queryKey: ['workflow-instance', id] })
    },
    onError: (error) => {
      console.error('Error cancelling instance:', error)
      flash(t('workflows.instances.cancelFailed'), 'error')
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
      flash(t('workflows.instances.messages.retried'), 'success')
      queryClient.invalidateQueries({ queryKey: ['workflow-instance', id] })
    },
    onError: (error) => {
      console.error('Error retrying instance:', error)
      flash(t('workflows.instances.retryFailed'), 'error')
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

  // Generate graph with execution status
  const { graphNodes, graphEdges } = React.useMemo(() => {
    if (!workflowDefinition?.definition) {
      return { graphNodes: [], graphEdges: [] }
    }

    // Convert definition to graph
    const { nodes, edges } = definitionToGraph(workflowDefinition.definition, { autoLayout: true })

    // Determine step statuses from events
    const stepStatuses = new Map<string, 'completed' | 'active' | 'pending' | 'failed' | 'skipped'>()
    const stepTimings = new Map<string, { startedAt?: Date; completedAt?: Date }>()

    // Process events to determine status
    for (const event of events) {
      const stepId = event.eventData?.stepId || event.eventData?.toStepId
      if (!stepId) continue

      if (event.eventType === 'STEP_ENTERED' || event.eventType === 'StepEntered') {
        stepTimings.set(stepId, { ...stepTimings.get(stepId), startedAt: new Date(event.occurredAt) })
        if (!stepStatuses.has(stepId)) {
          stepStatuses.set(stepId, 'active')
        }
      } else if (event.eventType === 'STEP_COMPLETED' || event.eventType === 'STEP_EXITED' || event.eventType === 'StepExited') {
        stepTimings.set(stepId, { ...stepTimings.get(stepId), completedAt: new Date(event.occurredAt) })
        stepStatuses.set(stepId, 'completed')
      } else if (event.eventType === 'STEP_FAILED' || event.eventType === 'StepFailed') {
        stepTimings.set(stepId, { ...stepTimings.get(stepId), completedAt: new Date(event.occurredAt) })
        stepStatuses.set(stepId, 'failed')
      }
    }

    // Mark current step as active
    if (instance?.currentStepId && !stepStatuses.has(instance.currentStepId)) {
      stepStatuses.set(instance.currentStepId, 'active')
    } else if (instance?.currentStepId && stepStatuses.get(instance.currentStepId) !== 'completed') {
      stepStatuses.set(instance.currentStepId, 'active')
    }

    // Mark all other steps as pending, with special handling for START/END
    for (const node of nodes) {
      if (!stepStatuses.has(node.id)) {
        const nodeType = node.type
        const isCurrentStep = instance?.currentStepId === node.id

        if (nodeType === 'start') {
          // START node is completed if we've moved past it
          // It's active if we're still at start (edge case)
          if (isCurrentStep) {
            stepStatuses.set(node.id, 'active')
          } else {
            stepStatuses.set(node.id, 'completed')
          }
        } else if (nodeType === 'end') {
          // END node is completed if we've reached it
          // Or if workflow is in COMPLETED status
          if (isCurrentStep || instance?.status === 'COMPLETED') {
            stepStatuses.set(node.id, 'completed')
          } else {
            stepStatuses.set(node.id, 'pending')
          }
        } else {
          // All other nodes without events are pending
          stepStatuses.set(node.id, 'pending')
        }
      }
    }

    // Apply styles to nodes based on status
    const styledNodes: Node[] = nodes.map((node) => {
      const status = stepStatuses.get(node.id) || 'pending'
      const timing = stepTimings.get(node.id)

      // Calculate duration for tooltip
      const duration = timing?.startedAt && timing?.completedAt
        ? calculateDuration(timing.startedAt, timing.completedAt)
        : timing?.startedAt
        ? calculateDuration(timing.startedAt, null)
        : null

      // Build tooltip content
      let tooltipContent = `${node.data.label || node.id}\n`
      tooltipContent += `Status: ${status}\n`
      if (timing?.startedAt) {
        tooltipContent += `Started: ${timing.startedAt.toLocaleString()}\n`
      }
      if (timing?.completedAt) {
        tooltipContent += `Completed: ${timing.completedAt.toLocaleString()}\n`
      }
      if (duration) {
        tooltipContent += `Duration: ${duration}`
      }

      // Define colors and styles based on status
      let style: React.CSSProperties = {}
      switch (status) {
        case 'completed':
          style = {
            backgroundColor: '#10B981', // green-500
            color: 'white',
            borderColor: '#059669', // green-600
            borderWidth: '3px',
            borderRadius: '16px',
          }
          break
        case 'active':
          style = {
            backgroundColor: '#3B82F6', // blue-500
            color: 'white',
            borderColor: '#1D4ED8', // blue-700
            borderWidth: '3px',
            borderRadius: '16px',
            boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.3)',
          }
          break
        case 'failed':
          style = {
            backgroundColor: '#EF4444', // red-500
            color: 'white',
            borderColor: '#B91C1C', // red-700
            borderWidth: '3px',
            borderRadius: '16px',
          }
          break
        case 'skipped':
          style = {
            backgroundColor: '#FEF3C7', // yellow-100
            color: '#78350F', // yellow-900
            borderColor: '#F59E0B', // yellow-500
            borderWidth: '3px',
            borderRadius: '16px',
          }
          break
        case 'pending':
        default:
          style = {
            backgroundColor: '#E5E7EB', // gray-200
            color: '#374151', // gray-700
            borderColor: '#9CA3AF', // gray-400
            borderWidth: '2px',
            borderRadius: '8px',
          }
          break
      }

      return {
        ...node,
        data: {
          ...node.data,
          status,
          timing,
          duration,
          tooltip: tooltipContent,
        },
        style,
      }
    })

    return { graphNodes: styledNodes, graphEdges: edges }
  }, [workflowDefinition, events, instance?.currentStepId])

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
          <FormHeader
            mode="detail"
            backHref="/backend/instances"
            backLabel={t('workflows.instances.backToList', 'Back to instances')}
            entityTypeLabel={t('workflows.instances.detail.type', 'Workflow instance')}
            title={
              <div className="flex flex-wrap items-center gap-2">
                <span>{instance.workflowId}</span>
                <span className="font-mono text-sm text-muted-foreground">#{instance.id.slice(0, 8)}</span>
              </div>
            }
            menuActions={[
              ...(canCancel ? [{
                id: 'cancel',
                label: t('workflows.instances.actions.cancel'),
                onSelect: handleCancel,
                disabled: actionLoading,
              }] : []),
              ...(canRetry ? [{
                id: 'retry',
                label: t('workflows.instances.actions.retry'),
                onSelect: handleRetry,
                disabled: actionLoading,
              }] : []),
            ]}
          />

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

          {/* Visual Workflow Graph */}
          {definitionLoading && (
            <div className="rounded-lg border bg-card p-6">
              <div className="flex items-center justify-center py-8">
                <Spinner className="h-6 w-6" />
                <span className="ml-2 text-sm text-muted-foreground">Loading workflow visualization...</span>
              </div>
            </div>
          )}
          {!definitionLoading && workflowDefinition && graphNodes.length > 0 && (
            <div className="rounded-lg border bg-card p-4 md:p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">
                {t('workflows.instances.sections.visualFlow') || 'Visual Workflow Flow'}
              </h2>

              <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
                {/* Left Sidebar - Legend */}
                <div className="order-2 lg:order-1 lg:w-64 lg:flex-shrink-0">
                  <WorkflowLegend />
                </div>

                {/* Main Visualization */}
                <div className="order-1 lg:order-2 flex-1 border rounded-lg overflow-hidden h-[62svh] min-h-[360px] lg:h-[800px]">
                  <WorkflowGraphReadOnly
                    nodes={graphNodes}
                    edges={graphEdges}
                    height="100%"
                  />
                </div>
              </div>
            </div>
          )}
          {!definitionLoading && !workflowDefinition && instance && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">
                {t('workflows.instances.sections.visualFlow') || 'Visual Workflow Flow'}
              </h2>
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <p className="text-sm">Workflow definition not found (ID: {instance.definitionId})</p>
              </div>
            </div>
          )}


          {/* Compensation Status */}
          {(instance.status === 'COMPENSATING' || instance.status === 'COMPENSATED') && (
            <div className="rounded-lg border border-orange-300 bg-orange-50 p-6">
              <h2 className="text-lg font-semibold mb-4 text-orange-800">
                {t('workflows.instances.sections.compensation') || 'Compensation (Saga Pattern)'}
              </h2>
              <div className="space-y-4">
                <p className="text-sm text-orange-700">
                  {instance.status === 'COMPENSATING'
                    ? (t('workflows.instances.compensation.inProgress') || 'Workflow is currently executing compensation activities to rollback changes.')
                    : (t('workflows.instances.compensation.completed') || 'Compensation has been completed. All changes have been rolled back.')}
                </p>

                {/* Show compensation activities from events */}
                {events.filter(e =>
                  e.eventType.includes('COMPENSATION') ||
                  e.eventType.includes('Compensation')
                ).length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium text-orange-800 mb-2">
                      {t('workflows.instances.compensation.activities') || 'Compensation Activities'}
                    </h3>
                    <div className="space-y-2">
                      {events
                        .filter(e => e.eventType.includes('COMPENSATION') || e.eventType.includes('Compensation'))
                        .reverse()
                        .map((event) => (
                          <div key={event.id} className="flex items-start gap-2 p-2 bg-card rounded border border-orange-200">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getEventTypeBadgeClass(
                                event.eventType
                              )}`}
                            >
                              {event.eventType}
                            </span>
                            <span className="text-xs text-orange-600">
                              {new Date(event.occurredAt).toLocaleTimeString()}
                            </span>
                            {event.eventData?.activityName && (
                              <span className="text-xs text-orange-700 font-medium">
                                {event.eventData.activityName}
                              </span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

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
                            {event.eventData.toStepId && `-> ${event.eventData.toStepId}`}
                            {event.eventData.fromStepId && `${event.eventData.fromStepId} -> ${event.eventData.toStepId}`}
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
