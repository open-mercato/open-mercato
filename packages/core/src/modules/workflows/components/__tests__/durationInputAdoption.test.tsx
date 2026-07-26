/**
 * @jest-environment jsdom
 *
 * Step 4.2 (#4229): the legacy Node/Edge dialogs render duration fields through the
 * shared DurationInput (composite amount+unit picker with a raw-text escape hatch)
 * instead of raw ISO-8601 text inputs. These tests pin the adoption: single-unit
 * ISO values open in the composite picker, while template/multi-unit values stay
 * editable through the raw-text mode.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EdgeEditDialog } from '../EdgeEditDialog'
import { NodeEditDialog } from '../NodeEditDialog'

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

const dialogCallbacks = {
  onClose: jest.fn(),
  onSave: jest.fn(),
  onDelete: jest.fn(),
}

describe('legacy workflow dialogs — DurationInput adoption (#4229)', () => {
  it('renders the timer duration as a composite picker for a single-unit ISO value', () => {
    renderWithProviders(
      <NodeEditDialog
        node={{ id: 'timer-1', type: 'waitForTimer', data: { config: { duration: 'PT10M' } } } as any}
        isOpen
        {...dialogCallbacks}
      />,
    )

    const amountInput = screen.getByRole('spinbutton', { name: 'workflows.activities.waitDuration' })
    expect(amountInput).toHaveValue(10)
  })

  it('keeps a template timer duration editable through raw-text mode', () => {
    renderWithProviders(
      <NodeEditDialog
        node={{ id: 'timer-2', type: 'waitForTimer', data: { config: { duration: '{{context.delay}}' } } } as any}
        isOpen
        {...dialogCallbacks}
      />,
    )

    const rawInput = screen.getByRole('textbox', { name: 'workflows.activities.waitDuration' })
    expect(rawInput).toHaveValue('{{context.delay}}')
  })

  it('renders the signal timeout default PT5M in the composite picker', () => {
    renderWithProviders(
      <NodeEditDialog
        node={{ id: 'signal-1', type: 'waitForSignal', data: { signalConfig: {} } } as any}
        isOpen
        {...dialogCallbacks}
      />,
    )

    const amountInput = screen.getByRole('spinbutton', { name: 'workflows.form.timeout' })
    expect(amountInput).toHaveValue(5)
  })

  it('renders the step timeout through DurationInput for non-wait nodes', () => {
    renderWithProviders(
      <NodeEditDialog
        node={{ id: 'task-1', type: 'userTask', data: {} } as any}
        isOpen
        {...dialogCallbacks}
      />,
    )

    expect(screen.getByRole('spinbutton', { name: 'workflows.form.timeout' })).toBeInTheDocument()
  })

  it('renders the edge activity timeout through DurationInput', () => {
    renderWithProviders(
      <EdgeEditDialog
        edge={{
          id: 'start_to_cart',
          data: {
            activities: [{ activityName: 'Timeout Activity', activityType: 'CALL_API', timeout: 'PT30S' }],
          },
        } as any}
        isOpen
        {...dialogCallbacks}
      />,
    )

    fireEvent.click(screen.getByText('Timeout Activity'))

    const amountInput = screen.getByRole('spinbutton', { name: 'workflows.edgeEditor.timeout' })
    expect(amountInput).toHaveValue(30)
  })
})
