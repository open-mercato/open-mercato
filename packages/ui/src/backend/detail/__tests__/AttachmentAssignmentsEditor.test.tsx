/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AttachmentAssignmentsEditor } from '../AttachmentMetadataDialog'
import type { AssignmentDraft, AssignmentEditorLabels } from '../AttachmentMetadataDialog'

const labels: AssignmentEditorLabels = {
  title: 'Assignments',
  description: 'Link this attachment to records',
  type: 'Type',
  id: 'Record ID',
  href: 'Link',
  label: 'Label',
  add: 'Add assignment',
  remove: 'Remove',
}

function EditorHarness({ initial }: { initial: AssignmentDraft[] }) {
  const [value, setValue] = React.useState<AssignmentDraft[]>(initial)
  return <AttachmentAssignmentsEditor value={value} onChange={setValue} labels={labels} />
}

/**
 * Re-queries the input before every keystroke. A stale reference would keep
 * accepting `fireEvent.change` after a remount detached it from the document,
 * which is exactly how this bug hid from a naive assertion.
 */
function typeInto(getInput: () => HTMLInputElement, text: string) {
  getInput().focus()
  Array.from(text).forEach((char) => {
    const input = getInput()
    fireEvent.change(input, { target: { value: input.value + char } })
  })
}

const getTypeInput = (index = 0) =>
  screen.getAllByPlaceholderText('catalog.product')[index] as HTMLInputElement
const getIdInput = (index = 0) =>
  screen.getAllByPlaceholderText('Record ID')[index] as HTMLInputElement

describe('AttachmentAssignmentsEditor typing (issue #4338)', () => {
  it('keeps the Type field focused while typing a multi-character value', () => {
    renderWithProviders(<EditorHarness initial={[{ type: '', id: '', href: '', label: '' }]} />, { dict: {} })

    typeInto(() => getTypeInput(), 'catalog.product')

    // Assert against the live tree — the element still mounted and focused —
    // rather than the reference captured before typing started.
    expect(getTypeInput()).toHaveValue('catalog.product')
    expect(document.activeElement).toBe(getTypeInput())
    expect(document.activeElement).toHaveValue('catalog.product')
  })

  it('keeps the Record ID field focused while typing a multi-character value', () => {
    renderWithProviders(<EditorHarness initial={[{ type: '', id: '', href: '', label: '' }]} />, { dict: {} })

    typeInto(() => getIdInput(), 'abc-123')

    expect(getIdInput()).toHaveValue('abc-123')
    expect(document.activeElement).toBe(getIdInput())
    expect(document.activeElement).toHaveValue('abc-123')
  })

  it('edits the intended row when several assignments are present', () => {
    renderWithProviders(
      <EditorHarness
        initial={[
          { type: 'catalog.product', id: 'p-1', href: '', label: '' },
          { type: '', id: '', href: '', label: '' },
        ]}
      />,
      { dict: {} },
    )

    typeInto(() => getTypeInput(1), 'sales.order')

    expect(getTypeInput(0)).toHaveValue('catalog.product')
    expect(getTypeInput(1)).toHaveValue('sales.order')
    expect(document.activeElement).toBe(getTypeInput(1))
  })

  // Index keys are only safe while the row stays fully controlled. This guards
  // that invariant: if a row ever gains internal state, removing a middle row
  // will leak it onto the row that shifts into the freed index and fail here.
  it('shows the surviving rows correctly after removing a middle row', () => {
    renderWithProviders(
      <EditorHarness
        initial={[
          { type: 'catalog.product', id: 'p-1', href: '', label: '' },
          { type: 'sales.order', id: 'o-2', href: '', label: '' },
          { type: 'customers.person', id: 'c-3', href: '', label: '' },
        ]}
      />,
      { dict: {} },
    )

    fireEvent.click(screen.getAllByRole('button', { name: labels.remove })[1])

    expect(screen.getAllByPlaceholderText('catalog.product')).toHaveLength(2)
    expect(getTypeInput(0)).toHaveValue('catalog.product')
    expect(getIdInput(0)).toHaveValue('p-1')
    expect(getTypeInput(1)).toHaveValue('customers.person')
    expect(getIdInput(1)).toHaveValue('c-3')
  })
})
