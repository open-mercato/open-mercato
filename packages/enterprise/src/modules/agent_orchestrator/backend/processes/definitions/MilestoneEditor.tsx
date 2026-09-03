"use client"

import * as React from 'react'
import { ArrowDown, ArrowUp, Flag, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PROCESS_MILESTONES_MAX, type ProcessMilestone } from '../../../data/validators'
import {
  collectMilestoneIssues,
  moveMilestone,
  orderedMilestones,
  withSequentialOrder,
} from '../../../lib/tasks/milestones'

const STEPS_DATALIST_ID = 'om-process-milestone-steps'

type Translate = ReturnType<typeof useT>

export type WorkflowStepOption = { stepId: string; stepName: string }

export type MilestoneEditorProps = {
  value: ProcessMilestone[]
  onChange: (next: ProcessMilestone[]) => void
  /** `agent` targets have no steps to map — the editor refuses to author a list the validator rejects. */
  targetType: 'agent' | 'workflow'
  /** The target workflow whose steps feed the picker and the drift check; null leaves both unresolved. */
  workflowId: string | null
  disabled?: boolean
  t: Translate
}

function mintMilestoneId(): string {
  const globalCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') return globalCrypto.randomUUID()
  return `ms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Reads the target workflow's declared steps. `null` means UNRESOLVED (the
 * workflow is unknown, the module is absent, or the caller may not read
 * definitions) — the drift diagnostic stays silent then, because "we could not
 * look" is not "the step is gone".
 */
export async function fetchWorkflowSteps(workflowId: string): Promise<WorkflowStepOption[] | null> {
  const call = await apiCall<{ data?: Array<Record<string, unknown>> }>(
    `/api/workflows/definitions?workflowId=${encodeURIComponent(workflowId)}&limit=1`,
    undefined,
    { fallback: {} },
  )
  if (!call.ok) return null
  const first = Array.isArray(call.result?.data) ? call.result.data[0] : undefined
  if (!first) return null
  const definition = first.definition
  if (!definition || typeof definition !== 'object') return null
  const steps = (definition as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return null
  return steps
    .map((step) => {
      if (!step || typeof step !== 'object') return null
      const record = step as Record<string, unknown>
      const stepId = typeof record.stepId === 'string' ? record.stepId : ''
      if (!stepId) return null
      const stepName = typeof record.stepName === 'string' && record.stepName ? record.stepName : stepId
      return { stepId, stepName }
    })
    .filter((step): step is WorkflowStepOption => step !== null)
}

/**
 * The milestone editor — the second `"use client"` island of the triggered
 * process model (ordering and a step picker are interaction, not convenience).
 *
 * Milestone rows mutate the PARENT definition, so the parent's optimistic-lock
 * header applies and no per-child override is needed: the caller owns the save.
 */
export function MilestoneEditor({
  value,
  onChange,
  targetType,
  workflowId,
  disabled,
  t,
}: MilestoneEditorProps) {
  const [steps, setSteps] = React.useState<WorkflowStepOption[] | null>(null)
  // A step list still in flight is NOT an unresolved one: reporting drift — or
  // saying the steps could not be loaded — while the request is open would be
  // false for as long as it takes to answer.
  const [stepsLoading, setStepsLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (targetType !== 'workflow' || !workflowId) {
      setSteps(null)
      setStepsLoading(false)
      return () => { cancelled = true }
    }
    setStepsLoading(true)
    void fetchWorkflowSteps(workflowId).then((resolved) => {
      if (cancelled) return
      setSteps(resolved)
      setStepsLoading(false)
    })
    return () => { cancelled = true }
  }, [targetType, workflowId])

  const knownStepIds = React.useMemo(
    () => (steps ? new Set(steps.map((step) => step.stepId)) : null),
    [steps],
  )

  const rows = React.useMemo(() => orderedMilestones(value), [value])

  const issues = React.useMemo(
    () =>
      collectMilestoneIssues({
        milestones: rows,
        knownStepIds,
        translate: (key, fallback, params) => t(key, fallback, params),
      }),
    [rows, knownStepIds, t],
  )
  const driftingStepIds = React.useMemo(
    () => new Set(issues.map((issue) => issue.nodeId).filter((id): id is string => !!id)),
    [issues],
  )

  const atCap = rows.length >= PROCESS_MILESTONES_MAX

  const replaceAt = React.useCallback(
    (index: number, next: ProcessMilestone) => {
      onChange(withSequentialOrder(rows.map((row, position) => (position === index ? next : row))))
    },
    [onChange, rows],
  )

  const addMilestone = React.useCallback(() => {
    onChange(
      withSequentialOrder([
        ...rows,
        { id: mintMilestoneId(), label: '', stepId: '', order: rows.length },
      ]),
    )
  }, [onChange, rows])

  const removeAt = React.useCallback(
    (index: number) => {
      onChange(withSequentialOrder(rows.filter((_, position) => position !== index)))
    },
    [onChange, rows],
  )

  const move = React.useCallback(
    (from: number, to: number) => {
      onChange(moveMilestone(rows, from, to))
    },
    [onChange, rows],
  )

  if (targetType !== 'workflow') {
    return (
      <p className="text-xs text-muted-foreground">
        {t('agent_orchestrator.processDefinitions.milestones.agentTargetHint')}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <datalist id={STEPS_DATALIST_ID}>
        {(steps ?? []).map((step) => (
          <option key={step.stepId} value={step.stepId}>
            {step.stepName}
          </option>
        ))}
      </datalist>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('agent_orchestrator.processDefinitions.milestones.empty')}
        </p>
      ) : null}

      {rows.map((milestone, index) => (
        <div key={milestone.id} className="rounded-lg border border-border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <Input
              value={milestone.label}
              disabled={disabled}
              className="min-w-48 flex-1"
              placeholder={t('agent_orchestrator.processDefinitions.milestones.labelPlaceholder')}
              aria-label={t('agent_orchestrator.processDefinitions.milestones.label')}
              onChange={(event) => replaceAt(index, { ...milestone, label: event.target.value })}
            />
            <Input
              value={milestone.stepId}
              list={STEPS_DATALIST_ID}
              disabled={disabled}
              className="min-w-48 flex-1 font-mono"
              placeholder={t('agent_orchestrator.processDefinitions.milestones.stepPlaceholder')}
              aria-label={t('agent_orchestrator.processDefinitions.milestones.step')}
              onChange={(event) => replaceAt(index, { ...milestone, stepId: event.target.value })}
            />
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t('agent_orchestrator.processDefinitions.milestones.moveUp')}
              disabled={disabled || index === 0}
              onClick={() => move(index, index - 1)}
            >
              <ArrowUp className="size-4" />
            </IconButton>
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t('agent_orchestrator.processDefinitions.milestones.moveDown')}
              disabled={disabled || index === rows.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ArrowDown className="size-4" />
            </IconButton>
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t('agent_orchestrator.processDefinitions.milestones.remove')}
              disabled={disabled}
              onClick={() => removeAt(index)}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
          {milestone.stepId && driftingStepIds.has(milestone.stepId) ? (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-status-warning-text">
              <TriangleAlert className="size-3.5 shrink-0" />
              {t('agent_orchestrator.processDefinitions.milestones.problems.rowHint')}
            </p>
          ) : null}
        </div>
      ))}

      {issues.length > 0 ? (
        <div
          role="status"
          className="space-y-1 rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning-text"
        >
          <p className="font-semibold">
            {t('agent_orchestrator.processDefinitions.milestones.problems.title')}
          </p>
          {issues.map((issue) => (
            <p key={issue.id} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{issue.message}</span>
            </p>
          ))}
          <p>{t('agent_orchestrator.processDefinitions.milestones.problems.stillSaveable')}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || atCap} onClick={addMilestone}>
          <Plus className="mr-2 size-4" />
          {t('agent_orchestrator.processDefinitions.milestones.add')}
        </Button>
        {atCap ? (
          <span className="text-xs text-muted-foreground">
            {t('agent_orchestrator.processDefinitions.milestones.cap', undefined, {
              max: String(PROCESS_MILESTONES_MAX),
            })}
          </span>
        ) : null}
        {stepsLoading ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Spinner size="sm" className="shrink-0" />
            {t('agent_orchestrator.processDefinitions.milestones.stepsLoading')}
          </span>
        ) : null}
        {!stepsLoading && steps === null && workflowId ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Flag className="size-3.5 shrink-0" />
            {t('agent_orchestrator.processDefinitions.milestones.stepsUnresolved')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
