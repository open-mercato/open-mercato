'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  PROCESS_MILESTONES_MAX,
  processMilestonesSchema,
  type ProcessMilestone,
} from '../../../data/validators'
import { moveMilestone, orderedMilestones, withSequentialOrder } from '../../../lib/tasks/milestones'
import { fetchWorkflowMilestones, type WorkflowMilestones } from './milestoneSuggestions'

type Translate = ReturnType<typeof useT>

export type MilestoneEditorProps = {
  value: ProcessMilestone[]
  onChange: (next: ProcessMilestone[]) => void
  workflowId: string | null
  singleAgent?: boolean
  disabled?: boolean
  t: Translate
}

export async function fetchEmittedMilestoneKeys(workflowId: string): Promise<string[] | null> {
  const resolved = await fetchWorkflowMilestones(workflowId)
  return resolved?.suggestions.map((suggestion) => suggestion.key) ?? null
}

export function MilestoneEditor({
  value,
  onChange,
  workflowId,
  singleAgent = false,
  disabled,
  t,
}: MilestoneEditorProps) {
  const [loaded, setLoaded] = React.useState<{ workflowId: string; data: WorkflowMilestones | null } | null>(
    null,
  )
  const [retry, setRetry] = React.useState(0)
  const [search, setSearch] = React.useState('')
  const [draftLabel, setDraftLabel] = React.useState('')
  const [draftKey, setDraftKey] = React.useState('')
  const [keyTouched, setKeyTouched] = React.useState(false)
  const [draftError, setDraftError] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoaded(null)
    setSearch('')
    if (workflowId && !singleAgent) {
      void fetchWorkflowMilestones(workflowId)
        .catch(() => null)
        .then((data) => {
          if (!cancelled) setLoaded({ workflowId, data })
        })
    }
    return () => {
      cancelled = true
    }
  }, [workflowId, singleAgent, retry])

  const loading = Boolean(workflowId && !singleAgent && loaded?.workflowId !== workflowId)
  const resolved = loaded?.workflowId === workflowId ? loaded?.data : null
  const suggestions = singleAgent
    ? [
        {
          key: 'completed',
          label: t('agent_orchestrator.processDefinitions.milestones.completion'),
          steps: [] as string[],
        },
      ]
    : (resolved?.suggestions ?? [])
  const rows = orderedMilestones(value)
  const selected = new Set(rows.map((row) => row.key))
  const available = suggestions.filter((suggestion) => !selected.has(suggestion.key))
  const query = search.trim().toLowerCase()
  const filtered = available.filter((suggestion) =>
    [suggestion.label, suggestion.key, ...suggestion.steps].join(' ').toLowerCase().includes(query),
  )
  const atCap = rows.length >= PROCESS_MILESTONES_MAX
  const missing =
    !loading && resolved && !singleAgent
      ? rows.filter(
          (row) =>
            row.key.trim() &&
            row.label.trim() &&
            !suggestions.some((suggestion) => suggestion.key === row.key),
        )
      : []
  const update = (index: number, patch: Partial<ProcessMilestone>) =>
    onChange(
      withSequentialOrder(rows.map((row, position) => (position === index ? { ...row, ...patch } : row))),
    )
  const add = (items: Array<{ key: string; label: string }>) =>
    onChange(
      withSequentialOrder(
        [
          ...rows,
          ...items
            .filter((item) => !selected.has(item.key))
            .map((item) => ({ key: item.key, label: item.label, order: 0 })),
        ].slice(0, PROCESS_MILESTONES_MAX),
      ),
    )
  const addCustom = () => {
    const entry = { key: draftKey.trim(), label: draftLabel.trim(), order: rows.length }
    if (!processMilestonesSchema.safeParse([...rows, entry]).success) {
      setDraftError(true)
      return
    }
    add([entry])
    setDraftLabel('')
    setDraftKey('')
    setKeyTouched(false)
    setDraftError(false)
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <LoadingMessage label={t('agent_orchestrator.processDefinitions.milestones.emittedLoading')} />
      ) : null}
      {singleAgent ? (
        <p className="text-sm text-muted-foreground">
          {t('agent_orchestrator.processDefinitions.milestones.singleAgentHint')}
        </p>
      ) : null}
      {!workflowId && !singleAgent ? (
        <p className="text-sm text-muted-foreground">
          {t('agent_orchestrator.processDefinitions.milestones.chooseWorkflow')}
        </p>
      ) : null}
      {!loading && workflowId && !singleAgent && !resolved ? (
        <Alert status="warning" size="sm">
          <AlertDescription>
            {t('agent_orchestrator.processDefinitions.milestones.emittedUnresolved')}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRetry((previous) => previous + 1)}
            >
              {t('agent_orchestrator.processDefinitions.milestones.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {resolved && suggestions.length === 0 && !loading ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('agent_orchestrator.processDefinitions.milestones.noSuggestions')}
        </p>
      ) : null}
      {!loading && available.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {t('agent_orchestrator.processDefinitions.milestones.available')}
            </p>
            {available.length > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || atCap}
                onClick={() => add(available)}
              >
                {t('agent_orchestrator.processDefinitions.milestones.addAll')}
              </Button>
            ) : null}
          </div>
          {available.length > 5 ? (
            <FormField label={t('agent_orchestrator.processDefinitions.milestones.search')}>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} />
            </FormField>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {filtered.map((suggestion) => (
              <Button
                key={suggestion.key}
                type="button"
                variant="outline"
                className="h-auto min-w-0 justify-start whitespace-normal p-3 text-left"
                disabled={disabled || atCap}
                onClick={() => add([suggestion])}
              >
                <Plus className="mr-2 size-4 shrink-0" />
                <span className="min-w-0 space-y-1">
                  <span className="block">{suggestion.label}</span>
                  <span className="block break-all font-mono text-xs font-normal text-muted-foreground">
                    {suggestion.key}
                  </span>
                  {suggestion.steps.length > 0 ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t('agent_orchestrator.processDefinitions.milestones.reportedBy', undefined, {
                        steps: suggestion.steps.join(', '),
                      })}
                    </span>
                  ) : null}
                </span>
              </Button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('agent_orchestrator.processDefinitions.milestones.noMatches')}
            </p>
          ) : null}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            {t('agent_orchestrator.processDefinitions.milestones.selected')}
          </p>
          {rows.map((milestone, index) => {
            const source = suggestions.find((suggestion) => suggestion.key === milestone.key)
            return (
              <div key={index} className="space-y-2 rounded-lg border border-border bg-background p-3">
                <div className="flex items-start gap-3">
                  <span className="mt-6 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
                    {index + 1}
                  </span>
                  <FormField
                    className="min-w-0 flex-1"
                    label={t('agent_orchestrator.processDefinitions.milestones.label')}
                    disabled={disabled}
                  >
                    <Input
                      value={milestone.label}
                      onChange={(event) => update(index, { label: event.target.value })}
                    />
                  </FormField>
                  <div className="mt-6 flex shrink-0 gap-1">
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={t('agent_orchestrator.processDefinitions.milestones.moveUp')}
                      disabled={disabled || index === 0}
                      onClick={() => onChange(moveMilestone(rows, index, index - 1))}
                    >
                      <ArrowUp className="size-4" />
                    </IconButton>
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={t('agent_orchestrator.processDefinitions.milestones.moveDown')}
                      disabled={disabled || index === rows.length - 1}
                      onClick={() => onChange(moveMilestone(rows, index, index + 1))}
                    >
                      <ArrowDown className="size-4" />
                    </IconButton>
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={t('agent_orchestrator.processDefinitions.milestones.remove')}
                      disabled={disabled}
                      onClick={() =>
                        onChange(withSequentialOrder(rows.filter((_, position) => position !== index)))
                      }
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                {source?.steps.length ? (
                  <p className="text-xs text-muted-foreground">
                    {t('agent_orchestrator.processDefinitions.milestones.reportedBy', undefined, {
                      steps: source.steps.join(', '),
                    })}
                  </p>
                ) : null}
                <CollapsibleSection
                  title={t('agent_orchestrator.processDefinitions.milestones.editKey')}
                  defaultCollapsed
                  className="text-xs text-muted-foreground"
                >
                  <FormField
                    className="mt-2"
                    label={t('agent_orchestrator.processDefinitions.milestones.key')}
                    disabled={disabled}
                  >
                    <Input
                      className="font-mono"
                      value={milestone.key}
                      onChange={(event) => update(index, { key: event.target.value })}
                    />
                  </FormField>
                </CollapsibleSection>
              </div>
            )
          })}
          <p className="text-xs text-muted-foreground">
            {t('agent_orchestrator.processDefinitions.milestones.orderHint')}
          </p>
        </div>
      ) : null}
      {missing && missing.length > 0 ? (
        <Alert status="warning" size="sm">
          <AlertDescription>
            {t('agent_orchestrator.processDefinitions.milestones.missingHint', undefined, {
              labels: missing.map((row) => row.label).join(', '),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {atCap ? (
        <p className="text-xs text-muted-foreground">
          {t('agent_orchestrator.processDefinitions.milestones.cap', undefined, {
            max: String(PROCESS_MILESTONES_MAX),
          })}
        </p>
      ) : null}
      {resolved?.recordId ? (
        <LinkButton asChild size="sm">
          <a
            href={`/backend/definitions/${encodeURIComponent(resolved.recordId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('agent_orchestrator.processDefinitions.milestones.openWorkflow')}
          </a>
        </LinkButton>
      ) : null}
      <CollapsibleSection
        title={t('agent_orchestrator.processDefinitions.milestones.custom')}
        defaultCollapsed
        className="rounded-lg border border-border p-3"
      >
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('agent_orchestrator.processDefinitions.milestones.customHint')}
          </p>
          <FormField
            label={t('agent_orchestrator.processDefinitions.milestones.label')}
            disabled={disabled || atCap}
          >
            <Input
              value={draftLabel}
              onChange={(event) => {
                setDraftLabel(event.target.value)
                if (!keyTouched)
                  setDraftKey(
                    event.target.value
                      .normalize('NFKD')
                      .replace(/[\u0300-\u036f]/g, '')
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '_')
                      .replace(/^_+|_+$/g, '')
                      .slice(0, 100),
                  )
              }}
            />
          </FormField>
          <FormField
            label={t('agent_orchestrator.processDefinitions.milestones.key')}
            disabled={disabled || atCap}
          >
            <Input
              value={draftKey}
              className="font-mono"
              onChange={(event) => {
                setDraftKey(event.target.value)
                setKeyTouched(true)
              }}
            />
          </FormField>
          {draftError ? (
            <p role="alert" className="text-sm text-status-error-text">
              {t('agent_orchestrator.processDefinitions.milestones.invalidDraft')}
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || atCap || !draftKey.trim() || !draftLabel.trim()}
            onClick={addCustom}
          >
            {t('agent_orchestrator.processDefinitions.milestones.add')}
          </Button>
        </div>
      </CollapsibleSection>
    </div>
  )
}
