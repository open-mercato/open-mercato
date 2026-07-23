/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AttachmentAssignmentsEditor, type AssignmentDraft } from '../AttachmentMetadataDialog'

const labels = {
  title: 'Assignments',
  description: 'Link this attachment to records.',
  type: 'Type',
  id: 'Record ID',
  href: 'Link',
  label: 'Label',
  add: 'Add assignment',
  remove: 'Remove assignment',
}

function Harness() {
  const [value, setValue] = React.useState<AssignmentDraft[]>([{ type: '', id: '', href: '', label: '' }])
  return <AttachmentAssignmentsEditor value={value} onChange={setValue} labels={labels} />
}

function typeInto(input: HTMLInputElement, text: string) {
  for (let index = 1; index <= text.length; index += 1) {
    fireEvent.change(input, { target: { value: text.slice(0, index) } })
  }
}

describe('AttachmentAssignmentsEditor — row identity while typing (#4338)', () => {
  it('keeps the Type input mounted and focused across keystrokes', () => {
    render(<Harness />)

    const input = screen.getByPlaceholderText('catalog.product') as HTMLInputElement
    act(() => {
      input.focus()
    })

    typeInto(input, 'catalog.product')

    expect(screen.getByPlaceholderText('catalog.product')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('catalog.product')
  })

  it('keeps the Record ID input mounted and focused across keystrokes', () => {
    render(<Harness />)

    const input = screen.getByPlaceholderText('Record ID') as HTMLInputElement
    act(() => {
      input.focus()
    })

    typeInto(input, 'prod-123')

    expect(screen.getByPlaceholderText('Record ID')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('prod-123')
  })
})
