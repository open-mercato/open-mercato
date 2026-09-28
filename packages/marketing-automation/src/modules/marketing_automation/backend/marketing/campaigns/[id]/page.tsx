"use client"

import * as React from 'react'
import type { Edge, Node } from '@xyflow/react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ConditionBuilder } from '@open-mercato/core/modules/business_rules/components/ConditionBuilder'
import type { GroupCondition } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { CampaignCanvas } from '../../../../components/CampaignCanvas'
import { ParamFields } from '../../../../components/ParamFields'
import type { UiFieldSpec } from '../../../../components/ParamFields'
import { AUDIENCE_NODE_ID, definitionToGraph, autoArrange } from '../../../../lib/canvas/graph-mapping'
import type { CampaignDefinition, CampaignStep } from '../../../../lib/engine/types'
import type { CampaignTriggerInput } from '../../../../data/validators'

type PaletteTrigger = {
  eventId: string
  labelKey: string
  available: boolean
  blockedReasonKey: string | null
}

type PaletteStep = {
  type: string
  labelKey: string
  descriptionKey: string | null
  channel: string | null
  uiFields: UiFieldSpec[]
}

type CampaignResponse = {
  id: string
  name: string
  description: string | null
  isEnabled: boolean
  definition: CampaignDefinition
  triggers: CampaignTriggerInput[]
  updatedAt: string
}

function newStepId(): string {
  return `step-${Math.random().toString(36).slice(2, 10)}`
}

/** Short, human summary of an audience expression for the canvas node body. */
function summarizeAudience(audience: CampaignDefinition['audience']): string[] {
  if (!audience) return []
  const lines: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const group = node as { operator?: unknown; rules?: unknown; field?: unknown; value?: unknown }
    if (Array.isArray(group.rules)) {
      group.rules.forEach(walk)
      return
    }
    if (typeof group.field === 'string' && group.field) {
      lines.push(`${group.field} ${String(group.operator ?? '')} ${JSON.stringify(group.value ?? null)}`)
    }
  }
  walk(audience)
  return lines
}

export default function CampaignEditorPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const campaignId = typeof params?.id === 'string' ? params.id : ''

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)

  const [name, setName] = React.useState('')
  const [isEnabled, setIsEnabled] = React.useState(false)
  const [updatedAt, setUpdatedAt] = React.useState('')
  const [triggers, setTriggers] = React.useState<CampaignTriggerInput[]>([])
  const [definition, setDefinition] = React.useState<CampaignDefinition>({ version: 1, audience: null, steps: [] })
  const [palette, setPalette] = React.useState<{ triggers: PaletteTrigger[]; steps: PaletteStep[] } | null>(null)
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    void (async () => {
      const [campaign, paletteResult] = await Promise.all([
        apiCall<CampaignResponse>(`/api/marketing_automation/campaigns/${campaignId}`),
        apiCall<{ triggers: PaletteTrigger[]; steps: PaletteStep[] }>('/api/marketing_automation/palette'),
      ])
      if (cancelled) return
      if (!campaign.ok || !campaign.result) {
        setError(t('marketing_automation.errors.loadFailed', 'Could not load the campaign.'))
        setLoading(false)
        return
      }
      setName(campaign.result.name)
      setIsEnabled(campaign.result.isEnabled)
      setUpdatedAt(campaign.result.updatedAt)
      setTriggers(campaign.result.triggers ?? [])
      setDefinition(campaign.result.definition)
      if (paletteResult.ok && paletteResult.result) setPalette(paletteResult.result)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [campaignId, t])

  const graph = React.useMemo(() => definitionToGraph(definition, triggers), [definition, triggers])

  const nodes = React.useMemo<Node[]>(() => graph.nodes.map((node) => {
    if (node.type === 'audience') {
      return {
        id: node.id,
        type: 'audience',
        position: node.position,
        data: {
          isEveryone: node.data.isEveryone,
          summary: summarizeAudience(definition.audience),
          logic: (definition.audience as { operator?: 'AND' | 'OR' | 'NOT' } | null)?.operator ?? null,
        },
      }
    }
    if (node.type === 'trigger') {
      const entry = palette?.triggers.find((item) => node.data.trigger.kind === 'event' && item.eventId === node.data.trigger.eventId)
      return { id: node.id, type: 'trigger', position: node.position, data: { trigger: node.data.trigger, labelKey: entry?.labelKey } }
    }
    const stepEntry = palette?.steps.find((item) => item.type === node.data.step.type)
    return { id: node.id, type: 'step', position: node.position, data: { step: node.data.step, index: node.data.index, labelKey: stepEntry?.labelKey } }
  }), [graph.nodes, definition.audience, palette])

  const edges = React.useMemo<Edge[]>(
    () => graph.edges.map((edge) => ({ ...edge, deletable: false, focusable: false })),
    [graph.edges],
  )

  const mutate = React.useCallback((next: Partial<{ definition: CampaignDefinition; triggers: CampaignTriggerInput[] }>) => {
    if (next.definition) setDefinition(next.definition)
    if (next.triggers) setTriggers(next.triggers)
    setDirty(true)
  }, [])

  const addStep = (type: string) => {
    const step: CampaignStep = { id: newStepId(), type, params: type === 'wait' ? { minutes: 60 } : {} }
    mutate({ definition: { ...definition, steps: [...definition.steps, step] } })
    setSelectedNodeId(step.id)
  }

  const addTrigger = (eventId: string) => {
    if (triggers.some((trigger) => trigger.kind === 'event' && trigger.eventId === eventId)) return
    mutate({ triggers: [...triggers, { kind: 'event', eventId }] })
  }

  const updateStep = (stepId: string, params: Record<string, unknown>) => {
    mutate({
      definition: {
        ...definition,
        steps: definition.steps.map((step) => (step.id === stepId ? { ...step, params } : step)),
      },
    })
  }

  const moveStep = (stepId: string, delta: -1 | 1) => {
    const index = definition.steps.findIndex((step) => step.id === stepId)
    const target = index + delta
    if (index < 0 || target < 0 || target >= definition.steps.length) return
    const steps = [...definition.steps]
    const [moved] = steps.splice(index, 1)
    steps.splice(target, 0, moved)
    mutate({ definition: { ...definition, steps } })
  }

  const removeNode = (nodeId: string) => {
    if (definition.steps.some((step) => step.id === nodeId)) {
      mutate({ definition: { ...definition, steps: definition.steps.filter((step) => step.id !== nodeId) } })
    } else {
      mutate({ triggers: triggers.filter((trigger) => (trigger.kind === 'event' ? `trigger:event:${trigger.eventId}` : `trigger:schedule:${trigger.scheduleValue}`) !== nodeId) })
    }
    setSelectedNodeId(null)
  }

  const onPositionsChange = React.useCallback((nodePositions: Record<string, { x: number; y: number }>) => {
    setDefinition((current) => ({ ...current, canvas: { ...current.canvas, nodePositions } }))
    setDirty(true)
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      // The expected version travels as the platform's extension header, which is what the
      // command guard reads and what makes a conflict surface through the shared conflict bar.
      const response = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(updatedAt),
        () => apiCallOrThrow<{ updatedAt: string; waitingRuns: number }>(
          `/api/marketing_automation/campaigns/${campaignId}/save-graph`,
          {
            method: 'PUT',
            body: JSON.stringify({ updatedAt, name, isEnabled, triggers, definition }),
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      const saved = response.result
      setUpdatedAt(saved?.updatedAt ?? updatedAt)
      setDirty(false)
      flash(t('marketing_automation.action.save', 'Save'), 'success')
      if ((saved?.waitingRuns ?? 0) > 0) {
        // Editing a campaign changes what customers mid-journey receive next, which is worth
        // saying out loud rather than discovering later.
        flash(
          t('marketing_automation.confirm.droppedPendingResumes', '{count} customers are currently waiting in this campaign.')
            .replace('{count}', String(saved?.waitingRuns ?? 0)),
          'info',
        )
      }
    } catch (saveError) {
      // One conflict surface for the whole app: this renders the shared bar (or defers to a merge
      // dialog when one is registered) and only falls through for non-conflict failures.
      if (!surfaceRecordConflict(saveError, t)) {
        flash(t('marketing_automation.errors.saveFailed', 'Could not save the campaign.'), 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <Page><PageBody><div className="flex items-center justify-center py-16"><Spinner /></div></PageBody></Page>
  }
  if (error) {
    return <Page><PageBody><div className="text-sm text-muted-foreground">{error}</div></PageBody></Page>
  }

  const selectedStep = definition.steps.find((step) => step.id === selectedNodeId) ?? null
  const selectedStepMeta = selectedStep ? palette?.steps.find((item) => item.type === selectedStep.type) ?? null : null
  const audienceSelected = selectedNodeId === AUDIENCE_NODE_ID

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1 space-y-1">
            <Label htmlFor="campaign-name">{t('marketing_automation.list.columns.name', 'Name')}</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(event) => { setName(event.target.value); setDirty(true) }}
            />
          </div>
          <Button
            variant={isEnabled ? 'default' : 'outline'}
            onClick={() => { setIsEnabled(!isEnabled); setDirty(true) }}
          >
            {isEnabled
              ? t('marketing_automation.action.disable', 'Disable')
              : t('marketing_automation.action.enable', 'Enable')}
          </Button>
          <Button
            variant="outline"
            onClick={() => mutate({ definition: { ...definition, canvas: autoArrange(definition, triggers) } })}
          >
            {t('marketing_automation.action.autoArrange', 'Auto-arrange')}
          </Button>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? <Spinner /> : t('marketing_automation.action.save', 'Save')}
          </Button>
          {dirty ? (
            <span className="text-xs text-muted-foreground">
              {t('marketing_automation.canvas.unsavedChanges', 'Unsaved changes')}
            </span>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-[14rem_1fr_20rem]">
          <aside className="space-y-4">
            <div>
              <div className="mb-2 text-overline text-muted-foreground">
                {t('marketing_automation.canvas.palette.triggers', 'Triggers')}
              </div>
              <div className="space-y-1">
                {(palette?.triggers ?? []).map((trigger) => (
                  <Button
                    key={trigger.eventId}
                    variant="outline"
                    className="w-full justify-start"
                    disabled={!trigger.available}
                    title={trigger.blockedReasonKey ? t(trigger.blockedReasonKey, '') : undefined}
                    onClick={() => addTrigger(trigger.eventId)}
                  >
                    {t(trigger.labelKey, trigger.eventId)}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-overline text-muted-foreground">
                {t('marketing_automation.canvas.palette.steps', 'Steps')}
              </div>
              <div className="space-y-1">
                {(palette?.steps ?? []).map((step) => (
                  <Button
                    key={step.type}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => addStep(step.type)}
                  >
                    {t(step.labelKey, step.type)}
                  </Button>
                ))}
              </div>
            </div>
          </aside>

          <CampaignCanvas
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onPositionsChange={onPositionsChange}
          />

          <aside className="space-y-3">
            {audienceSelected ? (
              <div className="space-y-2">
                <div className="text-overline text-muted-foreground">
                  {t('marketing_automation.canvas.node.audience.title', 'Audience')}
                </div>
                {/* The platform's own condition builder, unchanged: audiences are the same
                    expression trees the rest of Open Mercato edits. */}
                <ConditionBuilder
                  value={definition.audience as GroupCondition | null}
                  onChangeAction={(value) => mutate({ definition: { ...definition, audience: value } })}
                />
              </div>
            ) : null}

            {selectedStep ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-overline text-muted-foreground">
                    {t(selectedStepMeta?.labelKey ?? `marketing_automation.step.${selectedStep.type}.label`, selectedStep.type)}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => moveStep(selectedStep.id, -1)}>↑</Button>
                    <Button variant="outline" size="sm" onClick={() => moveStep(selectedStep.id, 1)}>↓</Button>
                  </div>
                </div>
                <ParamFields
                  fields={selectedStepMeta?.uiFields ?? []}
                  values={selectedStep.params}
                  onChange={(params) => updateStep(selectedStep.id, params)}
                />
                <Button variant="outline" onClick={() => removeNode(selectedStep.id)}>
                  {t('marketing_automation.action.removeNode', 'Remove')}
                </Button>
              </div>
            ) : null}

            {!audienceSelected && !selectedStep && selectedNodeId ? (
              <Button variant="outline" onClick={() => removeNode(selectedNodeId)}>
                {t('marketing_automation.action.removeNode', 'Remove')}
              </Button>
            ) : null}

            {!selectedNodeId ? (
              <div className="text-xs text-muted-foreground">
                {t('marketing_automation.canvas.edge.derivedHint', 'Steps run top to bottom. Reorder with the arrows, not by dragging.')}
              </div>
            ) : null}
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}
