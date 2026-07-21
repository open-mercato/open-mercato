/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AttachmentAssignmentsEditor } from '../AttachmentMetadataDialog'
import type { AssignmentDraft } from '../AttachmentMetadataDialog'

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

function typeInto(input: HTMLElement, text: string) {
  input.focus()
  Array.from(text).forEach((char, idx) => {
    fireEvent.change(input, { target: { value: text.slice(0, idx + 1) } })
  })
}

describe('AttachmentAssignmentsEditor typing (issue #4338)', () => {
  it('keeps focus on the Type field while typing a multi-character value', () => {
    renderWithProviders(<EditorHarness initial={[{ type: '', id: '', href: '', label: '' }]} />, { dict: {} })

    const typeInput = screen.getByPlaceholderText('catalog.product')
    typeInto(typeInput, 'catalog.product')

    expect(typeInput).toHaveValue('catalog.product')
    expect(document.activeElement).toBe(typeInput)
  })

  it('keeps focus on the Record ID field while typing a multi-character value', () => {
    renderWithProviders(<EditorHarness initial={[{ type: '', id: '', href: '', label: '' }]} />, { dict: {} })

    const idInput = screen.getByPlaceholderText('Record ID')
    typeInto(idInput, 'abc-123')

    expect(idInput).toHaveValue('abc-123')
    expect(document.activeElement).toBe(idInput)
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

    const typeInputs = screen.getAllByPlaceholderText('catalog.product')
    expect(typeInputs).toHaveLength(2)

    typeInto(typeInputs[1], 'sales.order')

    expect(typeInputs[0]).toHaveValue('catalog.product')
    expect(typeInputs[1]).toHaveValue('sales.order')
    expect(document.activeElement).toBe(typeInputs[1])
  })
})
