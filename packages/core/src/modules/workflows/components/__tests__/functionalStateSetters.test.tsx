/**
 * @jest-environment jsdom
 *
 * Regression guard for #3171: array state in the workflow editor dialogs must be
 * updated with functional setters (`setX(prev => ...)`) so that two updates landing
 * in the same render batch both take effect. With a closed-over direct setter
 * (`setX([...x, item])`) the second batched update overwrites the first and an add
 * is silently lost.
 *
 * The two clicks are dispatched inside a single `act()` callback so React defers the
 * flush and both handlers run against the same render closure — the exact "batched
 * updates" condition described in the issue.
 */
import * as React from 'react'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EdgeEditDialog } from '../EdgeEditDialog'
import { NodeEditDialog } from '../NodeEditDialog'

// jsdom does not implement the pointer-capture / scrollIntoView APIs Radix uses.
if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

function clickTwiceInOneBatch(button: HTMLElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('workflow editor dialogs — functional state setters (#3171)', () => {
  it('EdgeEditDialog keeps both activities when add is invoked twice in one batch', () => {
    renderWithProviders(
      <EdgeEditDialog
        edge={{ id: 'start_to_cart', data: {} } as any}
        isOpen
        onClose={jest.fn()}
        onSave={jest.fn()}
        onDelete={jest.fn()}
      />,
    )

    const addActivity = screen.getByRole('button', { name: 'workflows.edgeEditor.addActivity' })
    clickTwiceInOneBatch(addActivity)

    // Each activity row renders one CALL_API type badge in its header.
    expect(screen.getAllByText('CALL_API')).toHaveLength(2)
  })

  it('NodeEditDialog keeps both form fields when add is invoked twice in one batch', () => {
    renderWithProviders(
      <NodeEditDialog
        node={{ id: 'task-1', type: 'userTask', data: {} } as any}
        isOpen
        onClose={jest.fn()}
        onSave={jest.fn()}
        onDelete={jest.fn()}
      />,
    )

    const addField = screen.getByRole('button', { name: 'workflows.form.addField' })
    clickTwiceInOneBatch(addField)

    // Each new form-field row renders its label (workflows.form.newField) once in the header.
    expect(screen.getAllByText('workflows.form.newField')).toHaveLength(2)
  })
})
