/**
 * @jest-environment jsdom
 *
 * Step 2.5 (workflows UX Phase 3a): the WAIT_FOR_CONDITION inspector.
 * The node dialog exposes the shared ConditionBuilder predicate plus the
 * mandatory timeout policy, and the pure node-form transforms round-trip that
 * config through `node.data.config` while failing closed on the two mandatory
 * pieces.
 */
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
  usePathname: () => '/backend/workflows/definitions/visual-editor',
}))

import * as React from 'react'
import { screen } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NodeEditDialogCrudForm } from '../NodeEditDialogCrudForm'
import { nodeToFormValues, formValuesToNodeUpdates, type NodeFormValues } from '../../lib/nodeFormTransforms'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

const condition = {
  operator: 'AND',
  rules: [{ field: 'payment.status', operator: '==', value: 'captured' }],
}

function makeNode(config: Record<string, unknown> | undefined = undefined): Node {
  return {
    id: 'wait_for_payment',
    type: 'waitForCondition',
    position: { x: 0, y: 0 },
    data: { label: 'Wait for payment', config },
  } as unknown as Node
}

describe('WAIT_FOR_CONDITION node form transforms', () => {
  test('reads the predicate and timeout policy off node config', () => {
    const values = nodeToFormValues(
      makeNode({ condition, timeout: 'PT30M', onTimeout: 'CONTINUE', pollIntervalMs: 60000 })
    )

    expect(values.waitCondition).toEqual(condition)
    expect(values.waitConditionTimeout).toBe('PT30M')
    expect(values.waitConditionOnTimeout).toBe('CONTINUE')
    expect(values.waitConditionPollIntervalMs).toBe('60000')
  })

  test('defaults onTimeout to FAIL and leaves the poll interval unset', () => {
    const values = nodeToFormValues(makeNode({ condition, timeout: 'PT30M' }))

    expect(values.waitConditionOnTimeout).toBe('FAIL')
    expect(values.waitConditionPollIntervalMs).toBe('')
  })

  test('writes the config back, omitting an unset poll interval', () => {
    const updates = formValuesToNodeUpdates(
      {
        stepName: 'Wait for payment',
        waitCondition: condition,
        waitConditionTimeout: 'PT30M',
        waitConditionOnTimeout: 'CONTINUE',
        waitConditionPollIntervalMs: '',
      } as NodeFormValues,
      makeNode()
    )

    expect(updates.config).toEqual({ condition, timeout: 'PT30M', onTimeout: 'CONTINUE' })
  })

  test('fails closed without a condition', () => {
    expect(() =>
      formValuesToNodeUpdates(
        { stepName: 'Wait', waitConditionTimeout: 'PT30M' } as NodeFormValues,
        makeNode()
      )
    ).toThrow('workflows.validation.conditionRequired')
  })

  test('fails closed without a timeout', () => {
    expect(() =>
      formValuesToNodeUpdates(
        { stepName: 'Wait', waitCondition: condition } as NodeFormValues,
        makeNode()
      )
    ).toThrow('workflows.validation.conditionTimeoutRequired')
  })

  test('fails closed on a malformed timeout duration', () => {
    expect(() =>
      formValuesToNodeUpdates(
        { stepName: 'Wait', waitCondition: condition, waitConditionTimeout: '30 minutes' } as NodeFormValues,
        makeNode()
      )
    ).toThrow('workflows.validation.invalidDuration')
  })

  test('fails closed on a non-integer poll interval', () => {
    expect(() =>
      formValuesToNodeUpdates(
        {
          stepName: 'Wait',
          waitCondition: condition,
          waitConditionTimeout: 'PT30M',
          waitConditionPollIntervalMs: '1.5',
        } as NodeFormValues,
        makeNode()
      )
    ).toThrow('workflows.validation.conditionPollIntervalInvalid')
  })
})

describe('WAIT_FOR_CONDITION inspector', () => {
  test('renders the condition and timeout-policy sections', () => {
    renderWithProviders(
      <NodeEditDialogCrudForm
        node={makeNode({ condition, timeout: 'PT30M' })}
        isOpen
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(screen.getByText('Wait Condition')).toBeInTheDocument()
    expect(screen.getByText('Timeout Policy')).toBeInTheDocument()
    expect(screen.getByText(/A timeout is required/)).toBeInTheDocument()
    expect(screen.getByText('On timeout')).toBeInTheDocument()
    expect(screen.getByText('Poll interval (ms)')).toBeInTheDocument()
  })
})
