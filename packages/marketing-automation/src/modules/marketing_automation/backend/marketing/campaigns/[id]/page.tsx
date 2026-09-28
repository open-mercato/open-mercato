"use client"

import * as React from 'react'
import type { Edge, Node } from '@xyflow/react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { ConditionBuilder } from '@open-mercato/core/modules/business_rules/components/ConditionBuilder'
import type { GroupCondition } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { CampaignCanvas } from '../../../../components/CampaignCanvas'
import { ParamFields } from '../../../../components/ParamFields'
import type { UiFieldSpec } from '../../../../components/ParamFields'
import { AUDIENCE_NODE_ID, definitionToGraph, autoArrange, triggerNodeId } from '../../../../lib/canvas/graph-mapping'
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

type PaletteContentBlock = { key: string; name: string }

type PaletteSweepSource = {
  id: string
  labelKey: string
  available: boolean
  blockedReasonKey: string | null
  defaultWithinDays: number | null
}

type PaletteStep = {
  type: string
  labelKey: string
  descriptionKey: string | null
  channel: string | null
  uiFields: UiFieldSpec[]
}

type PreviewEntry =
  | { kind: 'step'; at: string; stepId: string; type: string; status: string; detail: string | null; channel: string | null }
  | { kind: 'pause'; at: string; until: string; reason: 'wait' | 'quiet_hours' | 'send_time' }

type JourneyPreview = {
  entered: boolean
  entries: PreviewEntry[]
  stoppedBecause: 'completed' | 'stepLimit' | 'horizon' | 'failed'
  variantChoices: Record<string, string>
  endsAt: string | null
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

/** Hours are 0–23; anything else would make a window that never opens or never closes. */
function clampHour(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, 0), 23)
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
  const [palette, setPalette] = React.useState<{
    triggers: PaletteTrigger[]
    steps: PaletteStep[]
    sweepSources: PaletteSweepSource[]
    contentBlocks: PaletteContentBlock[]
  } | null>(null)
  const [estimate, setEstimate] = React.useState<AudienceEstimate | null>(null)
  const [estimating, setEstimating] = React.useState(false)
  const [previewSubject, setPreviewSubject] = React.useState('')
  const [preview, setPreview] = React.useState<JourneyPreview | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [testSending, setTestSending] = React.useState(false)
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  /**
   * The variant the palette adds to, chosen explicitly.
   *
   * Needed because a new split has EMPTY lanes: deriving the target from the selected step meant there
   * had to be a step inside a lane already, which there never is, so the first step could not be added
   * and A/B was unauthorable from the canvas at all.
   */
  const [laneTarget, setLaneTarget] = React.useState<StepLocation['lane']>(null)

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
          apiCall<{ triggers: PaletteTrigger[]; steps: PaletteStep[]; sweepSources: PaletteSweepSource[]; contentBlocks: PaletteContentBlock[] }>('/api/marketing_automation/palette'),
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

  React.useEffect(() => {
    // Selecting something else means the author has moved on; a stale lane target would silently send
    // the next palette click into a variant they are no longer looking at.
    if (!selectedNodeId || !laneTarget) return
    if (selectedNodeId !== laneTarget.splitId) setLaneTarget(null)
  }, [selectedNodeId, laneTarget])

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
      // Bound once so the narrowing survives into the closures below.
      const nodeTrigger = node.data.trigger
      const entry = palette?.triggers.find((item) => nodeTrigger.kind === 'event' && item.eventId === nodeTrigger.eventId)
      const sourceEntry = nodeTrigger.kind === 'schedule'
        ? palette?.sweepSources.find((item) => item.id === (nodeTrigger.sweepSource ?? 'customers'))
        : undefined
      return {
        id: node.id,
        type: 'trigger',
        position: node.position,
        data: { trigger: nodeTrigger, labelKey: entry?.labelKey, sourceLabelKey: sourceEntry?.labelKey },
      }
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

  /**
   * Asks the server what one named customer would receive, and when.
   *
   * The server drives the real engine for this, so the answer includes every gate — a message the
   * frequency cap would drop shows as skipped, and quiet hours move the timestamp. That is the only
   * version of this feature worth having: a hand-written explanation would drift from the engine, and an
   * author trusts a preview exactly where they cannot check it themselves.
   */
  const runPreview = async () => {
    const subjectEntityId = previewSubject.trim()
    if (!subjectEntityId) return
    setPreviewing(true)
    try {
      const response = await apiCallOrThrow<JourneyPreview>(
        `/api/marketing_automation/campaigns/${campaignId}/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ subjectEntityId }),
          headers: { 'content-type': 'application/json' },
        },
      )
      setPreview(response.result ?? null)
    } catch (previewError) {
      flash(describeSaveError(previewError, t), 'error')
    } finally {
      setPreviewing(false)
    }
  }

  /**
   * Sends one real message for this step, to the author's own address.
   *
   * The endpoint takes the recipient from the session and refuses to accept one from the request, so
   * there is nothing to pass here — which is the point: an editor that can send to an arbitrary address
   * is a spam relay.
   */
  const sendTest = async (stepId: string) => {
    setTestSending(true)
    try {
      const response = await apiCallOrThrow<{ to?: string }>(
        `/api/marketing_automation/campaigns/${campaignId}/test-send`,
        {
          method: 'POST',
          body: JSON.stringify({ stepId }),
          headers: { 'content-type': 'application/json' },
        },
      )
      flash(
        t('marketing_automation.testSend.sent', 'Sent to {address}.').replace('{address}', response.result?.to ?? ''),
        'success',
      )
    } catch (sendError) {
      flash(describeSaveError(sendError, t), 'error')
    } finally {
      setTestSending(false)
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
  // An explicit choice wins; otherwise a step selected inside a lane implies that lane.
  const addTarget: StepLocation['lane'] = laneTarget ?? selectedLocation?.lane ?? null

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

  /**
   * Adds a periodic trigger.
   *
   * Nothing HAPPENS to make a customer dormant and nothing happens when an order is old enough to
   * review, so those campaigns have no event to react to — only a question to ask on a schedule. This
   * is the only way to author one, and until it existed every periodic campaign was API-only.
   */
  const addScheduleTrigger = (source: PaletteSweepSource) => {
    const next: CampaignTriggerInput = {
      kind: 'schedule',
      scheduleValue: '1d',
      // Once ever by default: a sweep's audience usually STAYS true ("has not ordered in 90 days"),
      // so an unlimited default would re-enrol the same customer on every tick.
      reentryAfterDays: null,
      sweepSource: source.id,
      sweepParams: source.defaultWithinDays !== null ? { withinDays: source.defaultWithinDays } : {},
    }
    if (triggers.some((trigger) => triggerNodeId(trigger) === triggerNodeId(next))) return
    mutate({ triggers: [...triggers, next] })
    setSelectedNodeId(triggerNodeId(next))
  }

  const updateScheduleTrigger = (nodeId: string, patch: Partial<Extract<CampaignTriggerInput, { kind: 'schedule' }>>) => {
    const next = triggers.map((trigger) => (
      triggerNodeId(trigger) === nodeId && trigger.kind === 'schedule' ? { ...trigger, ...patch } : trigger
    ))
    mutate({ triggers: next })

    /**
     * A schedule's node id is derived from its source and interval, so editing either CHANGES the id.
     * Without following the selection, one keystroke in the interval field unmounted the panel being
     * typed into — and left a Remove button pointing at an id that no longer existed.
     */
    const patched = next.find((trigger) => (
      trigger.kind === 'schedule' && triggerNodeId(trigger) !== nodeId
        && triggers.some((original) => triggerNodeId(original) === nodeId)
    ))
    const movedId = patched ? triggerNodeId(patched) : null
    if (movedId && movedId !== nodeId) setSelectedNodeId(movedId)
  }

  const withSteps = (steps: CampaignStep[]) => mutate({ definition: { ...definition, steps } })

  /**
   * Send rules apply to the whole campaign rather than to a step, so they are edited here rather than
   * on a node. They were implemented, tested and unauthorable before this panel existed — a guard
   * nobody can switch on is a guard nobody has.
   */
  const updateSendPolicy = (patch: Partial<NonNullable<CampaignDefinition['sendPolicy']>>) => {
    mutate({ definition: { ...definition, sendPolicy: { ...(definition.sendPolicy ?? {}), ...patch } } })
  }

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
      // Uses the same id function the graph does, so a node and its trigger can never disagree.
      mutate({ triggers: triggers.filter((trigger) => triggerNodeId(trigger) !== nodeId) })
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
  /**
   * An AI draft for the selected message.
   *
   * Held in state and APPLIED on request rather than written straight into the step: the draft is a
   * suggestion, and an author who did not like it should not have to undo a save. Nothing here saves — the
   * campaign is saved by the same button as every other edit.
   */
  const [draft, setDraft] = React.useState<{ subject: string; bodyHtml: string; bodyText: string } | null>(null)
  const [drafting, setDrafting] = React.useState(false)
  const [brief, setBrief] = React.useState('')

  const requestDraft = async (stepId: string) => {
    setDrafting(true)
    try {
      const response = await apiCallOrThrow<{ subject: string; bodyHtml: string; bodyText: string }>(
        `/api/marketing_automation/campaigns/${campaignId}/draft-copy`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ brief: brief.trim() || undefined }),
        },
      )
      if (response.result) setDraft(response.result)
    } catch (error) {
      const body = (error as { body?: { code?: unknown } } | null)?.body
      const code = typeof body?.code === 'string' ? body.code : null
      flash(
        code === 'marketing_automation.errors.aiNotConfigured'
          ? t('marketing_automation.errors.aiNotConfigured', 'No AI model is configured for this installation.')
          : t('marketing_automation.errors.aiFailed', 'Could not draft the copy. Try again, or write it yourself.'),
        'error',
      )
    } finally {
      setDrafting(false)
      void stepId
    }
  }

  const selectedTrigger = selectedNodeId
    ? triggers.find((trigger) => triggerNodeId(trigger) === selectedNodeId) ?? null
    : null
  const selectedScheduleTrigger = selectedTrigger?.kind === 'schedule' ? selectedTrigger : null
  const selectedSweepSource = selectedScheduleTrigger
    ? palette?.sweepSources.find((source) => source.id === (selectedScheduleTrigger.sweepSource ?? 'customers')) ?? null
    : null

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
                {t('marketing_automation.canvas.palette.schedules', 'On a schedule')}
              </div>
              <div className="space-y-1">
                {(palette?.sweepSources ?? []).map((source) => (
                  <Button
                    key={source.id}
                    variant="outline"
                    className="w-full justify-start"
                    disabled={!source.available}
                    title={source.blockedReasonKey ? t(source.blockedReasonKey, '') : undefined}
                    onClick={() => addScheduleTrigger(source)}
                  >
                    {t(source.labelKey, source.id)}
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
                        'Each customer is assigned one variant and stays in it. Press "Add steps here" on a variant, then pick from the palette.',
                      )}
                    </div>
                    {readVariants(selectedSplit).map((variant) => (
                      <div
                        key={variant.key}
                        className={[
                          'space-y-2 rounded-md border p-2',
                          addTarget?.splitId === selectedSplit.id && addTarget?.laneKey === variant.key
                            ? 'border-primary'
                            : 'border-border',
                        ].join(' ')}
                      >
                        <div className="flex gap-2">
                          <div className="min-w-0 flex-1 space-y-1">
                            <Label htmlFor={`variant-key-${variant.key}`}>
                              {t('marketing_automation.field.variant.key', 'Variant')}
                            </Label>
                            {/* Committed on BLUR, not per keystroke. The key identifies the lane, and runs
                                already enrolled recorded the old one — so renaming `a` to `abc` used to
                                commit `a`, `ab`, `abc` and strand the results of the first two. */}
                            <Input
                              id={`variant-key-${variant.key}`}
                              key={`variant-key-input-${variant.key}`}
                              defaultValue={variant.key}
                              onBlur={(event) => {
                                const next = event.target.value.trim()
                                if (!next || next === variant.key) return
                                withSteps(updateVariant(definition.steps, selectedSplit.id, variant.key, { key: next }))
                              }}
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
                          <div className="flex gap-1">
                            {/* The only way to put the FIRST step into a lane: a new split's lanes are
                                empty, so there is nothing inside one to select. */}
                            <Button
                              variant={
                                addTarget?.splitId === selectedSplit.id && addTarget?.laneKey === variant.key
                                  ? 'default'
                                  : 'outline'
                              }
                              size="sm"
                              onClick={() => setLaneTarget({ splitId: selectedSplit.id, laneKey: variant.key })}
                            >
                              {t('marketing_automation.action.addToVariant', 'Add steps here')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => withSteps(removeVariant(definition.steps, selectedSplit.id, variant.key))}
                            >
                              {t('marketing_automation.action.removeVariant', 'Remove variant')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" onClick={() => withSteps(addVariant(definition.steps, selectedSplit.id))}>
                      {t('marketing_automation.action.addVariant', 'Add variant')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <ParamFields
                      fields={selectedStepMeta?.uiFields ?? []}
                      values={selectedStep.params}
                      onChange={(params) => updateStep(selectedStep.id, params)}
                    />
                    {/* The blank page is what stops a campaign being written at all, so the draft lives
                        beside the fields it fills — and it fills them only when the author says so. */}
                    {selectedStepMeta?.channel === 'email' ? (
                      <div className="space-y-2 rounded-sm border border-border p-2">
                        <div className="text-overline text-muted-foreground">
                          {t('marketing_automation.ai.title', 'Draft with AI')}
                        </div>
                        <Textarea
                          rows={2}
                          value={brief}
                          placeholder={t('marketing_automation.ai.briefPlaceholder', 'What should this message say? e.g. remind them about the items they looked at, offer free delivery this week')}
                          onChange={(event) => setBrief(event.target.value)}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" disabled={drafting} onClick={() => void requestDraft(selectedStep.id)}>
                            {drafting ? <Spinner /> : t('marketing_automation.ai.draft', 'Draft')}
                          </Button>
                          {draft ? (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  updateStep(selectedStep.id, {
                                    ...selectedStep.params,
                                    subject: draft.subject,
                                    bodyHtml: draft.bodyHtml,
                                    bodyText: draft.bodyText,
                                  })
                                  setDraft(null)
                                }}
                              >
                                {t('marketing_automation.ai.apply', 'Use this draft')}
                              </Button>
                              <Button variant="outline" onClick={() => setDraft(null)}>
                                {t('marketing_automation.ai.discard', 'Discard')}
                              </Button>
                            </>
                          ) : null}
                        </div>
                        {draft ? (
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-foreground">{draft.subject}</div>
                            {/* Shown as TEXT, not rendered: a draft is untrusted markup until somebody has
                                read it, and rendering it here would execute whatever survived sanitising. */}
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                              {draft.bodyHtml}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* An author cannot reference a block whose key they have to remember. */}
                    {selectedStepMeta?.channel === 'email' && (palette?.contentBlocks ?? []).length > 0 ? (
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">
                          {t('marketing_automation.blocks.available', 'Reusable blocks you can paste into the body:')}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(palette?.contentBlocks ?? []).map((block) => (
                            <span key={block.key} className="rounded-sm bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                              {`{{block:${block.key}}}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}

                {selectedStepMeta?.channel === 'email' ? (
                  <Button
                    variant="outline"
                    disabled={testSending || dirty}
                    title={dirty ? t('marketing_automation.canvas.unsavedChanges', 'Unsaved changes') : undefined}
                    onClick={() => void sendTest(selectedStep.id)}
                  >
                    {testSending ? <Spinner /> : t('marketing_automation.testSend.run', 'Send a test to me')}
                  </Button>
                ) : null}

                <Button variant="outline" onClick={() => removeNode(selectedStep.id)}>
                  {t('marketing_automation.action.removeNode', 'Remove')}
                </Button>
              </div>
            ) : null}

            {selectedScheduleTrigger && selectedNodeId ? (
              <div className="space-y-3">
                <div className="text-overline text-muted-foreground">
                  {t('marketing_automation.canvas.node.schedule.title', 'Schedule')}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="schedule-interval">
                    {t('marketing_automation.field.schedule.interval', 'Run every')}
                  </Label>
                  <Input
                    id="schedule-interval"
                    value={selectedScheduleTrigger.scheduleValue}
                    placeholder="1d"
                    onChange={(event) => updateScheduleTrigger(selectedNodeId, { scheduleValue: event.target.value })}
                  />
                  <div className="text-xs text-muted-foreground">
                    {t('marketing_automation.field.schedule.intervalHint', 'Minutes, hours or days: 30m, 6h, 1d.')}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="schedule-reentry">
                    {t('marketing_automation.field.schedule.reentry', 'Re-enter the same customer after (days)')}
                  </Label>
                  <Input
                    id="schedule-reentry"
                    type="number"
                    min={1}
                    value={selectedScheduleTrigger.reentryAfterDays ?? ''}
                    placeholder={t('marketing_automation.field.schedule.reentryOnce', 'Once ever')}
                    onChange={(event) => {
                      const raw = event.target.value.trim()
                      const parsed = Number.parseInt(raw, 10)
                      // Empty means "once ever", which is the safe default for a sweep whose audience
                      // stays true — not "re-enter immediately".
                      updateScheduleTrigger(selectedNodeId, {
                        reentryAfterDays: raw && Number.isFinite(parsed) && parsed > 0 ? parsed : null,
                      })
                    }}
                  />
                </div>
                {selectedSweepSource?.defaultWithinDays !== null && selectedSweepSource ? (
                  <div className="space-y-1">
                    <Label htmlFor="schedule-within">
                      {t('marketing_automation.field.schedule.withinDays', 'Window (days)')}
                    </Label>
                    <Input
                      id="schedule-within"
                      type="number"
                      min={1}
                      value={
                        typeof selectedScheduleTrigger.sweepParams?.withinDays === 'number'
                          ? selectedScheduleTrigger.sweepParams.withinDays
                          : ''
                      }
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10)
                        updateScheduleTrigger(selectedNodeId, {
                          sweepParams: Number.isFinite(parsed) && parsed > 0 ? { withinDays: parsed } : {},
                        })
                      }}
                    />
                  </div>
                ) : null}
                <Button variant="outline" onClick={() => removeNode(selectedNodeId)}>
                  {t('marketing_automation.action.removeNode', 'Remove')}
                </Button>
              </div>
            ) : null}

            {!audienceSelected && !selectedStep && !selectedScheduleTrigger && selectedNodeId ? (
              <div className="space-y-2">
                {/* An event trigger needs no parameters — except this one, which needs a URL that lives on
                    another screen. Saying so here is the difference between a trigger that works and one an
                    author enables and then waits for. */}
                {selectedTrigger?.kind === 'event' && selectedTrigger.eventId === 'marketing_automation.inbound.received' ? (
                  <div className="text-xs text-muted-foreground">
                    {t('marketing_automation.hooks.triggerHint', 'This campaign starts when something posts to one of its inbound hooks. Create one under Inbound hooks.')}
                    {' '}
                    <a className="underline" href="/backend/marketing/inbound-hooks">
                      {t('marketing_automation.hooks.title', 'Inbound hooks')}
                    </a>
                  </div>
                ) : null}
                <Button variant="outline" onClick={() => removeNode(selectedNodeId)}>
                  {t('marketing_automation.action.removeNode', 'Remove')}
                </Button>
              </div>
            ) : null}

            {!selectedNodeId ? (
              <div className="space-y-4">
                <div className="text-xs text-muted-foreground">
                  {t('marketing_automation.canvas.edge.derivedHint', 'Steps run top to bottom. Reorder with the arrows, not by dragging.')}
                </div>

                <div className="space-y-2">
                  <div className="text-overline text-muted-foreground">
                    {t('marketing_automation.preview.title', 'Preview for a customer')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('marketing_automation.preview.hint', 'Shows every step and when it would happen, with the send rules applied. Sends nothing.')}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="preview-subject">
                      {t('marketing_automation.preview.subject', 'Customer id')}
                    </Label>
                    <Input
                      id="preview-subject"
                      value={previewSubject}
                      placeholder="00000000-0000-0000-0000-000000000000"
                      onChange={(event) => { setPreviewSubject(event.target.value); setPreview(null) }}
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={previewing || !previewSubject.trim() || dirty}
                    title={dirty ? t('marketing_automation.canvas.unsavedChanges', 'Unsaved changes') : undefined}
                    onClick={() => void runPreview()}
                  >
                    {previewing ? <Spinner /> : t('marketing_automation.preview.run', 'Preview')}
                  </Button>
                  {preview ? (
                    <div className="space-y-1">
                      {!preview.entered ? (
                        <div className="text-xs text-muted-foreground">
                          {t('marketing_automation.preview.notEntered', 'The audience would not admit this customer.')}
                        </div>
                      ) : null}
                      {Object.entries(preview.variantChoices).map(([splitId, variant]) => (
                        <div key={splitId} className="text-xs text-muted-foreground">
                          {t('marketing_automation.preview.variant', '{split}: variant {key}')
                            .replace('{split}', splitId)
                            .replace('{key}', variant)}
                        </div>
                      ))}
                      {preview.entries.map((entry, index) => (
                        <div key={`${index}`} className="flex items-baseline justify-between gap-2 border-b border-border py-1 text-xs">
                          {entry.kind === 'pause' ? (
                            <>
                              <span className="truncate text-muted-foreground">
                                {t(`marketing_automation.preview.pause.${entry.reason}`, entry.reason)}
                              </span>
                              <span className="shrink-0 text-muted-foreground">{formatDateTime(entry.until)}</span>
                            </>
                          ) : (
                            <>
                              <span className="truncate text-foreground">
                                {t(`marketing_automation.step.${entry.type}.label`, entry.type)}
                                {entry.status === 'skipped' ? (
                                  <span className="text-muted-foreground"> · {entry.detail ?? t('marketing_automation.preview.skipped', 'skipped')}</span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-muted-foreground">{formatDateTime(entry.at)}</span>
                            </>
                          )}
                        </div>
                      ))}
                      {preview.entered && preview.entries.length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                          {t('marketing_automation.preview.noSteps', 'This campaign has no steps to run.')}
                        </div>
                      ) : null}
                      {preview.stoppedBecause !== 'completed' ? (
                        <div className="text-xs text-muted-foreground">
                          {t(`marketing_automation.preview.stopped.${preview.stoppedBecause}`, preview.stoppedBecause)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="text-overline text-muted-foreground">
                    {t('marketing_automation.sendPolicy.title', 'Send rules')}
                  </div>

                  <CheckboxField
                    id="policy-optimize"
                    label={t('marketing_automation.sendPolicy.optimizeSendTime', 'Send at the hour each customer usually opens email')}
                    description={t('marketing_automation.sendPolicy.optimizeSendTimeHint', 'Needs a few opens from that customer first; until then the message goes out immediately.')}
                    checked={definition.sendPolicy?.optimizeSendTime === true}
                    onCheckedChange={(next) => updateSendPolicy({ optimizeSendTime: next === true })}
                  />

                  <CheckboxField
                    id="policy-quiet"
                    label={t('marketing_automation.sendPolicy.quietHours', 'Do not send during quiet hours')}
                    checked={definition.sendPolicy?.quietHours != null}
                    onCheckedChange={(next) => updateSendPolicy({
                      // A sensible night window rather than 00:00–00:00, which means "never send".
                      quietHours: next === true ? { startHour: 21, endHour: 8 } : null,
                    })}
                  />
                  {definition.sendPolicy?.quietHours ? (
                    <div className="flex gap-2 pl-6">
                      <div className="w-24 space-y-1">
                        <Label htmlFor="policy-quiet-start">
                          {t('marketing_automation.sendPolicy.quietFrom', 'From (hour)')}
                        </Label>
                        <Input
                          id="policy-quiet-start"
                          type="number"
                          min={0}
                          max={23}
                          value={definition.sendPolicy.quietHours.startHour}
                          onChange={(event) => updateSendPolicy({
                            quietHours: {
                              startHour: clampHour(event.target.value, 21),
                              endHour: definition.sendPolicy?.quietHours?.endHour ?? 8,
                            },
                          })}
                        />
                      </div>
                      <div className="w-24 space-y-1">
                        <Label htmlFor="policy-quiet-end">
                          {t('marketing_automation.sendPolicy.quietTo', 'To (hour)')}
                        </Label>
                        <Input
                          id="policy-quiet-end"
                          type="number"
                          min={0}
                          max={23}
                          value={definition.sendPolicy.quietHours.endHour}
                          onChange={(event) => updateSendPolicy({
                            quietHours: {
                              startHour: definition.sendPolicy?.quietHours?.startHour ?? 21,
                              endHour: clampHour(event.target.value, 8),
                            },
                          })}
                        />
                      </div>
                    </div>
                  ) : null}

                  <CheckboxField
                    id="policy-cap"
                    label={t('marketing_automation.sendPolicy.frequencyCap', 'Limit how many messages one customer receives')}
                    description={t('marketing_automation.sendPolicy.frequencyCapHint', 'Counted across every campaign, not just this one.')}
                    checked={definition.sendPolicy?.frequencyCap != null}
                    onCheckedChange={(next) => updateSendPolicy({
                      frequencyCap: next === true ? { maxMessages: 3, windowHours: 24 } : null,
                    })}
                  />
                  {definition.sendPolicy?.frequencyCap ? (
                    <div className="flex gap-2 pl-6">
                      <div className="w-24 space-y-1">
                        <Label htmlFor="policy-cap-max">
                          {t('marketing_automation.sendPolicy.capMax', 'At most')}
                        </Label>
                        <Input
                          id="policy-cap-max"
                          type="number"
                          min={1}
                          value={definition.sendPolicy.frequencyCap.maxMessages}
                          onChange={(event) => updateSendPolicy({
                            frequencyCap: {
                              maxMessages: Math.max(Number.parseInt(event.target.value, 10) || 1, 1),
                              windowHours: definition.sendPolicy?.frequencyCap?.windowHours ?? 24,
                            },
                          })}
                        />
                      </div>
                      <div className="w-24 space-y-1">
                        <Label htmlFor="policy-cap-window">
                          {t('marketing_automation.sendPolicy.capWindow', 'Per (hours)')}
                        </Label>
                        <Input
                          id="policy-cap-window"
                          type="number"
                          min={1}
                          value={definition.sendPolicy.frequencyCap.windowHours}
                          onChange={(event) => updateSendPolicy({
                            frequencyCap: {
                              maxMessages: definition.sendPolicy?.frequencyCap?.maxMessages ?? 3,
                              windowHours: Math.max(Number.parseInt(event.target.value, 10) || 1, 1),
                            },
                          })}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}
