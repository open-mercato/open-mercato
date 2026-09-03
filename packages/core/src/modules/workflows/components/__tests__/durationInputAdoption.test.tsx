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
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { EdgeEditDialog } from '../EdgeEditDialog'
import { NodeEditDialog } from '../NodeEditDialog'
import { NodeEditDialogCrudForm, DurationCrudField } from '../NodeEditDialogCrudForm'
import { ActivityArrayEditor, type Activity } from '../fields/ActivityArrayEditor'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/backend/workflows',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

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

describe('CrudForm workflow dialogs — DurationInput adoption (#4229)', () => {
  const baseActivity: Activity = {
    activityId: 'fetch_data',
    activityName: 'Fetch Data',
    activityType: 'CALL_API',
    config: {},
    timeout: 'PT30S',
  }

  it('renders the per-activity timeout as a composite picker in ActivityArrayEditor', () => {
    renderWithProviders(
      <ActivityArrayEditor
        id="stepActivities"
        value={[baseActivity]}
        setValue={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Fetch Data'))

    const amountInput = screen.getByRole('spinbutton', { name: 'workflows.fieldEditors.activities.timeout' })
    expect(amountInput).toHaveValue(30)
  })

  it('keeps a template activity timeout editable through raw-text mode in ActivityArrayEditor', () => {
    renderWithProviders(
      <ActivityArrayEditor
        id="stepActivities"
        value={[{ ...baseActivity, timeout: '{{context.timeout}}' }]}
        setValue={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Fetch Data'))

    const rawInput = screen.getByRole('textbox', { name: 'workflows.fieldEditors.activities.timeout' })
    expect(rawInput).toHaveValue('{{context.timeout}}')
  })

  it('serializes composite edits back to an ISO string via the DurationCrudField wrapper', () => {
    const setValue = jest.fn()
    renderWithProviders(
      <DurationCrudField id="signalTimeout" value="PT5M" setValue={setValue} />,
    )

    const amountInput = screen.getByRole('spinbutton', { name: 'Duration amount' })
    expect(amountInput).toHaveValue(5)

    fireEvent.change(amountInput, { target: { value: '10' } })
    expect(setValue).toHaveBeenCalledWith('PT10M')
  })

  it('keeps millisecond values editable through raw-text mode in the DurationCrudField wrapper', () => {
    renderWithProviders(
      <DurationCrudField id="timeout" value="30000" setValue={jest.fn()} />,
    )

    const rawInput = screen.getByRole('textbox', { name: 'Duration expression' })
    expect(rawInput).toHaveValue('30000')
  })

  it('wires the timeout and signal timeout fields through DurationInput in NodeEditDialogCrudForm', () => {
    renderWithProviders(
      <NodeEditDialogCrudForm
        node={{ id: 'signal-crud-1', type: 'waitForSignal', data: { timeout: 'PT30S', signalConfig: { timeout: 'PT5M' } } } as any}
        isOpen
        {...dialogCallbacks}
      />,
    )

    const amountInputs = screen.getAllByRole('spinbutton', { name: 'Duration amount' })
    expect(amountInputs.map((input) => (input as HTMLInputElement).value)).toEqual(
      expect.arrayContaining(['30', '5']),
    )
  })

  // The control is the same one; only the WORD changed. Spec §6.1 makes the
  // task inspector speak the business vocabulary — a person is given a
  // deadline, never an "SLA duration" and never a "timeout" — while the stored
  // key and its legacy `slaDuration` value stay exactly as they were.
  it('renders the legacy SLA value under the deadline label in the user task inspector (6.2)', () => {
    renderWithProviders(
      <NodeEditDialogCrudForm
        node={{
          id: 'task-crud-1',
          type: 'userTask',
          data: { stepName: 'Approve Order', userTaskConfig: { slaDuration: 'PT1H' } },
        } as any}
        isOpen
        {...dialogCallbacks}
      />,
    )

    expect(screen.getByText('workflows.tasks.inspector.when.deadline')).toBeInTheDocument()
    expect(screen.queryByText('workflows.tasks.userTaskConfig.slaDuration')).not.toBeInTheDocument()
    const amountInputs = screen.getAllByRole('spinbutton', { name: 'Duration amount' })
    expect(amountInputs.map((input) => (input as HTMLInputElement).value)).toEqual(
      expect.arrayContaining(['1']),
    )
  })

  it('routes step-ID sanitization feedback through flash instead of window.alert (6.2)', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)
    const onSave = jest.fn()
    renderWithProviders(
      <NodeEditDialogCrudForm
        node={{ id: 'My Step', type: 'decision', data: { stepName: 'Decide' } } as any}
        isOpen
        onClose={jest.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflows.form.saveStep' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(alertSpy).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith('workflows.nodeEditor.stepIdSanitized', 'warning')
    alertSpy.mockRestore()
  })
})
