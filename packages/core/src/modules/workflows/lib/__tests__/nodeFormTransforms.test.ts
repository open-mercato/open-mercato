import type { Node } from '@xyflow/react'
import { nodeToFormValues, formValuesToNodeUpdates, type NodeFormValues } from '../nodeFormTransforms'

const makeTimerNode = (config?: Record<string, unknown>): Node => ({
  id: 'wait-1',
  type: 'waitForTimer',
  position: { x: 0, y: 0 },
  data: { stepName: 'Wait Step', ...(config ? { config } : {}) },
})

const futureIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
const pastIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

describe('nodeFormTransforms waitForTimer', () => {
  it('round-trips a duration-only timer config', () => {
    const node = makeTimerNode({ duration: 'PT5M' })
    const values = nodeToFormValues(node)

    expect(values.timerDuration).toBe('PT5M')
    expect(values.timerUntil).toBe('')

    const updates = formValuesToNodeUpdates(values, node)
    expect(updates.config).toEqual({ duration: 'PT5M' })
  })

  it('round-trips an until-only timer config', () => {
    const node = makeTimerNode({ until: futureIso })
    const values = nodeToFormValues(node)

    expect(values.timerDuration).toBe('')
    expect(values.timerUntil).toBe(futureIso)

    const updates = formValuesToNodeUpdates(values, node)
    expect(updates.config).toEqual({ until: futureIso })
  })

  it('loads empty timer fields when the node has no config', () => {
    const values = nodeToFormValues(makeTimerNode())
    expect(values.timerDuration).toBe('')
    expect(values.timerUntil).toBe('')
  })

  it('throws when both duration and until are set', () => {
    const node = makeTimerNode()
    const values: NodeFormValues = { stepName: 'Wait Step', timerDuration: 'PT5M', timerUntil: futureIso }

    expect(() => formValuesToNodeUpdates(values, node)).toThrow('workflows.validation.timerDurationXorUntil')
  })

  it('throws when neither duration nor until is set', () => {
    const node = makeTimerNode()
    const values: NodeFormValues = { stepName: 'Wait Step', timerDuration: '', timerUntil: '' }

    expect(() => formValuesToNodeUpdates(values, node)).toThrow('workflows.validation.timerDurationOrUntilRequired')
  })

  it('throws on an invalid duration string', () => {
    const node = makeTimerNode()
    const values: NodeFormValues = { stepName: 'Wait Step', timerDuration: 'not-a-duration', timerUntil: '' }

    expect(() => formValuesToNodeUpdates(values, node)).toThrow('workflows.validation.invalidDuration')
  })

  it('throws when until is in the past', () => {
    const node = makeTimerNode()
    const values: NodeFormValues = { stepName: 'Wait Step', timerDuration: '', timerUntil: pastIso }

    expect(() => formValuesToNodeUpdates(values, node)).toThrow('workflows.validation.untilMustBeFuture')
  })

  it('accepts template expressions for duration', () => {
    const node = makeTimerNode()
    const values: NodeFormValues = { stepName: 'Wait Step', timerDuration: '{{context.waitDuration}}', timerUntil: '' }

    const updates = formValuesToNodeUpdates(values, node)
    expect(updates.config).toEqual({ duration: '{{context.waitDuration}}' })
  })
})
