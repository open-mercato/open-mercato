/**
 * Advanced Configuration value-contract regression tests (PR #4532 review).
 *
 * JsonBuilder calls setValue with the PARSED OBJECT after a valid edit, while
 * the transforms historically assumed a JSON string and crashed on
 * `values.advancedConfig.trim`. The transform boundary now accepts
 * `Record<string, unknown> | string`. Also covers the stale userTaskConfig
 * overwrite: the dialog-load path must only put genuinely unhandled keys into
 * the advanced blob, and the save path must keep the freshly built structured
 * fields authoritative over the blob.
 */
import type { Node } from '@xyflow/react'
import type { Edge } from '@xyflow/react'
import { nodeToFormValues, formValuesToNodeUpdates, type NodeFormValues } from '../nodeFormTransforms'
import { edgeToFormValues, formValuesToEdgeUpdates, type EdgeFormValues } from '../edgeFormTransforms'

const makeNode = (type: string, data: Record<string, unknown> = {}): Node => ({
  id: 'node-1',
  type,
  position: { x: 0, y: 0 },
  data: { stepName: 'Step', ...data },
})

const makeEdge = (data: Record<string, unknown> = {}): Edge => ({
  id: 'start_to_end',
  source: 'start',
  target: 'end',
  data,
})

describe('node advancedConfig value contract', () => {
  it('accepts the parsed object JsonBuilder emits and merges it into updates', () => {
    const node = makeNode('automated')
    const values: NodeFormValues = {
      stepName: 'Step',
      advancedConfig: { retryPolicy: { maxAttempts: 5 } },
    }

    const updates = formValuesToNodeUpdates(values, node) as Record<string, unknown>
    expect(updates.retryPolicy).toEqual({ maxAttempts: 5 })
  })

  it('still accepts a legacy JSON string', () => {
    const node = makeNode('automated')
    const values: NodeFormValues = {
      stepName: 'Step',
      advancedConfig: '{"retryPolicy": {"maxAttempts": 2}}',
    }

    const updates = formValuesToNodeUpdates(values, node) as Record<string, unknown>
    expect(updates.retryPolicy).toEqual({ maxAttempts: 2 })
  })

  it('throws the i18n key for an invalid JSON string', () => {
    const node = makeNode('automated')
    const values: NodeFormValues = { stepName: 'Step', advancedConfig: '{"broken":' }

    expect(() => formValuesToNodeUpdates(values, node)).toThrow('workflows.validation.invalidAdvancedConfigJson')
  })

  it('ignores an empty object and an empty string', () => {
    const node = makeNode('automated')
    expect(formValuesToNodeUpdates({ stepName: 'Step', advancedConfig: {} }, node)).not.toHaveProperty('retryPolicy')
    expect(formValuesToNodeUpdates({ stepName: 'Step', advancedConfig: '  ' }, node)).not.toHaveProperty('retryPolicy')
  })
})

describe('edge advancedConfig value contract', () => {
  const baseEdgeValues: EdgeFormValues = {
    transitionName: 'Go',
    trigger: 'auto',
    priority: '100',
    continueOnActivityFailure: false,
    preConditions: [],
    postConditions: [],
    activities: [],
  }

  it('accepts the parsed object JsonBuilder emits and merges it into updates', () => {
    const edge = makeEdge()
    const updates = formValuesToEdgeUpdates(
      { ...baseEdgeValues, advancedConfig: { customFlag: true } },
      edge,
    ) as Record<string, unknown>

    expect(updates.customFlag).toBe(true)
    expect(updates.transitionName).toBe('Go')
  })

  it('still accepts a legacy JSON string', () => {
    const edge = makeEdge()
    const updates = formValuesToEdgeUpdates(
      { ...baseEdgeValues, advancedConfig: '{"customFlag": 1}' },
      edge,
    ) as Record<string, unknown>

    expect(updates.customFlag).toBe(1)
  })

  it('throws the i18n key for an invalid JSON string', () => {
    const edge = makeEdge()
    expect(() =>
      formValuesToEdgeUpdates({ ...baseEdgeValues, advancedConfig: 'not json' }, edge),
    ).toThrow('workflows.validation.invalidAdvancedConfigJson')
  })

  it('loads an empty advanced config value', () => {
    const values = edgeToFormValues(makeEdge({ transitionName: 'Go' }))
    expect(values.advancedConfig).toBeUndefined()
  })
})

describe('userTask advancedConfig round-trip (stale userTaskConfig regression)', () => {
  const userTaskNode = makeNode('userTask', {
    assignedToRoles: ['Manager'],
    userTaskConfig: {
      formSchema: { fields: [{ name: 'amount', type: 'number', label: 'Amount', required: true }] },
      assignedToRoles: ['Manager'],
      slaDuration: 'PT1H',
      customEscalationChannel: 'slack',
    },
  })

  it('excludes structurally handled keys from the advanced blob at load', () => {
    const values = nodeToFormValues(userTaskNode)

    expect(values.slaDuration).toBe('PT1H')
    expect(values.formFields).toEqual([{ name: 'amount', type: 'number', label: 'Amount', required: true }])
    expect(values.advancedConfig).toEqual({ userTaskConfig: { customEscalationChannel: 'slack' } })
  })

  it('keeps field edits authoritative over the advanced blob on save (PT1H → PT2H)', () => {
    const values = nodeToFormValues(userTaskNode)
    values.slaDuration = 'PT2H'

    const updates = formValuesToNodeUpdates(values, userTaskNode) as Record<string, any>
    expect(updates.userTaskConfig.slaDuration).toBe('PT2H')
    expect(updates.userTaskConfig.customEscalationChannel).toBe('slack')
  })

  it('keeps formFields and roles edits on save', () => {
    const values = nodeToFormValues(userTaskNode)
    values.formFields = [{ name: 'reason', type: 'text', label: 'Reason', required: false } as any]
    values.assignedToRoles = ['Manager', 'Reviewer']

    const updates = formValuesToNodeUpdates(values, userTaskNode) as Record<string, any>
    expect(updates.userTaskConfig.formSchema).toEqual({
      fields: [{ name: 'reason', type: 'text', label: 'Reason', required: false }],
    })
    expect(updates.userTaskConfig.assignedToRoles).toEqual(['Manager', 'Reviewer'])
    expect(updates.userTaskConfig.customEscalationChannel).toBe('slack')
  })

  it('structured fields win even when the advanced blob still names a handled key', () => {
    const values = nodeToFormValues(userTaskNode)
    values.slaDuration = 'PT2H'
    values.advancedConfig = {
      userTaskConfig: { slaDuration: 'PT9H', customEscalationChannel: 'email' },
    }

    const updates = formValuesToNodeUpdates(values, userTaskNode) as Record<string, any>
    expect(updates.userTaskConfig.slaDuration).toBe('PT2H')
    expect(updates.userTaskConfig.customEscalationChannel).toBe('email')
  })
})
