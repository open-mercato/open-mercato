import { createWorkflowDefinitionInputCheckedSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { buildVariantWorkflowDraft, defaultDraftWorkflowId, type VariantDraftInput } from '../variantDraft'

const HASH = 'b'.repeat(64)

const field = (key: string) => ({ key, labelKey: `fields.${key}`, valueKind: 'dictionary' as const, snapshotPaths: [key], changeKeys: [key] })

function input(overrides: Partial<VariantDraftInput> = {}): VariantDraftInput {
  return {
    process: { processKey: 'customers.deal', stageFields: [field('status'), field('pipelineStageId')] },
    variantHash: HASH,
    activityKeys: ['created', 'status:open', 'pipelineStageId:7d9b2c3e-0000-4000-8000-000000000001', 'status:won', 'ownerUserId:changed', 'payment.created', 'status:other'],
    commandId: 'customers.deals.update',
    labels: {
      workflowName: 'Deal: observed path',
      description: 'Generated draft',
      start: 'Start',
      end: 'End',
      recordId: 'Record ID',
      stepName: (fieldKey, value) => `Set ${fieldKey} to ${value}`,
    },
    ...overrides,
  }
}

describe('buildVariantWorkflowDraft', () => {
  it('builds a disabled draft with one UPDATE_ENTITY step per stage activity and reports the rest as skipped', () => {
    const draft = buildVariantWorkflowDraft(input())
    if (!draft) throw new Error('[internal] expected a draft')
    expect(draft.payload).toEqual(expect.objectContaining({
      workflowId: `xray.customers.deal.${HASH.slice(0, 12)}`,
      workflowName: 'Deal: observed path',
      enabled: false,
      lifecycle: 'draft',
      kind: 'workflow',
      version: 1,
    }))
    const definition = draft.payload.definition as {
      steps: Array<{ stepId: string; stepType: string; activities?: Array<{ activityType: string; config: unknown }> }>
      transitions: Array<{ transitionId: string; fromStepId: string; toStepId: string; trigger: string }>
      contextSchema: unknown
    }
    expect(definition.steps.map((step) => [step.stepId, step.stepType])).toEqual([
      ['start', 'START'],
      ['set_status_1', 'AUTOMATED'],
      ['set_pipelinestageid_2', 'AUTOMATED'],
      ['set_status_3', 'AUTOMATED'],
      ['end', 'END'],
    ])
    expect(definition.steps.flatMap((step) => step.activities ?? []).map((activity) => activity.activityType)).toEqual(['UPDATE_ENTITY', 'UPDATE_ENTITY', 'UPDATE_ENTITY'])
    expect(definition.steps[2].activities?.[0].config).toEqual({
      commandId: 'customers.deals.update',
      input: { id: '{{context.recordId}}', pipelineStageId: '7d9b2c3e-0000-4000-8000-000000000001' },
    })
    expect(definition.transitions.map((transition) => [transition.fromStepId, transition.toStepId, transition.trigger])).toEqual([
      ['start', 'set_status_1', 'auto'],
      ['set_status_1', 'set_pipelinestageid_2', 'auto'],
      ['set_pipelinestageid_2', 'set_status_3', 'auto'],
      ['set_status_3', 'end', 'auto'],
    ])
    expect(definition.contextSchema).toEqual({ input: { fields: [{ name: 'recordId', type: 'text', label: 'Record ID', required: true }] } })
    expect(draft.activityStepMap).toEqual({
      'status:open': 'set_status_1',
      'pipelineStageId:7d9b2c3e-0000-4000-8000-000000000001': 'set_pipelinestageid_2',
      'status:won': 'set_status_3',
    })
    expect(draft.skippedActivities).toEqual(['created', 'ownerUserId:changed', 'payment.created', 'status:other'])
  })

  it('applies input key mappings, a custom record id key, workflow id and name', () => {
    const draft = buildVariantWorkflowDraft(input({
      activityKeys: ['status:won'],
      inputKeys: { status: 'statusValue' },
      recordIdInputKey: 'dealId',
      workflowId: 'deals.auto-win',
      workflowName: 'Auto win',
    }))
    expect(draft?.payload).toEqual(expect.objectContaining({ workflowId: 'deals.auto-win', workflowName: 'Auto win' }))
    const definition = draft?.payload.definition as { steps: Array<{ activities?: Array<{ config: unknown }> }> }
    expect(definition.steps[1].activities?.[0].config).toEqual({ commandId: 'customers.deals.update', input: { dealId: '{{context.recordId}}', statusValue: 'won' } })
  })

  it('produces a payload the workflows definition schema accepts unchanged in its draft fields', () => {
    const draft = buildVariantWorkflowDraft(input())
    const parsed = createWorkflowDefinitionInputCheckedSchema.safeParse(draft?.payload)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toEqual(expect.objectContaining({ enabled: false, lifecycle: 'draft', kind: 'workflow' }))
  })

  it('returns null for a variant without an expressible stage activity', () => {
    expect(buildVariantWorkflowDraft(input({ activityKeys: ['created', 'status:none', 'deleted'] }))).toBeNull()
  })

  it('keeps default workflow ids within 100 characters', () => {
    const longKey = `${'a'.repeat(64)}.${'b'.repeat(64)}`
    const id = defaultDraftWorkflowId(longKey, HASH)
    expect(id.length).toBeLessThanOrEqual(100)
    expect(id).toMatch(/^xray\.[0-9a-f]{16}\.b{12}$/)
  })
})
