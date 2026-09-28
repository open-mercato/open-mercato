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
import {
  addVariant,
  appendStep,
  collectStepIds,
  locateStep,
  moveStep as moveStepInTree,
  removeStep,
  removeVariant,
  updateStepParams,
  updateVariant,
} from '../../../../lib/canvas/step-tree'
import type { StepLocation } from '../../../../lib/canvas/step-tree'
import { makeSplitStep, readVariants, SPLIT_STEP_TYPE } from '../../../../lib/engine/split'
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

type AudienceEstimate = {
  count: number
  /** `exact` when the whole audience was answerable in the database; otherwise an upper bound. */
  qualifier: 'exact' | 'atMost'
  candidates: number | null
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

/**
 * Maps the server's validation `code` to a localized message.
 *
 * The command answers with a stable code precisely so the author is told what is wrong; collapsing
 * everything into "could not save" is what made the localized validation strings dead weight.
 */
function describeSaveError(error: unknown, t: (key: string, fallback?: string) => string): string {
  const body = (error as { body?: { code?: unknown; detail?: unknown } } | null)?.body
  const code = typeof body?.code === 'string' ? body.code : null
  if (!code) return t('marketing_automation.errors.saveFailed', 'Could not save the campaign.')
  const detail = typeof body?.detail === 'string' ? body.detail : ''
  const message = t(code, code)
  return detail ? `${message} (${detail})` : message
}

export default function CampaignEditorPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const campaignId = typeof params?.id === 'string' ? params.id : ''

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState<string | null>(null)
  const [isEnabled, setIsEnabled] = React.useState(false)
  const [updatedAt, setUpdatedAt] = React.useState('')
  const [triggers, setTriggers] = React.useState<CampaignTriggerInput[]>([])
  const [definition, setDefinition] = React.useState<CampaignDefinition>({ version: 1, audience: null, steps: [] })
  const [palette, setPalette] = React.useState<{ triggers: PaletteTrigger[]; steps: PaletteStep[] } | null>(null)
  const [estimate, setEstimate] = React.useState<AudienceEstimate | null>(null)
  const [estimating, setEstimating] = React.useState(false)
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    void (async () => {
      // Wrapped: `apiCall` resolves for HTTP errors but a network failure or a parse error rejects,
      // and an unhandled rejection here left the page on a spinner forever instead of showing the
      // error state that is right below.
      try {
        const [campaign, paletteResult] = await Promise.all([
          apiCall<CampaignResponse>(`/api/marketing_automation/campaigns/${campaignId}`),
          apiCall<{ triggers: PaletteTrigger[]; steps: PaletteStep[] }>('/api/marketing_automation/palette'),
        ])
        if (cancelled) return
        if (!campaign.ok || !campaign.result) {
          setError(t('marketing_automation.errors.loadFailed', 'Could not load the campaign.'))
          return
        }
        setName(campaign.result.name)
        setDescription(campaign.result.description ?? null)
        setIsEnabled(campaign.result.isEnabled)
        setUpdatedAt(campaign.result.updatedAt)
        setTriggers(campaign.result.triggers ?? [])
        setDefinition(campaign.result.definition)
        if (paletteResult.ok && paletteResult.result) setPalette(paletteResult.result)
      } catch {
        if (!cancelled) setError(t('marketing_automation.errors.loadFailed', 'Could not load the campaign.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
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
          estimate,
        },
      }
    }
    if (node.type === 'trigger') {
      const entry = palette?.triggers.find((item) => node.data.trigger.kind === 'event' && item.eventId === node.data.trigger.eventId)
      return { id: node.id, type: 'trigger', position: node.position, data: { trigger: node.data.trigger, labelKey: entry?.labelKey } }
    }
    const stepEntry = palette?.steps.find((item) => item.type === node.data.step.type)
    const shared = {
      step: node.data.step,
      index: node.data.index,
      labelKey: stepEntry?.labelKey,
      laneKey: node.data.lane?.laneKey ?? null,
    }
    if (node.type === 'split') {
      return { id: node.id, type: 'split', position: node.position, data: { ...shared, variants: node.data.variants } }
    }
    return { id: node.id, type: 'step', position: node.position, data: shared }
  }), [graph.nodes, definition.audience, palette, estimate])

  const edges = React.useMemo<Edge[]>(
    () => graph.edges.map((edge) => ({ ...edge, deletable: false, focusable: false })),
    [graph.edges],
  )

  /**
   * Asks the server how many customers the audience ON SCREEN reaches.
   *
   * Explicit rather than automatic: it runs aggregate queries over orders and tags, which is not
   * something to fire on every keystroke in the condition builder.
   */
  const runEstimate = async () => {
    setEstimating(true)
    try {
      const response = await apiCallOrThrow<AudienceEstimate>(
        `/api/marketing_automation/campaigns/${campaignId}/audience-estimate`,
        {
          method: 'POST',
          body: JSON.stringify({ audience: definition.audience }),
          headers: { 'content-type': 'application/json' },
        },
      )
      setEstimate(response.result ?? null)
    } catch (estimateError) {
      flash(describeSaveError(estimateError, t), 'error')
    } finally {
      setEstimating(false)
    }
  }

  const mutate = React.useCallback((next: Partial<{ definition: CampaignDefinition; triggers: CampaignTriggerInput[] }>) => {
    if (next.definition) setDefinition(next.definition)
    if (next.triggers) setTriggers(next.triggers)
    setDirty(true)
  }, [])

  const selectedLocation: StepLocation | null = selectedNodeId ? locateStep(definition.steps, selectedNodeId) : null

  /**
   * Where a new step goes: into the variant the selection sits in, otherwise at the end of the
   * top-level chain. Without this the palette could only ever append to the trunk, and a variant
   * would be limited to whatever it was created with.
   */
  const addTarget: StepLocation['lane'] = selectedLocation?.lane ?? null

  const addStep = (type: string) => {
    const step = type === SPLIT_STEP_TYPE
      ? makeSplitStep(newStepId())
      : { id: newStepId(), type, params: type === 'wait' ? { minutes: 60 } : {} } satisfies CampaignStep
    mutate({ definition: { ...definition, steps: appendStep(definition.steps, step, addTarget) } })
    setSelectedNodeId(step.id)
  }

  const addTrigger = (eventId: string) => {
    if (triggers.some((trigger) => trigger.kind === 'event' && trigger.eventId === eventId)) return
    mutate({ triggers: [...triggers, { kind: 'event', eventId }] })
  }

  const withSteps = (steps: CampaignStep[]) => mutate({ definition: { ...definition, steps } })

  const updateStep = (stepId: string, params: Record<string, unknown>) => {
    withSteps(updateStepParams(definition.steps, stepId, params))
  }

  const moveStep = (stepId: string, delta: -1 | 1) => {
    withSteps(moveStepInTree(definition.steps, stepId, delta))
  }

  const removeNode = (nodeId: string) => {
    if (locateStep(definition.steps, nodeId)) {
      withSteps(removeStep(definition.steps, nodeId))
    } else {
      mutate({ triggers: triggers.filter((trigger) => (trigger.kind === 'event' ? `trigger:event:${trigger.eventId}` : `trigger:schedule:${trigger.scheduleValue}`) !== nodeId) })
    }
    setSelectedNodeId(null)
  }

  const onPositionsChange = React.useCallback((nodePositions: Record<string, { x: number; y: number }>) => {
    setDefinition((current) => {
      // Only positions of nodes that still exist are kept. Writing the raw map back let a deleted
      // step's coordinates survive every subsequent save and grow the jsonb without bound.
      const live = new Set<string>([AUDIENCE_NODE_ID, ...collectStepIds(current.steps)])
      const pruned: Record<string, { x: number; y: number }> = {}
      for (const [nodeId, position] of Object.entries(nodePositions)) {
        if (live.has(nodeId) || nodeId.startsWith('trigger:')) pruned[nodeId] = position
      }
      return { ...current, canvas: { ...current.canvas, nodePositions: pruned } }
    })
    setDirty(true)
  }, [])

  const toggleEnabled = async () => {
    setSaving(true)
    try {
      const response = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(updatedAt),
        () => apiCallOrThrow<{ isEnabled: boolean; updatedAt: string }>(
          `/api/marketing_automation/campaigns/${campaignId}/enabled`,
          {
            method: 'PUT',
            body: JSON.stringify({ updatedAt, isEnabled: !isEnabled }),
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      const next = response.result
      if (next) {
        setIsEnabled(next.isEnabled)
        setUpdatedAt(next.updatedAt)
      }
    } catch (toggleError) {
      if (!surfaceRecordConflict(toggleError, t)) {
        flash(describeSaveError(toggleError, t), 'error')
      }
    } finally {
      setSaving(false)
    }
  }

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
            body: JSON.stringify({ updatedAt, name, description, triggers, definition }),
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
        flash(describeSaveError(saveError, t), 'error')
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

  const selectedStep = selectedLocation?.step ?? null
  const selectedStepMeta = selectedStep ? palette?.steps.find((item) => item.type === selectedStep.type) ?? null : null
  const selectedSplit = selectedStep && selectedStep.type === SPLIT_STEP_TYPE ? selectedStep : null
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
            disabled={saving || dirty}
            title={dirty ? t('marketing_automation.canvas.unsavedChanges', 'Unsaved changes') : undefined}
            onClick={() => void toggleEnabled()}
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
              {addTarget ? (
                <div className="mb-2 text-xs text-muted-foreground">
                  {t('marketing_automation.canvas.palette.addsToVariant', 'Adds to variant {key}').replace('{key}', addTarget.laneKey)}
                </div>
              ) : null}
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
                  onChangeAction={(value) => {
                    // The previous number describes the previous audience, so it stops being shown
                    // the moment the expression changes rather than lingering as a wrong answer.
                    setEstimate(null)
                    mutate({ definition: { ...definition, audience: value } })
                  }}
                />
                <Button variant="outline" disabled={estimating} onClick={() => void runEstimate()}>
                  {estimating ? <Spinner /> : t('marketing_automation.action.estimateAudience', 'Estimate audience')}
                </Button>
                {estimate ? (
                  <div className="text-xs text-muted-foreground">
                    {estimate.qualifier === 'exact'
                      ? t('marketing_automation.canvas.node.audience.estimateExact', '{count} customers match')
                          .replace('{count}', String(estimate.count))
                      : t('marketing_automation.canvas.node.audience.estimateAtMost', 'At most {count} customers; the rest is decided per customer when the campaign runs')
                          .replace('{count}', String(estimate.count))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedStep && selectedLocation ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-overline text-muted-foreground">
                    {t(selectedStepMeta?.labelKey ?? `marketing_automation.step.${selectedStep.type}.label`, selectedStep.type)}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedLocation.index === 0}
                      aria-label={t('marketing_automation.action.moveUp', 'Move up')}
                      onClick={() => moveStep(selectedStep.id, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedLocation.index >= selectedLocation.siblingCount - 1}
                      aria-label={t('marketing_automation.action.moveDown', 'Move down')}
                      onClick={() => moveStep(selectedStep.id, 1)}
                    >
                      ↓
                    </Button>
                  </div>
                </div>
                {selectedLocation.lane ? (
                  <div className="text-xs text-muted-foreground">
                    {t('marketing_automation.canvas.node.split.variant', 'Variant {key}').replace('{key}', selectedLocation.lane.laneKey)}
                  </div>
                ) : null}

                {selectedSplit ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">
                      {t(
                        'marketing_automation.canvas.split.hint',
                        'Each customer is assigned one variant and stays in it. Select a step inside a variant, then pick from the palette to add another step to that variant.',
                      )}
                    </div>
                    {readVariants(selectedSplit).map((variant) => (
                      <div key={variant.key} className="space-y-2 rounded-md border border-border p-2">
                        <div className="flex gap-2">
                          <div className="min-w-0 flex-1 space-y-1">
                            <Label htmlFor={`variant-key-${variant.key}`}>
                              {t('marketing_automation.field.variant.key', 'Variant')}
                            </Label>
                            <Input
                              id={`variant-key-${variant.key}`}
                              value={variant.key}
                              onChange={(event) => withSteps(updateVariant(definition.steps, selectedSplit.id, variant.key, { key: event.target.value }))}
                            />
                          </div>
                          <div className="w-20 space-y-1">
                            <Label htmlFor={`variant-weight-${variant.key}`}>
                              {t('marketing_automation.field.variant.weight', 'Weight')}
                            </Label>
                            <Input
                              id={`variant-weight-${variant.key}`}
                              type="number"
                              min={1}
                              value={String(variant.weight)}
                              onChange={(event) => withSteps(updateVariant(definition.steps, selectedSplit.id, variant.key, { weight: Number(event.target.value) }))}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">
                            {t('marketing_automation.canvas.split.variantSteps', '{count} steps').replace('{count}', String(variant.steps.length))}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => withSteps(removeVariant(definition.steps, selectedSplit.id, variant.key))}
                          >
                            {t('marketing_automation.action.removeVariant', 'Remove variant')}
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" onClick={() => withSteps(addVariant(definition.steps, selectedSplit.id))}>
                      {t('marketing_automation.action.addVariant', 'Add variant')}
                    </Button>
                  </div>
                ) : (
                  <ParamFields
                    fields={selectedStepMeta?.uiFields ?? []}
                    values={selectedStep.params}
                    onChange={(params) => updateStep(selectedStep.id, params)}
                  />
                )}

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
