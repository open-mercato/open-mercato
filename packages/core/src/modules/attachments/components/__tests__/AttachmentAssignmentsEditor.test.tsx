/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { AssignmentDraft } from '@open-mercato/ui/backend/detail'
import { AttachmentAssignmentsEditor } from '../AttachmentLibrary'

const labels = {
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

const getRows = () => Array.from(document.querySelectorAll('[data-assignment-card]'))
const getField = (row: number, field: number) =>
  getRows()[row].querySelectorAll('input')[field] as HTMLInputElement

const TYPE_FIELD = 0
const ID_FIELD = 1

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

describe('upload-dialog AttachmentAssignmentsEditor typing (issue #4338)', () => {
  it('keeps the Type field focused while typing a multi-character value', () => {
    render(<EditorHarness initial={[{ type: '', id: '', href: '', label: '' }]} />)

    typeInto(() => getField(0, TYPE_FIELD), 'catalog.product')

    // Assert against the live tree — the element still mounted and focused —
    // rather than the reference captured before typing started.
    expect(getField(0, TYPE_FIELD)).toHaveValue('catalog.product')
    expect(document.activeElement).toBe(getField(0, TYPE_FIELD))
    expect(document.activeElement).toHaveValue('catalog.product')
  })

  it('keeps the Record ID field focused while typing a multi-character value', () => {
    render(<EditorHarness initial={[{ type: '', id: '', href: '', label: '' }]} />)

    typeInto(() => getField(0, ID_FIELD), 'abc-123')

    expect(getField(0, ID_FIELD)).toHaveValue('abc-123')
    expect(document.activeElement).toBe(getField(0, ID_FIELD))
    expect(document.activeElement).toHaveValue('abc-123')
  })

  it('edits the intended row when several assignments are present', () => {
    render(
      <EditorHarness
        initial={[
          { type: 'catalog.product', id: 'p-1', href: '', label: '' },
          { type: '', id: '', href: '', label: '' },
        ]}
      />,
    )
    expect(getRows()).toHaveLength(2)

    typeInto(() => getField(1, TYPE_FIELD), 'sales.order')

    expect(getField(0, TYPE_FIELD)).toHaveValue('catalog.product')
    expect(getField(1, TYPE_FIELD)).toHaveValue('sales.order')
    expect(document.activeElement).toBe(getField(1, TYPE_FIELD))
  })

  // Index keys are only safe while the row stays fully controlled. This guards
  // that invariant: if a row ever gains internal state, removing a middle row
  // will leak it onto the row that shifts into the freed index and fail here.
  it('shows the surviving rows correctly after removing a middle row', () => {
    render(
      <EditorHarness
        initial={[
          { type: 'catalog.product', id: 'p-1', href: '', label: '' },
          { type: 'sales.order', id: 'o-2', href: '', label: '' },
          { type: 'customers.person', id: 'c-3', href: '', label: '' },
        ]}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: labels.remove })[1])

    expect(getRows()).toHaveLength(2)
    expect(getField(0, TYPE_FIELD)).toHaveValue('catalog.product')
    expect(getField(0, ID_FIELD)).toHaveValue('p-1')
    expect(getField(1, TYPE_FIELD)).toHaveValue('customers.person')
    expect(getField(1, ID_FIELD)).toHaveValue('c-3')
  })
})
