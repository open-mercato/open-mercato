/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { AttachmentAssignmentsEditor } from '../AttachmentLibrary'

type AssignmentDraft = { type: string; id: string; href?: string; label?: string }

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
  Array.from(text).forEach((_char, idx) => {
    fireEvent.change(input, { target: { value: text.slice(0, idx + 1) } })
  })
}

describe('upload-dialog AttachmentAssignmentsEditor typing (issue #4338)', () => {
  it('keeps focus on the Type field while typing a multi-character value', () => {
    const { container } = render(<EditorHarness initial={[{ type: '', id: '', href: '', label: '' }]} />)
    const typeInput = container.querySelectorAll('input')[0] as HTMLInputElement

    typeInto(typeInput, 'catalog.product')

    expect(typeInput).toHaveValue('catalog.product')
    expect(document.activeElement).toBe(typeInput)
  })

  it('keeps focus on the Record ID field while typing a multi-character value', () => {
    const { container } = render(<EditorHarness initial={[{ type: '', id: '', href: '', label: '' }]} />)
    const idInput = container.querySelectorAll('input')[1] as HTMLInputElement

    typeInto(idInput, 'abc-123')

    expect(idInput).toHaveValue('abc-123')
    expect(document.activeElement).toBe(idInput)
  })

  it('edits the intended row when several assignments are present', () => {
    const { container } = render(
      <EditorHarness
        initial={[
          { type: 'catalog.product', id: 'p-1', href: '', label: '' },
          { type: '', id: '', href: '', label: '' },
        ]}
      />,
    )
    const rows = container.querySelectorAll('div.rounded.border.p-3')
    expect(rows).toHaveLength(2)

    const secondRowType = rows[1].querySelectorAll('input')[0] as HTMLInputElement
    typeInto(secondRowType, 'sales.order')

    const firstRowType = rows[0].querySelectorAll('input')[0] as HTMLInputElement
    expect(firstRowType).toHaveValue('catalog.product')
    expect(secondRowType).toHaveValue('sales.order')
    expect(document.activeElement).toBe(secondRowType)
  })
})
