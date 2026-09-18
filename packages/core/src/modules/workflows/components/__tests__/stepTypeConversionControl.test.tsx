/**
 * @jest-environment jsdom
 *
 * Issue #5988 (a) — the step inspector's step-type control.
 *
 * The control is a statement about the step ("this is a USER TASK, pick
 * something else to change it"), not a write-only conversion target: it used to
 * open blank on every visit because its options excluded the step's own type
 * and its state reset to `''`, so it never said what the step was — not even
 * straight after a conversion.
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NodeEditDialogCrudForm } from '../NodeEditDialogCrudForm'

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/backend/workflows',
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, result: { items: [] }, response: {}, cacheStatus: null }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

const STEP_TYPE_LABEL = 'workflows.steps.stepType'
const CHANGE_TYPE_ACTION = 'Change type…'

function renderInspector(nodeType: string, onConvertType: jest.Mock, onSave = jest.fn(), onClose = jest.fn()) {
  return renderWithProviders(
    <NodeEditDialogCrudForm
      node={{ id: 'first_call', type: nodeType, position: { x: 0, y: 0 }, data: { label: 'First call' } } as never}
      isOpen
      onClose={onClose}
      onSave={onSave}
      onConvertType={onConvertType}
    />,
  )
}

describe('step type control', () => {
  it('opens the conversion confirmation when Save step is clicked with a pending type', async () => {
    const onConvertType = jest.fn()
    const onSave = jest.fn()
    const onClose = jest.fn()
    renderInspector('userTask', onConvertType, onSave, onClose)

    fireEvent.click(screen.getByLabelText(STEP_TYPE_LABEL))
    fireEvent.click(await screen.findByRole('option', { name: 'workflows.nodeTypes.automated' }))
    fireEvent.click(screen.getByRole('button', { name: 'workflows.form.saveStep' }))

    await waitFor(() => expect(onConvertType).toHaveBeenCalledWith('first_call', 'automated', expect.objectContaining({
      updates: expect.objectContaining({ label: 'First call' }),
    })))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each(['save', 'convert'])('passes unsaved name and route edits into confirmation through %s', async (action) => {
    const onConvertType = jest.fn()
    renderWithProviders(
      <NodeEditDialogCrudForm
        node={{ id: 'first_call', type: 'userTask', position: { x: 0, y: 0 }, data: { label: 'First call' } } as never}
        isOpen
        onClose={jest.fn()}
        onSave={jest.fn()}
        onConvertType={onConvertType}
        routeOrder={[{ transitionId: 'route-a', toStepId: 'next-step', label: 'Next step', priority: 1, hasCondition: false, isOtherwise: false }]}
      />,
    )
    fireEvent.change(screen.getByDisplayValue('First call'), { target: { value: 'Renamed step' } })
    fireEvent.click(screen.getByLabelText(STEP_TYPE_LABEL))
    fireEvent.click(await screen.findByRole('option', { name: 'workflows.nodeTypes.automated' }))
    fireEvent.click(screen.getByRole('button', { name: action === 'save' ? 'workflows.form.saveStep' : CHANGE_TYPE_ACTION }))

    await waitFor(() => expect(onConvertType).toHaveBeenCalledWith('first_call', 'automated', expect.objectContaining({
      updates: expect.objectContaining({ label: 'Renamed step', stepName: 'Renamed step' }),
      routeOrder: [expect.objectContaining({ transitionId: 'route-a' })],
    })))
  })

  it('restores unsaved values when conversion confirmation is cancelled, without leaking them to another step', async () => {
    let finishConfirmation: (confirmed: boolean) => void = () => undefined
    const onConvertType = jest.fn(() => new Promise<boolean>((resolve) => { finishConfirmation = resolve }))
    const onSave = jest.fn()
    const node = { id: 'first_call', type: 'userTask', position: { x: 0, y: 0 }, data: { label: 'First call' } }
    const renderNode = (currentNode: typeof node | null, isOpen: boolean) => (
      <NodeEditDialogCrudForm node={currentNode as never} isOpen={isOpen} onClose={jest.fn()} onSave={onSave} onConvertType={onConvertType} />
    )
    const { rerender } = renderWithProviders(renderNode(node, true))
    fireEvent.change(screen.getByDisplayValue('First call'), { target: { value: 'Unsaved name' } })
    fireEvent.click(screen.getByLabelText(STEP_TYPE_LABEL))
    fireEvent.click(await screen.findByRole('option', { name: 'workflows.nodeTypes.automated' }))
    fireEvent.click(screen.getByRole('button', { name: 'workflows.form.saveStep' }))
    await waitFor(() => expect(onConvertType).toHaveBeenCalledTimes(1))

    rerender(renderNode(null, false))
    await act(async () => { finishConfirmation(false) })
    rerender(renderNode(node, true))

    expect(await screen.findByDisplayValue('Unsaved name')).toBeTruthy()
    expect(screen.getByLabelText(STEP_TYPE_LABEL)).toHaveTextContent('workflows.nodeTypes.automated')
    expect(onSave).not.toHaveBeenCalled()

    rerender(renderNode({ ...node, id: 'second_call', data: { label: 'Second call' } }, true))
    expect(await screen.findByDisplayValue('Second call')).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText(STEP_TYPE_LABEL)).toHaveTextContent('workflows.nodeTypes.userTask'))
  })

  it('saves normally when the chosen type is changed back to the current type', async () => {
    const onConvertType = jest.fn()
    const onSave = jest.fn()
    const onClose = jest.fn()
    renderInspector('userTask', onConvertType, onSave, onClose)

    fireEvent.click(screen.getByLabelText(STEP_TYPE_LABEL))
    fireEvent.click(await screen.findByRole('option', { name: 'workflows.nodeTypes.automated' }))
    fireEvent.click(screen.getByLabelText(STEP_TYPE_LABEL))
    fireEvent.click(await screen.findByRole('option', { name: 'workflows.nodeTypes.userTask' }))
    fireEvent.click(screen.getByRole('button', { name: 'workflows.form.saveStep' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onConvertType).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the type the step currently has instead of an empty field', () => {
    renderInspector('userTask', jest.fn())

    expect(screen.getByLabelText(STEP_TYPE_LABEL)).toHaveTextContent('workflows.nodeTypes.userTask')
    expect(screen.getByRole('button', { name: CHANGE_TYPE_ACTION })).toBeDisabled()
  })

  it('converts to the picked type and keeps showing it afterwards', async () => {
    const onConvertType = jest.fn()
    const { rerender } = renderInspector('userTask', onConvertType)

    fireEvent.click(screen.getByLabelText(STEP_TYPE_LABEL))
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('option', { name: 'workflows.nodeTypes.automated' }))

    await waitFor(() =>
      expect(screen.getByLabelText(STEP_TYPE_LABEL)).toHaveTextContent('workflows.nodeTypes.automated'),
    )
    fireEvent.click(screen.getByRole('button', { name: CHANGE_TYPE_ACTION }))
    expect(onConvertType).toHaveBeenCalledWith('first_call', 'automated', expect.objectContaining({ updates: expect.objectContaining({ label: 'First call' }) }))

    // The page rewrites the node type once the author confirms; the control has
    // to follow the step rather than stranding the previous selection.
    rerender(
      <NodeEditDialogCrudForm
        node={{ id: 'first_call', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'First call' } } as never}
        isOpen
        onClose={jest.fn()}
        onSave={jest.fn()}
        onConvertType={onConvertType}
      />,
    )

    await waitFor(() =>
      expect(screen.getByLabelText(STEP_TYPE_LABEL)).toHaveTextContent('workflows.nodeTypes.automated'),
    )
    expect(screen.getByRole('button', { name: CHANGE_TYPE_ACTION })).toBeDisabled()
  })
})
