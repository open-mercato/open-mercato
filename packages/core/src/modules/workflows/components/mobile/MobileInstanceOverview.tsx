'use client'

import * as React from 'react'
import { useState } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { WorkflowInstance, WorkflowEvent } from '../../data/entities'
import { WorkflowGraphReadOnly } from '../WorkflowGraph'
import { MobileWorkflowTimeline, type TimelineStep } from './MobileWorkflowTimeline'
import { ChevronDown, ChevronUp, Maximize2 } from 'lucide-react'
import type { Node, Edge } from '@xyflow/react'

interface MobileInstanceOverviewProps {
  instance: WorkflowInstance
  events: WorkflowEvent[]
  graphNodes: Node[]
  graphEdges: Edge[]
  definitionLoading: boolean
  hasDefinition: boolean
  getStatusBadgeClass: (status: WorkflowInstance['status']) => string
  getEventTypeBadgeClass: (eventType: string) => string
  calculateDuration: (startedAt: string | Date, completedAt: string | Date | null | undefined) => string
}

export function MobileInstanceOverview({
  instance,
  events,
  graphNodes,
  graphEdges,
  definitionLoading,
  hasDefinition,
  getStatusBadgeClass,
  getEventTypeBadgeClass,
  calculateDuration,
}: MobileInstanceOverviewProps) {
  const t = useT()
  const [showFullGraph, setShowFullGraph] = useState(false)
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())

  const toggleEventDetails = (eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      return next
    })
  }

  // Build timeline steps from graph nodes
  const timelineSteps: TimelineStep[] = React.useMemo(() => {
    return graphNodes.map((node) => ({
      id: node.id,
      label: (node.data?.label as string) || node.id,
      type: node.type || 'unknown',
      status: (node.data?.status as TimelineStep['status']) || 'pending',
      duration: (node.data?.duration as string) || null,
    }))
  }, [graphNodes])

  // Filter execution timeline events
  const timelineEvents = React.useMemo(() => {
    return events
      .filter(
        (e) =>
          e.eventType.includes('STEP_') ||
          e.eventType.includes('WORKFLOW_STARTED') ||
          e.eventType.includes('WORKFLOW_COMPLETED') ||
          e.eventType.includes('WORKFLOW_FAILED')
      )
      .reverse()
  }, [events])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-base font-semibold">{t('workflows.instances.sections.overview')}</h2>
        <dl className="space-y-3">
          <div className="flex items-start justify-between">
            <dt className="text-xs font-medium text-muted-foreground">{t('workflows.instances.fields.status')}</dt>
            <dd>
              <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(instance.status)}`}>
                {t(`workflows.instances.status.${instance.status}`)}
              </span>
            </dd>
          </div>
          <div className="flex items-start justify-between">
            <dt className="text-xs font-medium text-muted-foreground">{t('workflows.instances.fields.workflowId')}</dt>
            <dd className="text-right">
              <div className="text-sm font-mono">{instance.workflowId}</div>
              <div className="text-[10px] text-muted-foreground">v{instance.version}</div>
            </dd>
          </div>
          <div className="flex items-start justify-between">
            <dt className="text-xs font-medium text-muted-foreground">{t('workflows.instances.fields.currentStep')}</dt>
            <dd className="text-sm font-mono text-right">{instance.currentStepId || '-'}</dd>
          </div>
          <div className="flex items-start justify-between">
            <dt className="text-xs font-medium text-muted-foreground">{t('workflows.instances.fields.duration')}</dt>
            <dd className="text-sm">{calculateDuration(instance.startedAt, instance.completedAt)}</dd>
          </div>
          <div className="flex items-start justify-between">
            <dt className="text-xs font-medium text-muted-foreground">{t('workflows.instances.fields.startedAt')}</dt>
            <dd className="text-xs">{new Date(instance.startedAt).toLocaleString()}</dd>
          </div>
          {instance.completedAt && (
            <div className="flex items-start justify-between">
              <dt className="text-xs font-medium text-muted-foreground">{t('workflows.instances.fields.completedAt')}</dt>
              <dd className="text-xs">{new Date(instance.completedAt).toLocaleString()}</dd>
            </div>
          )}
          {instance.retryCount > 0 && (
            <div className="flex items-start justify-between">
              <dt className="text-xs font-medium text-muted-foreground">{t('workflows.instances.fields.retryCount')}</dt>
              <dd className="text-sm font-medium text-orange-600">{instance.retryCount}</dd>
            </div>
          )}
        </dl>
      </div>

      {definitionLoading && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-center py-6">
            <Spinner className="h-5 w-5" />
            <span className="ml-2 text-sm text-muted-foreground">{t('common.loading')}</span>
          </div>
        </div>
      )}
      {!definitionLoading && hasDefinition && timelineSteps.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t('workflows.mobile.stepTimeline', 'Step Timeline')}</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFullGraph(true)}
              className="h-7 text-xs"
            >
              <Maximize2 className="mr-1 h-3 w-3" />
              {t('workflows.mobile.viewFullGraph', 'View Full Graph')}
            </Button>
          </div>
          <MobileWorkflowTimeline steps={timelineSteps} />
        </div>
      )}

      {instance.errorMessage && (
        <div className="rounded-lg border border-destructive bg-destructive/5 p-4">
          <h2 className="mb-2 text-sm font-semibold text-destructive">{t('workflows.instances.fields.lastError')}</h2>
          <pre className="text-xs text-destructive whitespace-pre-wrap font-mono break-all">
            {instance.errorMessage}
          </pre>
        </div>
      )}

      <JsonDisplay
        data={instance.context}
        title={t('workflows.instances.sections.context')}
      />

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-base font-semibold">{t('workflows.instances.sections.executionTimeline')}</h2>
        {timelineEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('workflows.instances.noExecutionHistory')}</p>
        ) : (
          <div className="space-y-2">
            {timelineEvents.map((event, idx) => (
              <div key={event.id} className="flex items-start gap-2 rounded-lg border bg-muted p-2.5">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background text-[10px] font-medium">
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${getEventTypeBadgeClass(event.eventType)}`}>
                      {t(`workflows.events.types.${event.eventType}`) || event.eventType}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(event.occurredAt).toLocaleTimeString()}
                    </span>
                  </div>
                  {event.eventData?.toStepId && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {event.eventData.fromStepId ? `${event.eventData.fromStepId} -> ` : '-> '}
                      {event.eventData.toStepId}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-base font-semibold">{t('workflows.mobile.eventLog', 'Event Log')}</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('workflows.instances.noExecutionHistory')}</p>
        ) : (
          <div className="space-y-2">
            {events.map((event) => {
              const isExpanded = expandedEvents.has(event.id)
              return (
                <div key={event.id} className="rounded-lg border bg-background p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${getEventTypeBadgeClass(event.eventType)}`}>
                          {t(`workflows.events.types.${event.eventType}`) || event.eventType}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(event.occurredAt).toLocaleString()}
                      </div>
                    </div>
                    {event.eventData && (
                      <button
                        onClick={() => toggleEventDetails(event.id)}
                        className="shrink-0 rounded p-1 hover:bg-muted"
                        aria-label={isExpanded ? t('workflows.mobile.hideDetails') : t('workflows.mobile.showDetails')}
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  {isExpanded && event.eventData && (
                    <div className="mt-2 border-t pt-2">
                      <JsonDisplay
                        data={event.eventData}
                        showCopy={false}
                        maxInitialDepth={1}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={showFullGraph} onOpenChange={setShowFullGraph}>
        <DialogContent className="h-[90svh] max-w-[95vw] p-0">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>{t('workflows.instances.sections.visualFlow')}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 p-2">
            <WorkflowGraphReadOnly
              nodes={graphNodes}
              edges={graphEdges}
              height="calc(90svh - 80px)"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
