/**
 * Sub-workflow output port contract × output mapping.
 *
 * `outputMapping` is `{ parentKey: childPath }` while `io.outputs` ports are
 * named in the child's vocabulary, so the child output is validated/coerced
 * against the ports first and only then mapped onto caller-chosen parent keys.
 */

import { describe, test, expect } from '@jest/globals'
import { mapSubWorkflowOutput } from '../step-handler'
import type { PortField, WorkflowIoContract } from '../../data/validators'

const port = (overrides: Partial<PortField> & Pick<PortField, 'name' | 'type'>): PortField => ({
  label: overrides.name,
  required: false,
  ...overrides,
})

const contract = (...outputs: PortField[]): WorkflowIoContract => ({ outputs })

describe('mapSubWorkflowOutput — output ports with renamed parent keys', () => {
  test('renamed required output port succeeds', () => {
    const mapped = mapSubWorkflowOutput(
      { childValue: 'port-alpha' },
      { renamedValue: 'childValue' },
      contract(port({ name: 'childValue', type: 'text', required: true })),
    )

    expect(mapped).toEqual({ outputData: { renamedValue: 'port-alpha' } })
  })

  test('identity mapping still succeeds', () => {
    const mapped = mapSubWorkflowOutput(
      { childValue: 'port-alpha' },
      { childValue: 'childValue' },
      contract(port({ name: 'childValue', type: 'text', required: true })),
    )

    expect(mapped).toEqual({ outputData: { childValue: 'port-alpha' } })
  })

  test('missing required child port still fails, naming the child port', () => {
    const mapped = mapSubWorkflowOutput(
      { unrelated: 'x' },
      { renamedValue: 'childValue' },
      contract(port({ name: 'childValue', type: 'text', required: true })),
    )

    expect(mapped.outputData).toBeUndefined()
    expect(mapped.error).toBe('Sub-workflow output validation failed: Required port "childValue" is missing')
  })

  test('a required port the parent does not map is still enforced on the child output', () => {
    const ports = contract(
      port({ name: 'childValue', type: 'text', required: true }),
      port({ name: 'auditRef', type: 'text', required: true }),
    )

    expect(mapSubWorkflowOutput({ childValue: 'a' }, { renamedValue: 'childValue' }, ports).error)
      .toContain('Required port "auditRef" is missing')
    expect(mapSubWorkflowOutput({ childValue: 'a', auditRef: 'r-1' }, { renamedValue: 'childValue' }, ports))
      .toEqual({ outputData: { renamedValue: 'a' } })
  })

  test('optional child port that is absent is skipped without failing', () => {
    const mapped = mapSubWorkflowOutput(
      { childValue: 'port-alpha' },
      { renamedValue: 'childValue', renamedNote: 'childNote' },
      contract(
        port({ name: 'childValue', type: 'text', required: true }),
        port({ name: 'childNote', type: 'text' }),
      ),
    )

    expect(mapped).toEqual({ outputData: { renamedValue: 'port-alpha' } })
  })

  test('optional child port that is present is coerced and mapped', () => {
    const mapped = mapSubWorkflowOutput(
      { childScore: '7' },
      { parentScore: 'childScore' },
      contract(port({ name: 'childScore', type: 'number' })),
    )

    expect(mapped).toEqual({ outputData: { parentScore: 7 } })
  })

  test('coerces number, boolean, date and select ports before mapping to renamed keys', () => {
    const mapped = mapSubWorkflowOutput(
      { amount: '250', approved: 'yes', decidedAt: '2026-01-08T12:00:00Z', decision: 'approve' },
      { total: 'amount', isApproved: 'approved', decisionDate: 'decidedAt', verdict: 'decision' },
      contract(
        port({ name: 'amount', type: 'number', required: true }),
        port({ name: 'approved', type: 'boolean', required: true }),
        port({ name: 'decidedAt', type: 'date' }),
        port({ name: 'decision', type: 'select', options: ['approve', 'reject'] }),
      ),
    )

    expect(mapped).toEqual({
      outputData: {
        total: 250,
        isApproved: true,
        decisionDate: '2026-01-08T12:00:00.000Z',
        verdict: 'approve',
      },
    })
  })

  test('an uncoercible child value fails validation under the child port name', () => {
    const mapped = mapSubWorkflowOutput(
      { amount: 'not-a-number' },
      { total: 'amount' },
      contract(port({ name: 'amount', type: 'number', required: true })),
    )

    expect(mapped.error).toBe('Sub-workflow output validation failed: Port "amount" expects a number')
  })

  test('maps multiple output ports to different parent names', () => {
    const mapped = mapSubWorkflowOutput(
      { childA: 'alpha', childB: '2', childC: 'false' },
      { parentA: 'childA', parentB: 'childB', parentC: 'childC' },
      contract(
        port({ name: 'childA', type: 'text', required: true }),
        port({ name: 'childB', type: 'number', required: true }),
        port({ name: 'childC', type: 'boolean', required: true }),
      ),
    )

    expect(mapped).toEqual({ outputData: { parentA: 'alpha', parentB: 2, parentC: false } })
  })

  test('coerces by the SOURCE child port when a parent key collides with another port name', () => {
    const mapped = mapSubWorkflowOutput(
      { count: '3', label: 42 },
      { count: 'label', label: 'count' },
      contract(
        port({ name: 'count', type: 'number', required: true }),
        port({ name: 'label', type: 'text', required: true }),
      ),
    )

    expect(mapped).toEqual({ outputData: { count: '42', label: 3 } })
  })

  test('non-port object/array values and nested paths pass through mapping unchanged', () => {
    const lines = [{ sku: 'A', qty: 1 }]
    const mapped = mapSubWorkflowOutput(
      { childValue: 'port-alpha', result: { lines, meta: { source: 'child' } } },
      { renamedValue: 'childValue', parentLines: 'result.lines', 'summary.source': 'result.meta.source' },
      contract(port({ name: 'childValue', type: 'text', required: true })),
    )

    expect(mapped).toEqual({
      outputData: { renamedValue: 'port-alpha', parentLines: lines, summary: { source: 'child' } },
    })
  })

  test('with no mapping the whole child context is returned, coerced against the ports', () => {
    const mapped = mapSubWorkflowOutput(
      { amount: '10', extra: 'kept' },
      {},
      contract(port({ name: 'amount', type: 'number', required: true })),
    )

    expect(mapped).toEqual({ outputData: { amount: 10, extra: 'kept' } })
  })

  test('without a declared contract the mapping is applied unvalidated', () => {
    expect(mapSubWorkflowOutput({ childValue: 'port-alpha' }, { renamedValue: 'childValue' }))
      .toEqual({ outputData: { renamedValue: 'port-alpha' } })
    expect(mapSubWorkflowOutput({ childValue: 'port-alpha' }, { renamedValue: 'childValue' }, { inputs: [] }))
      .toEqual({ outputData: { renamedValue: 'port-alpha' } })
  })
})
