/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NodeEditDialog } from '../NodeEditDialog'
import type { Node } from '@xyflow/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
}

describe('NodeEditDialog', () => {
  it('submits user task form config without stale advanced config overwriting it', async () => {
    const onSave = jest.fn()

    renderWithProviders(
      <NodeEditDialog
        node={{
          id: 'usertask_initial_contact',
          type: 'userTask',
          data: {
            label: 'Initial contact',
            userTaskConfig: {},
          },
        } as unknown as Node}
        isOpen
        onClose={jest.fn()}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('workflows.form.placeholders.roles'), {
      target: { value: 'Sales Representative' },
    })
    fireEvent.change(screen.getByPlaceholderText('workflows.form.placeholders.formKey'), {
      target: { value: 'initial_contact_form' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflows.form.addField' }))

    fireEvent.change(screen.getByDisplayValue(/^field_\d+$/), {
      target: { value: 'conversation_summary' },
    })
    fireEvent.change(screen.getByDisplayValue('workflows.form.newField'), {
      target: { value: 'Conversation summary' },
    })
    fireEvent.change(screen.getByPlaceholderText('workflows.form.placeholders.placeholder'), {
      target: { value: 'Please fill in the details of the conversation' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflows.actions.saveChanges' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'usertask_initial_contact',
        expect.objectContaining({
          assignedToRoles: ['Sales Representative'],
          formKey: 'initial_contact_form',
          userTaskConfig: expect.objectContaining({
            assignedToRoles: ['Sales Representative'],
            formSchema: {
              fields: [
                expect.objectContaining({
                  name: 'conversation_summary',
                  type: 'text',
                  label: 'Conversation summary',
                  required: false,
                  placeholder: 'Please fill in the details of the conversation',
                }),
              ],
            },
          }),
        }),
      )
    })
  })
})
