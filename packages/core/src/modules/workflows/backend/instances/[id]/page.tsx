'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { FlaskConical, Footprints } from 'lucide-react'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { WorkflowInstance, WorkflowEvent, WorkflowDefinition } from '../../../data/entities'
import { WorkflowGraphReadOnly } from '../../../components/WorkflowGraph'
import { WorkflowLegend } from '../../../components/WorkflowLegend'
import { MobileInstanceOverview } from '../../../components/mobile/MobileInstanceOverview'
import { RunStepInspector } from '../../../components/run/RunStepInspector'
import { RunGantt } from '../../../components/run/RunGantt'
import { RerunStepDialog } from '../../../components/run/RerunStepDialog'
import { useLiveRunUpdates } from '../../../components/run/useLiveRunUpdates'
import { AgentActivityPanel } from '../../../components/run/AgentActivityPanel'
import { RunEventBadge, runEventBadgeClass } from '../../../components/run/RunEventBadge'
import { InstanceStatusBadge, instanceStatusBadgeClass } from '../../../components/run/RunStatusBadge'
import { useIsMobile } from '@open-mercato/ui/hooks/useIsMobile'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { hasFeature } from '@open-mercato/shared/security/features'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { WouldDoReport, type WouldDoReportPayload } from '../../../components/run/WouldDoReport'
import { definitionToGraph } from '../../../lib/graph-utils'
import { PRESENTATION_STEP_STYLES } from '../../../lib/status-colors'
import {
  deriveRunExecution,
  isRouteTaken,
  resolveNodeRunStatus,
  type RunStepInstanceInput,
} from '../../../lib/run-execution'
import {
  presentationToWorkflowStatus,
  readNodeAgentId,
  resolveStepPresentation,
} from '../../../lib/step-presentation'
import { useAgentLabels } from '../../../components/run/useAgentLabels'
import { formatElapsedSince, formatRunDuration } from '../../../lib/run-duration'
import { isRunMilestoneEvent } from '../../../lib/run-event-tone'
import type { Node } from '@xyflow/react'
import { RecordNotFoundState, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

type RunTab = 'flow' | 'timeline' | 'context' | 'raw'

type StepInstancesResponse = {
  data: RunStepInstanceInput[]
  pagination: { total: number; limit: number; offset: number; hasMore: boolean }
}

export default function WorkflowInstanceDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [activeTab, setActiveTab] = React.useState<RunTab>('flow')
  const [selectedStepId, setSelectedStepId] = React.useState<string | null>(null)
  const [rerunOpen, setRerunOpen] = React.useState(false)
  const [rerunPending, setRerunPending] = React.useState(false)
  const [stepThroughPending, setStepThroughPending] = React.useState(false)
  const { payload: chromePayload } = useBackendChrome()
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: 'workflows.instances.rerunStep' })
  const canRerunStep = hasFeature(chromePayload?.grantedFeatures, 'workflows.instances.rerun_step')

  const { data: instance, isLoading, error } = useQuery({
    queryKey: ['workflow-instance', id],
    queryFn: async () => {
      const response = await apiFetch(`/api/workflows/instances/${id}`)
      if (!response.ok) {
        const httpErr = new Error(
          response.status === 404
            ? t('workflows.instances.detail.notFound', 'Workflow instance not found.')
            : t('workflows.instances.loadFailed', 'Failed to load workflow instance.')
        ) as Error & { status: number }
        httpErr.status = response.status
        throw httpErr
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
        throw new Error('[internal] Failed to fetch events')
      }
      const data = await response.json()
      return (data.items || []) as WorkflowEvent[]
    },
    enabled: !!instance?.id,
  })

  // Per-step execution records (spec §8.3). These outrank the event log for
  // step state: there is one row per execution carrying the status, both
  // timestamps, the measured duration and the attempt count, and far fewer of
  // them than there are events — so a long run whose early STEP_ENTERED has
  // fallen off the 100-event page still paints correctly.
  const { data: stepInstances = [], isLoading: stepsLoading } = useQuery({
    queryKey: ['workflow-instance-steps', instance?.id],
    queryFn: async () => {
      const response = await apiFetch(`/api/workflows/instances/${instance!.id}/steps?limit=100`)
      if (!response.ok) {
        throw new Error('[internal] Failed to fetch step instances')
      }
      const data = (await response.json()) as StepInstancesResponse
      return data.data ?? []
    },
    enabled: !!instance?.id,
  })

  // Dry-run "Would do" report (spec section 8.2). Fetched only for a dry run —
  // a real run answers an empty report, so asking for one would be a wasted
  // round trip on every ordinary run view.
  const { data: wouldDoReport } = useQuery({
    queryKey: ['workflow-would-do', instance?.id],
    queryFn: async () => {
      const response = await apiFetch(`/api/workflows/instances/${instance!.id}/would-do?limit=100`)
      if (!response.ok) {
        throw new Error('[internal] Failed to fetch the would-do report')
      }
      return (await response.json()) as WouldDoReportPayload
    },
    enabled: !!instance?.id && instance?.isDryRun === true,
  })

  const stepThroughMarker = instance?.metadata?.stepThrough ?? null
  const isStepping = stepThroughMarker?.enabled === true

  const handleStepThrough = React.useCallback(async (action: 'continue' | 'stop') => {
    if (!instance?.id) return
    setStepThroughPending(true)
    try {
      await runMutation({
        operation: async () => {
          const response = await apiFetch(`/api/workflows/instances/${instance.id}/step-through`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          })
          if (!response.ok) {
            const body = await readJsonSafe<{ error?: string }>(response, null)
            throw new Error(body?.error || t('workflows.stepThrough.failed'))
          }
          return response
        },
        mutationPayload: { resourceId: instance.id, operation: 'step-through' },
        context: {
          formId: 'workflows.instances.stepThrough',
          resourceKind: 'workflows.instance',
          resourceId: instance.id,
          operation: 'step-through',
          retryLastMutation,
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['workflow-instance', id] })
      await queryClient.invalidateQueries({ queryKey: ['workflow-instance-steps', instance.id] })
      await queryClient.invalidateQueries({ queryKey: ['workflow-events', instance.id] })
      await queryClient.invalidateQueries({ queryKey: ['workflow-would-do', instance.id] })
    } catch (error) {
      flash(error instanceof Error ? error.message : t('workflows.stepThrough.failed'), 'error')
    } finally {
      setStepThroughPending(false)
    }
  }, [instance?.id, runMutation, retryLastMutation, queryClient, id, t])

  const { data: workflowDefinition, isLoading: definitionLoading } = useQuery({
    queryKey: ['workflow-definition-for-instance', instance?.definitionId],
    queryFn: async () => {
      const response = await apiFetch(`/api/workflows/definitions/${instance!.definitionId}`)
      if (!response.ok) {
        logger.error('Failed to fetch workflow definition', { statusText: response.statusText })
        return null
      }
      const result = await response.json()
      return result.data as WorkflowDefinition
    },
    enabled: !!instance?.definitionId,
  })

  // Direct sub-workflow children of this instance, used to make SUB_WORKFLOW
  // graph nodes navigable. The parent step that spawned each child is recorded
  // in the child's metadata.labels.parentStepId (= the parent graph node id).
  const { data: childInstances = [] } = useQuery({
    queryKey: ['workflow-instance-children', instance?.id],
    queryFn: async () => {
      const response = await apiFetch(
        `/api/workflows/instances?parentInstanceId=${encodeURIComponent(instance!.id)}&limit=100`
      )
      if (!response.ok) return []
      const data = await response.json()
      return (data.data || []) as WorkflowInstance[]
    },
    enabled: !!instance?.id,
  })

  // Map each parent step id to the child instances it spawned. A single step
  // can spawn more than one child (loops / parallel fan-out), so values are
  // arrays.
  const childrenByStepId = React.useMemo(() => {
    const map = new Map<string, WorkflowInstance[]>()
    for (const child of childInstances) {
      const stepId = child.metadata?.labels?.parentStepId
      if (!stepId) continue
      const existing = map.get(stepId)
      if (existing) existing.push(child)
      else map.set(stepId, [child])
    }
    return map
  }, [childInstances])

  const parentInstanceId = instance?.metadata?.labels?.parentInstanceId ?? null

  // Live run updates (spec §8.3). Every step advance re-emits
  // `workflows.instance.started` with the destination step, so the SSE stream
  // already carries the run forward without a reload.
  const refreshRun = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['workflow-instance', id] })
    queryClient.invalidateQueries({ queryKey: ['workflow-instance-steps'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-events'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-instance-children'] })
  }, [queryClient, id])

  useLiveRunUpdates({ instanceId: id ?? null, onRefresh: refreshRun, enabled: !!id })

  const goToInstance = React.useCallback((targetId: string) => {
    router.push(`/backend/instances/${targetId}`)
  }, [router])

  // Spec §8.3: "clicking a node shows its I/O in the inspector". Sub-workflow
  // navigation moved into that inspector, so selecting a node no longer
  // navigates away from the run the operator is reading.
  const handleNodeClick = React.useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedStepId(node.id)
  }, [])

  const execution = React.useMemo(
    () =>
      deriveRunExecution({
        events,
        stepInstances,
        currentStepId: instance?.currentStepId,
        instanceStatus: instance?.status,
        attention: instance?.metadata?.attention,
      }),
    [events, stepInstances, instance?.currentStepId, instance?.status, instance?.metadata?.attention]
  )

  // The agent registry is only worth a request when this definition actually
  // invokes one — and "use the agent's LABEL, never its definition key" is why
  // it is worth one at all.
  const hasAgentStep = React.useMemo(
    () =>
      (workflowDefinition?.definition?.steps ?? []).some((step: { activities?: Array<{ activityType?: string }> }) =>
        (step.activities ?? []).some((activity) => activity.activityType === 'INVOKE_AGENT')
      ),
    [workflowDefinition]
  )
  const agentLabels = useAgentLabels(hasAgentStep)

  const executionsByStepId = React.useMemo(() => {
    const map = new Map<string, RunStepInstanceInput[]>()
    for (const stepInstance of stepInstances) {
      const existing = map.get(stepInstance.stepId)
      if (existing) existing.push(stepInstance)
      else map.set(stepInstance.stepId, [stepInstance])
    }
    return map
  }, [stepInstances])

  // Paint the definition graph with the run overlay: node status + duration
  // from the execution record, and `state: 'completed'` on every route the run
  // actually took so the taken path reads at a glance.
  const { graphNodes, graphEdges } = React.useMemo(() => {
    if (!workflowDefinition?.definition) {
      return { graphNodes: [] as Node[], graphEdges: [] }
    }

    const { nodes, edges } = definitionToGraph(workflowDefinition.definition, { autoLayout: true })

    const styledNodes: Node[] = nodes.map((node) => {
      const runStatus = resolveNodeRunStatus(execution, node, {
        currentStepId: instance?.currentStepId,
        instanceStatus: instance?.status,
      })
      // Spec Part 2: the canvas paints the PRESENTATION state, not the engine's
      // lifecycle vocabulary — so an activity in a worker or an agent mid-run
      // reads blue and moving instead of amber and parked.
      const presentation = resolveStepPresentation(
        execution,
        { id: node.id, status: runStatus },
        { agentLabels, agentId: readNodeAgentId(node.data) }
      )
      const status = presentationToWorkflowStatus(presentation.state)
      const state = execution.stepStates.get(node.id)
      const duration = state
        ? formatRunDuration(state.startedAt, state.completedAt, state.durationMs)
          ?? formatElapsedSince(state.startedAt, null)
        : null

      const tooltipLines = [
        String(node.data.label || node.id),
        `${t('workflows.instances.fields.status', 'Status')}: ${status}`,
      ]
      if (state?.startedAt) {
        tooltipLines.push(`${t('workflows.instances.fields.startedAt', 'Started')}: ${state.startedAt.toLocaleString()}`)
      }
      if (state?.completedAt) {
        tooltipLines.push(`${t('workflows.instances.fields.completedAt', 'Completed')}: ${state.completedAt.toLocaleString()}`)
      }
      if (duration) {
        tooltipLines.push(`${t('workflows.instances.fields.duration', 'Duration')}: ${duration}`)
      }

      return {
        ...node,
        data: {
          ...node.data,
          status,
          duration,
          runReason: presentation.reason,
          runStartedAt: presentation.startedAt,
          tooltip: tooltipLines.join('\n'),
          childInstanceIds: (childrenByStepId.get(node.id) ?? []).map((child) => child.id),
        },
        style: PRESENTATION_STEP_STYLES[presentation.state] as React.CSSProperties,
        selected: node.id === selectedStepId,
      }
    })

    const styledEdges = edges.map((edge) => {
      const taken = isRouteTaken(execution, {
        transitionId: edge.id,
        fromStepId: edge.source,
        toStepId: edge.target,
      })
      return taken ? { ...edge, data: { ...edge.data, state: 'completed' } } : edge
    })

    return { graphNodes: styledNodes, graphEdges: styledEdges }
  }, [workflowDefinition, execution, agentLabels, instance?.currentStepId, instance?.status, childrenByStepId, selectedStepId, t])

  const calculateDuration = React.useCallback(
    (startedAt: string | Date, completedAt: string | Date | null | undefined) =>
      formatElapsedSince(startedAt, completedAt) ?? '-',
    []
  )

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
    onError: (mutationError) => {
      logger.error('Error cancelling instance', { err: mutationError })
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
    onError: (mutationError) => {
      logger.error('Error retrying instance', { err: mutationError })
      flash(t('workflows.instances.retryFailed'), 'error')
    },
  })

  const handleCancel = async () => {
    if (!instance) return
    const confirmed = await confirmDialog({
      title: t('workflows.instances.confirmCancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    cancelMutation.mutate()
  }

  const handleRetry = async () => {
    if (!instance) return
    const confirmed = await confirmDialog({
      title: t('workflows.instances.confirmRetry'),
      variant: 'default',
    })
    if (!confirmed) return
    retryMutation.mutate()
  }

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('workflows.instances.detail.loading', 'Loading workflow instance...')}</span>
          </div>
        </PageBody>
        {ConfirmDialogElement}
      </Page>
    )
  }

  const isNotFound = !isLoading && (error as (Error & { status?: number }) | null)?.status === 404

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('workflows.instances.detail.notFound', 'Workflow instance not found.')}
            backHref="/backend/instances"
            backLabel={t('workflows.instances.actions.backToList', 'Back to instances')}
          />
        </PageBody>
        {ConfirmDialogElement}
      </Page>
    )
  }

  if (error || !instance) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={(error as Error | null)?.message ?? t('workflows.instances.loadFailed', 'Failed to load workflow instance.')}
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/backend/instances">{t('workflows.instances.actions.backToList', 'Back to instances')}</Link>
              </Button>
            }
          />
        </PageBody>
        {ConfirmDialogElement}
      </Page>
    )
  }

  const canCancel = instance.status === 'RUNNING' || instance.status === 'PAUSED'
  const canRetry = instance.status === 'FAILED'
  const actionLoading = cancelMutation.isPending || retryMutation.isPending

  // Rerun-from-step (spec §8.4). Gated on its own ACL feature, and only
  // offered on a run that is actually stopped — the API refuses a RUNNING
  // instance rather than racing the execution loop.
  const canOfferRerun =
    canRerunStep && (instance.status === 'FAILED' || instance.status === 'PAUSED')

  const submitRerun = async (contextPatch: Record<string, unknown> | undefined) => {
    if (!selectedStepId || !id) return
    setRerunPending(true)
    try {
      await runMutation({
        operation: async () => {
          const result = await apiCall<{ message?: string; error?: string }>(
            `/api/workflows/instances/${id}/rerun-step`,
            {
              method: 'POST',
              body: JSON.stringify({ stepId: selectedStepId, contextPatch }),
            }
          )
          if (!result.ok) {
            throw new Error(
              result.result?.error
                ?? t('workflows.rerunStep.failed', 'Could not rerun the step.')
            )
          }
          return result.result
        },
        context: { instanceId: id, stepId: selectedStepId },
        mutationPayload: { stepId: selectedStepId, contextPatch },
      })
      flash(t('workflows.rerunStep.started', 'Rerun started.'), 'success')
      setRerunOpen(false)
      refreshRun()
    } catch (rerunError) {
      flash(
        rerunError instanceof Error
          ? rerunError.message
          : t('workflows.rerunStep.failed', 'Could not rerun the step.'),
        'error'
      )
    } finally {
      setRerunPending(false)
    }
  }

  const menuActions = [
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
  ]

  const header = (
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
      menuActions={menuActions}
    />
  )

  if (isMobile) {
    return (
      <Page>
        <PageBody>
          <div className="space-y-4">
            {header}
            <MobileInstanceOverview
              instance={instance}
              events={events}
              graphNodes={graphNodes}
              graphEdges={graphEdges}
              definitionLoading={definitionLoading}
              hasDefinition={!!workflowDefinition}
              getStatusBadgeClass={instanceStatusBadgeClass}
              getEventTypeBadgeClass={runEventBadgeClass}
              calculateDuration={calculateDuration}
            />
          </div>
        </PageBody>
        {ConfirmDialogElement}
      </Page>
    )
  }

  const compensationEvents = events.filter(
    (event) => event.eventType.includes('COMPENSATION') || event.eventType.includes('Compensation')
  )
  const milestoneEvents = events.filter((event) => isRunMilestoneEvent(event.eventType))
  const selectedNode = graphNodes.find((node) => node.id === selectedStepId)

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          {header}

          {/* Execution Summary */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="mb-4 text-lg font-semibold">{t('workflows.instances.sections.overview')}</h2>
            <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                  <InstanceStatusBadge status={instance.status} />
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.currentStep')}
                </dt>
                <dd className="mt-1 font-mono text-sm text-foreground">{instance.currentStepId || '-'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.correlationKey')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">{instance.correlationKey || '-'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  {t('workflows.instances.fields.startedAt')}
                </dt>
                <dd className="mt-1 text-sm text-foreground">{new Date(instance.startedAt).toLocaleString()}</dd>
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
                  <span
                    className={
                      instance.retryCount > 0
                        ? 'text-sm font-medium text-status-warning-text'
                        : 'text-sm text-foreground'
                    }
                  >
                    {instance.retryCount}
                  </span>
                </dd>
              </div>
              {parentInstanceId && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t('workflows.instances.fields.parentInstance', 'Parent instance')}
                  </dt>
                  <dd className="mt-1 text-sm">
                    <Link
                      href={`/backend/instances/${parentInstanceId}`}
                      className="font-mono text-primary hover:underline"
                    >
                      #{parentInstanceId.slice(0, 8)}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* The headline failure stays above the tabs — it is the reason an
              operator opened the run, not one altitude of it. */}
          {instance.errorMessage && (
            <div className="rounded-lg border border-destructive bg-destructive/5 p-6">
              <h2 className="mb-4 text-lg font-semibold text-destructive">
                {t('workflows.instances.fields.lastError')}
              </h2>
              <pre className="whitespace-pre-wrap font-mono text-sm text-destructive">{instance.errorMessage}</pre>
              {instance.errorDetails && (
                <div className="mt-4">
                  <JsonDisplay data={instance.errorDetails} className="border-destructive/20 bg-destructive/5" maxInitialDepth={1} />
                </div>
              )}
            </div>
          )}

          {/* Spec section 8.2 — a simulation must SAY it is one everywhere it is
              read, so nobody mistakes an empty inbox for a broken workflow. */}
          {instance.isDryRun && (
            <Alert status="information" icon={<FlaskConical aria-hidden="true" />}>
              <AlertTitle>{t('workflows.dryRun.badge')}</AlertTitle>
              <AlertDescription>{t('workflows.dryRun.bannerDescription')}</AlertDescription>
            </Alert>
          )}

          {isStepping && (
            <Alert status="warning" icon={<Footprints aria-hidden="true" />}>
              <AlertTitle>{t('workflows.stepThrough.title')}</AlertTitle>
              <AlertDescription>
                <div className="space-y-2">
                  <p>
                    {instance.status === 'PAUSED'
                      ? t('workflows.stepThrough.pausedAt', { stepId: instance.currentStepId })
                      : t('workflows.stepThrough.running')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={stepThroughPending}
                      onClick={() => void handleStepThrough('continue')}
                    >
                      {stepThroughPending ? <Spinner className="h-4 w-4" /> : t('workflows.stepThrough.continue')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={stepThroughPending}
                      onClick={() => void handleStepThrough('stop')}
                    >
                      {t('workflows.stepThrough.stop')}
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {instance.isDryRun && (
            <div className="rounded-lg border bg-card p-6">
              <WouldDoReport report={wouldDoReport ?? null} />
            </div>
          )}

          {/* Spec §8.3 — three altitudes plus a demoted Raw tab. */}
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as RunTab)}
            variant="underline"
          >
            <TabsList aria-label={t('workflows.instances.run.tabs.label', 'Run views')}>
              <TabsTrigger value="flow">{t('workflows.instances.run.tabs.flow', 'Flow')}</TabsTrigger>
              <TabsTrigger value="timeline">{t('workflows.instances.run.tabs.timeline', 'Timeline')}</TabsTrigger>
              <TabsTrigger value="context">{t('workflows.instances.run.tabs.context', 'Context')}</TabsTrigger>
              <TabsTrigger value="raw" count={events.length || undefined}>
                {t('workflows.instances.run.tabs.raw', 'Raw')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="flow">
              <div className="mt-4 space-y-4">
                {definitionLoading && (
                  <div className="flex items-center justify-center gap-2 rounded-lg border bg-card py-8 text-muted-foreground">
                    <Spinner className="h-6 w-6" />
                    <span className="text-sm">{t('common.loading')}</span>
                  </div>
                )}
                {!definitionLoading && workflowDefinition && graphNodes.length > 0 && (
                  <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
                    <div className="order-2 lg:order-1 lg:w-64 lg:flex-shrink-0">
                      <WorkflowLegend />
                    </div>
                    <div className="order-1 h-[62svh] min-h-[360px] flex-1 overflow-hidden rounded-lg border lg:order-2 lg:h-[640px]">
                      <WorkflowGraphReadOnly
                        nodes={graphNodes}
                        edges={graphEdges}
                        height="100%"
                        onNodeClick={handleNodeClick}
                      />
                    </div>
                  </div>
                )}
                {!definitionLoading && !workflowDefinition && (
                  <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
                    {t(
                      'workflows.instances.run.definitionMissing',
                      'Workflow definition not found (ID: {definitionId})',
                      { definitionId: instance.definitionId }
                    )}
                  </div>
                )}

                <AgentActivityPanel instanceId={id ?? null} enabled={!!id} />

                <div className="rounded-lg border bg-card p-4 md:p-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('workflows.instances.run.inspector.title', 'Step inspector')}
                  </h3>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t('workflows.instances.run.inspector.hint', 'Click a node on the canvas to inspect it.')}
                    </span>
                    {canOfferRerun ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!selectedStepId || (executionsByStepId.get(selectedStepId ?? '')?.length ?? 0) === 0}
                        onClick={() => setRerunOpen(true)}
                      >
                        {t('workflows.rerunStep.action', 'Rerun from this step')}
                      </Button>
                    ) : null}
                  </div>
                  <RunStepInspector
                    stepId={selectedStepId}
                    stepLabel={selectedNode ? String(selectedNode.data?.label ?? '') : null}
                    executions={selectedStepId ? executionsByStepId.get(selectedStepId) ?? [] : []}
                    childInstanceIds={selectedStepId ? (childrenByStepId.get(selectedStepId) ?? []).map((child) => child.id) : []}
                    onOpenChildInstance={goToInstance}
                    isLoading={stepsLoading}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="timeline">
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border bg-card p-4 md:p-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('workflows.instances.run.gantt.title', 'Step durations')}
                  </h3>
                  {stepsLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Spinner className="h-4 w-4" />
                      <span className="text-sm">{t('common.loading')}</span>
                    </div>
                  ) : (
                    <RunGantt
                      stepInstances={stepInstances}
                      instanceStartedAt={instance.startedAt}
                      instanceCompletedAt={instance.completedAt}
                      selectedStepId={selectedStepId}
                      onSelectStep={(stepId) => {
                        setSelectedStepId(stepId)
                        setActiveTab('flow')
                      }}
                    />
                  )}
                </div>

                <div className="rounded-lg border bg-card p-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('workflows.instances.sections.executionTimeline', 'Execution Timeline')}
                  </h3>
                  {eventsLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Spinner className="h-4 w-4" />
                      <span className="text-sm">{t('common.loading')}</span>
                    </div>
                  ) : milestoneEvents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('workflows.instances.noExecutionHistory')}</p>
                  ) : (
                    <div className="space-y-2">
                      {[...milestoneEvents].reverse().map((event, index) => (
                        <div key={event.id} className="flex items-start gap-3 rounded-lg border bg-muted p-3">
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-xs font-medium">
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <RunEventBadge eventType={event.eventType} />
                              <span className="text-xs text-muted-foreground">
                                {new Date(event.occurredAt).toLocaleTimeString()}
                              </span>
                            </div>
                            {event.eventData?.toStepId && (
                              <p className="mt-1 font-mono text-xs text-muted-foreground">
                                {event.eventData.fromStepId ? `${event.eventData.fromStepId} → ` : '→ '}
                                {event.eventData.toStepId}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="context">
              <div className="mt-4 space-y-4">
                <JsonDisplay data={instance.context} title={t('workflows.instances.sections.context')} />
                {instance.metadata && Object.keys(instance.metadata).length > 0 && (
                  <JsonDisplay data={instance.metadata} title={t('workflows.instances.sections.metadata')} />
                )}

                {(instance.status === 'COMPENSATING' || instance.status === 'COMPENSATED') && (
                  <div className="rounded-lg border border-status-warning-border bg-status-warning-bg p-6">
                    <h2 className="mb-4 text-lg font-semibold text-status-warning-text">
                      {t('workflows.instances.sections.compensation', 'Compensation (Saga Pattern)')}
                    </h2>
                    <p className="text-sm text-status-warning-text">
                      {instance.status === 'COMPENSATING'
                        ? t(
                            'workflows.instances.compensation.inProgress',
                            'Workflow is currently executing compensation activities to rollback changes.'
                          )
                        : t(
                            'workflows.instances.compensation.completed',
                            'Compensation has been completed. All changes have been rolled back.'
                          )}
                    </p>
                    {compensationEvents.length > 0 && (
                      <div className="mt-4">
                        <h3 className="mb-2 text-sm font-medium text-status-warning-text">
                          {t('workflows.instances.compensation.activities', 'Compensation Activities')}
                        </h3>
                        <div className="space-y-2">
                          {[...compensationEvents].reverse().map((event) => (
                            <div
                              key={event.id}
                              className="flex items-start gap-2 rounded border border-status-warning-border bg-card p-2"
                            >
                              <RunEventBadge eventType={event.eventType} />
                              <span className="text-xs text-muted-foreground">
                                {new Date(event.occurredAt).toLocaleTimeString()}
                              </span>
                              {event.eventData?.activityName && (
                                <span className="text-xs font-medium text-foreground">
                                  {event.eventData.activityName}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="raw">
              <div className="mt-4 rounded-lg border bg-card p-6">
                {eventsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Spinner className="h-4 w-4" />
                    <span className="text-sm">{t('common.loading')}</span>
                  </div>
                ) : events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('workflows.instances.noExecutionHistory')}</p>
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
                      <tbody className="divide-y divide-border bg-background">
                        {events.map((event) => (
                          <tr key={event.id} className="hover:bg-muted/50">
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-foreground">
                              {new Date(event.occurredAt).toLocaleString()}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <RunEventBadge eventType={event.eventType} />
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <details className="cursor-pointer">
                                <summary className="text-primary hover:underline">{t('common.details')}</summary>
                                <div className="mt-2">
                                  <JsonDisplay data={event.eventData} showCopy={false} maxInitialDepth={1} />
                                </div>
                              </details>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">
                              {event.userId || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </PageBody>
      {ConfirmDialogElement}
      <RerunStepDialog
        open={rerunOpen}
        onOpenChange={setRerunOpen}
        stepId={selectedStepId}
        stepLabel={selectedNode ? String(selectedNode.data?.label ?? '') : null}
        isSubmitting={rerunPending}
        onConfirm={(contextPatch) => { void submitRerun(contextPatch) }}
      />
    </Page>
  )
}
