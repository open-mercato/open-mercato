/**
 * @jest-environment jsdom
 *
 * Step 1.4 — the five §6.1 task inspector sections rendered by the node editor.
 *
 * These drive the REAL dialog (not the transform functions directly), because
 * the thing that must not regress is that an authored value reaches `onSave`:
 * the vocabulary has been declared and persisted since 1.1–1.3, and the
 * inspector is what finally makes it authorable.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NodeEditDialogCrudForm } from '../NodeEditDialogCrudForm'

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

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

function renderInspector(data: Record<string, unknown>, onSave = jest.fn()) {
  renderWithProviders(
    <NodeEditDialogCrudForm
      node={{ id: 'approve-refund', type: 'userTask', position: { x: 0, y: 0 }, data } as any}
      isOpen
      onClose={jest.fn()}
      onSave={onSave}
      onDelete={jest.fn()}
    />,
  )
  return onSave
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'workflows.form.saveStep' }))
}

describe('task inspector — the five §6.1 sections', () => {
  it('renders every section for a user task step', () => {
    renderInspector({ stepName: 'Approve refund' })

    expect(screen.getByText('workflows.tasks.inspector.what.title')).toBeInTheDocument()
    expect(screen.getByText('workflows.tasks.inspector.bindings.title')).toBeInTheDocument()
    expect(screen.getByText('workflows.tasks.inspector.who.title')).toBeInTheDocument()
    expect(screen.getByText('workflows.tasks.inspector.when.title')).toBeInTheDocument()
    expect(screen.getByText('workflows.tasks.inspector.decisions.title')).toBeInTheDocument()
  })

  it('What: an edited title and instructions reach the save', async () => {
    const onSave = renderInspector({ stepName: 'Approve refund' })

    fireEvent.change(screen.getByLabelText('workflows.tasks.inspector.what.taskTitle'), {
      target: { value: 'Approve refund for {{context.customerName}}' },
    })
    fireEvent.change(screen.getByLabelText('workflows.tasks.inspector.what.instructions'), {
      target: { value: 'Refund {{context.order.total}}.' },
    })
    save()

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'approve-refund',
        expect.objectContaining({
          stepName: 'Approve refund for {{context.customerName}}',
          userTaskConfig: expect.objectContaining({ instructions: 'Refund {{context.order.total}}.' }),
        }),
      )
    })
  })

  it('About what: a linked record round-trips through the save path', async () => {
    const onSave = renderInspector({ stepName: 'Approve refund' })

    fireEvent.click(screen.getByRole('button', { name: 'workflows.tasks.inspector.bindings.add' }))
    fireEvent.change(screen.getByLabelText('workflows.tasks.inspector.bindings.entityType'), {
      target: { value: 'sales:order' },
    })
    fireEvent.change(screen.getByLabelText('workflows.tasks.inspector.bindings.idPath'), {
      target: { value: 'context.order.id' },
    })
    save()

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'approve-refund',
        expect.objectContaining({
          userTaskConfig: expect.objectContaining({
            entityBindings: [{ entityType: 'sales:order', idPath: 'context.order.id' }],
          }),
        }),
      )
    })
  })

  it('Who: the Dynamic tab demands a fallback role queue and keeps the pill', async () => {
    const onSave = renderInspector({
      stepName: 'Approve refund',
      assignedToRoles: ['approver'],
      userTaskConfig: { assignedToRoles: ['approver'] },
    })

    fireEvent.click(screen.getByRole('tab', { name: 'workflows.tasks.inspector.who.modes.dynamic' }))
    expect(screen.getByText('workflows.tasks.inspector.who.fallbackRolesHint')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('workflows.tasks.inspector.who.dynamicExpression'), {
      target: { value: '{{context.deal.ownerId}}' },
    })
    save()

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'approve-refund',
        expect.objectContaining({
          userTaskConfig: expect.objectContaining({
            assignedTo: '{{context.deal.ownerId}}',
            assignedToRoles: ['approver'],
          }),
        }),
      )
    })
  })

  it('Who: a dynamic assignment with no role queue warns that nobody would see the task', () => {
    renderInspector({ stepName: 'Approve refund', assignedTo: '{{context.deal.ownerId}}' })

    expect(screen.getByText('workflows.tasks.inspector.who.fallbackRolesRequired')).toBeInTheDocument()
  })

  it('When: a reminder offset reaches the save, and an empty row does not', async () => {
    const onSave = renderInspector({ stepName: 'Approve refund' })

    fireEvent.click(screen.getByRole('button', { name: 'workflows.tasks.inspector.when.addReminder' }))
    fireEvent.click(screen.getByRole('button', { name: 'workflows.tasks.inspector.when.addReminder' }))

    const offsets = screen.getAllByRole('spinbutton', {
      name: 'workflows.tasks.inspector.when.reminderOffset',
    })
    expect(offsets).toHaveLength(2)
    fireEvent.change(offsets[0], { target: { value: '2' } })
    save()

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const [, updates] = onSave.mock.calls[0] as [string, Record<string, any>]
    // Two rows were added, one left blank: a blank row is not a reminder.
    expect(updates.userTaskConfig.reminders).toEqual([{ offset: 'PT2M' }])
  })

  it('When: the deadline the author sets keeps the key the config already used', async () => {
    const onSave = renderInspector({
      stepName: 'Approve refund',
      deadline: { duration: 'PT4H' },
      userTaskConfig: { deadline: { duration: 'PT4H' } },
    })

    save()

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const [, updates] = onSave.mock.calls[0] as [string, Record<string, any>]
    expect(updates.userTaskConfig.deadline).toEqual({ duration: 'PT4H' })
    expect(updates.userTaskConfig.slaDuration).toBeUndefined()
  })

  it('a step with none of the new fields saves the config it always saved', async () => {
    const onSave = renderInspector({
      stepName: 'Approve refund',
      assignedTo: 'manager@example.com',
      userTaskConfig: { assignedTo: 'manager@example.com', slaDuration: 'P1D' },
    })

    save()

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const [, updates] = onSave.mock.calls[0] as [string, Record<string, any>]
    expect(updates.userTaskConfig).toEqual({ assignedTo: 'manager@example.com', slaDuration: 'P1D' })
  })
})
