'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RunStatusBadge } from './RunStatusBadge'
import { formatRunDuration } from '../../lib/run-duration'
import type { RunStepInstanceInput } from '../../lib/run-execution'
import { stepInstanceStatusToRunStatus } from '../../lib/run-execution'

export type RunStepInspectorProps = {
  /** The node the author selected on the painted canvas, `null` when nothing is selected. */
  stepId: string | null
  stepLabel?: string | null
  /**
   * Every recorded execution of that step, newest last. A step can run more
   * than once (a loop, a failure route back, a rerun), and collapsing them
   * would hide exactly the attempt an operator is looking for.
   */
  executions: readonly RunStepInstanceInput[]
  /** Sub-workflow instances this step spawned, if any. */
  childInstanceIds?: readonly string[]
  onOpenChildInstance?: (instanceId: string) => void
  isLoading?: boolean
}

function ExecutionRecord({
  execution,
  attemptLabel,
}: {
  execution: RunStepInstanceInput
  attemptLabel: string | null
}) {
  const t = useT()
  const duration = formatRunDuration(execution.enteredAt, execution.exitedAt, execution.executionTimeMs)
  const attempts = typeof execution.retryCount === 'number' ? execution.retryCount + 1 : 1

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={stepInstanceStatusToRunStatus(execution.status)} />
        {attemptLabel ? <span className="text-xs text-muted-foreground">{attemptLabel}</span> : null}
        {execution.branchInstanceId ? (
          <span className="text-xs text-muted-foreground">
            {t('workflows.instances.run.inspector.branch', 'Parallel branch')}
          </span>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            {t('workflows.instances.run.inspector.startedAt', 'Started')}
          </dt>
          <dd className="mt-0.5 text-foreground">
            {execution.enteredAt ? new Date(execution.enteredAt).toLocaleString() : '-'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            {t('workflows.instances.run.inspector.endedAt', 'Ended')}
          </dt>
          <dd className="mt-0.5 text-foreground">
            {execution.exitedAt ? new Date(execution.exitedAt).toLocaleString() : '-'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            {t('workflows.instances.run.inspector.duration', 'Duration')}
          </dt>
          <dd className="mt-0.5 text-foreground">{duration ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            {t('workflows.instances.run.inspector.attempts', 'Attempts')}
          </dt>
          <dd className="mt-0.5 text-foreground">{attempts}</dd>
        </div>
      </dl>

      <div className="mt-4 space-y-3">
        <JsonDisplay
          data={execution.inputData ?? null}
          title={t('workflows.instances.run.inspector.input', 'Input')}
          maxInitialDepth={1}
        />
        <JsonDisplay
          data={execution.outputData ?? null}
          title={t('workflows.instances.run.inspector.output', 'Output')}
          maxInitialDepth={1}
        />
        {execution.errorData ? (
          <JsonDisplay
            data={execution.errorData}
            title={t('workflows.instances.run.inspector.error', 'Error')}
            className="border-status-error-border bg-status-error-bg"
            maxInitialDepth={1}
          />
        ) : null}
      </div>
    </div>
  )
}

/**
 * Per-step I/O inspector (spec §8.3): "clicking a node shows its I/O in the
 * inspector … input, output, duration, attempts — from `StepInstance`".
 */
export function RunStepInspector({
  stepId,
  stepLabel,
  executions,
  childInstanceIds = [],
  onOpenChildInstance,
  isLoading = false,
}: RunStepInspectorProps) {
  const t = useT()

  if (!stepId) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        {t('workflows.instances.run.inspector.empty', 'Select a step on the canvas to inspect its input, output and timing.')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-base font-semibold text-foreground">{stepLabel || stepId}</h3>
        <span className="font-mono text-xs text-muted-foreground">{stepId}</span>
      </div>

      {childInstanceIds.length > 0 && onOpenChildInstance ? (
        <div className="flex flex-wrap gap-2">
          {childInstanceIds.map((childId) => (
            <Button
              key={childId}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChildInstance(childId)}
            >
              {t('workflows.instances.run.inspector.openSubWorkflow', 'Open sub-workflow')} #{childId.slice(0, 8)}
            </Button>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : executions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          {t('workflows.instances.run.inspector.notExecuted', 'This step has not executed in this run.')}
        </p>
      ) : (
        <div className="space-y-3">
          {executions.map((execution, index) => (
            <ExecutionRecord
              key={execution.id ?? `${execution.stepId}-${index}`}
              execution={execution}
              attemptLabel={
                executions.length > 1
                  ? t('workflows.instances.run.inspector.execution', 'Execution {n}', { n: String(index + 1) })
                  : null
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default RunStepInspector
