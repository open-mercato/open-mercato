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

const KEYS_DATALIST_ID = 'om-process-milestone-keys'

type Translate = ReturnType<typeof useT>

export type MilestoneEditorProps = {
  value: ProcessMilestone[]
  onChange: (next: ProcessMilestone[]) => void
  /** The bound workflow, whose steps declare which milestone keys can ever be emitted. */
  workflowId: string | null
  disabled?: boolean
  t: Translate
}

/** A milestone key is a business identifier, not a slug of the label — but a slug is a good first draft. */
function suggestKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100)
}

/**
 * The milestone keys the bound workflow's steps actually emit.
 *
 * `null` means UNRESOLVED (the workflow is unknown, the module is absent, or the
 * caller may not read definitions) — the drift diagnostic stays silent then,
 * because "we could not look" is not "nothing emits it".
 */
export async function fetchEmittedMilestoneKeys(workflowId: string): Promise<string[] | null> {
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
  const keys = new Set<string>()
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue
    const milestone = (step as Record<string, unknown>).milestone
    if (typeof milestone === 'string' && milestone) keys.add(milestone)
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b))
}

/**
 * The milestone editor.
 *
 * A milestone is a business EVENT the workflow emits, so what is authored here is
 * a VOCABULARY — a key and the business-facing label for it — and never a step
 * id. That is what lets a stage be announced after a parallel join, after a retry,
 * or after ten steps, and what stops a step rename from changing what a business
 * reader sees.
 *
 * Milestone rows mutate the PARENT definition, so the parent's optimistic-lock
 * header applies and no per-child override is needed: the caller owns the save.
 */
export function MilestoneEditor({
  value,
  onChange,
  workflowId,
  disabled,
  t,
}: MilestoneEditorProps) {
  const [emitted, setEmitted] = React.useState<string[] | null>(null)
  // A workflow still in flight is NOT an unresolved one: reporting drift — or
  // saying the workflow could not be loaded — while the request is open would be
  // false for as long as it takes to answer.
  const [emittedLoading, setEmittedLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (!workflowId) {
      setEmitted(null)
      setEmittedLoading(false)
      return () => { cancelled = true }
    }
    setEmittedLoading(true)
    void fetchEmittedMilestoneKeys(workflowId).then((resolved) => {
      if (cancelled) return
      setEmitted(resolved)
      setEmittedLoading(false)
    })
    return () => { cancelled = true }
  }, [workflowId])

  const emittedKeys = React.useMemo(() => (emitted ? new Set(emitted) : null), [emitted])

  const rows = React.useMemo(() => orderedMilestones(value), [value])

  const issues = React.useMemo(
    () =>
      collectMilestoneIssues({
        milestones: rows,
        emittedKeys,
        translate: (key, fallback, params) => t(key, fallback, params),
      }),
    [rows, emittedKeys, t],
  )
  const neverEmitted = React.useMemo(
    () => new Set(rows.filter((row) => emittedKeys && row.key && !emittedKeys.has(row.key)).map((row) => row.key)),
    [rows, emittedKeys],
  )

  const atCap = rows.length >= PROCESS_MILESTONES_MAX

  const replaceAt = React.useCallback(
    (index: number, next: ProcessMilestone) => {
      onChange(withSequentialOrder(rows.map((row, position) => (position === index ? next : row))))
    },
    [onChange, rows],
  )

  const addMilestone = React.useCallback(() => {
    onChange(withSequentialOrder([...rows, { key: '', label: '', order: rows.length }]))
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

  return (
    <div className="space-y-3">
      <datalist id={KEYS_DATALIST_ID}>
        {(emitted ?? []).map((key) => (
          <option key={key} value={key} />
        ))}
      </datalist>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('agent_orchestrator.processDefinitions.milestones.empty')}
        </p>
      ) : null}

      {rows.map((milestone, index) => (
        <div key={`${index}-${milestone.key}`} className="rounded-lg border border-border bg-background p-3">
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
              onChange={(event) => {
                const label = event.target.value
                // The key is derived only while it is still untouched: once an
                // author names it, the workflow emits THAT string and a later
                // label edit must not silently break the match.
                const key = milestone.key ? milestone.key : suggestKey(label)
                replaceAt(index, { ...milestone, label, key })
              }}
            />
            <Input
              value={milestone.key}
              list={KEYS_DATALIST_ID}
              disabled={disabled}
              className="min-w-48 flex-1 font-mono"
              placeholder={t('agent_orchestrator.processDefinitions.milestones.keyPlaceholder')}
              aria-label={t('agent_orchestrator.processDefinitions.milestones.key')}
              onChange={(event) => replaceAt(index, { ...milestone, key: event.target.value })}
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
          {milestone.key && neverEmitted.has(milestone.key) ? (
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
        {emittedLoading ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Spinner size="sm" className="shrink-0" />
            {t('agent_orchestrator.processDefinitions.milestones.emittedLoading')}
          </span>
        ) : null}
        {!emittedLoading && emitted === null && workflowId ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Flag className="size-3.5 shrink-0" />
            {t('agent_orchestrator.processDefinitions.milestones.emittedUnresolved')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
