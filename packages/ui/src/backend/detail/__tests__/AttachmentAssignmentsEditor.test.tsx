/**
 * @jest-environment jsdom
 *
 * Regression coverage for #4338: the assignment row key must stay stable while
 * the user types — a value-derived key remounts the row on every keystroke,
 * which throws the input out of focus after each character.
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('@open-mercato/core/generated-shims/entities.ids.generated', () => ({
  E: new Proxy({}, {
    get: (_target, moduleId) => new Proxy({}, {
      get: (_entity, entityId) => `${String(moduleId)}:${String(entityId)}`,
    }),
  }),
}))

import { AttachmentAssignmentsEditor, type AssignmentDraft } from '../AttachmentMetadataDialog'

const labels = {
  title: 'Assignments',
  description: 'Link this attachment to records',
  type: 'Type',
  id: 'Record ID',
  href: 'Link',
  label: 'Label',
  add: 'Add assignment',
  remove: 'Remove assignment',
}

function EditorHarness({ initial }: { initial: AssignmentDraft[] }) {
  const [value, setValue] = React.useState<AssignmentDraft[]>(initial)
  return <AttachmentAssignmentsEditor value={value} onChange={setValue} labels={labels} />
}

describe('AttachmentAssignmentsEditor (metadata dialog)', () => {
  it('keeps the Type input mounted and focused while typing multiple characters', () => {
    render(<EditorHarness initial={[{ type: '', id: '', href: '', label: '' }]} />)

    const typeInput = screen.getByPlaceholderText('catalog.product') as HTMLInputElement
    typeInput.focus()

    let typed = ''
    for (const char of 'catalog.product') {
      typed += char
      fireEvent.change(typeInput, { target: { value: typed } })
      expect(screen.getByPlaceholderText('catalog.product')).toBe(typeInput)
      expect(document.activeElement).toBe(typeInput)
    }

    expect(typeInput.value).toBe('catalog.product')
  })

  it('keeps the Record ID input mounted and focused while typing', () => {
    render(<EditorHarness initial={[{ type: 'catalog.product', id: '', href: '', label: '' }]} />)

    const idInput = screen.getByPlaceholderText('Record ID') as HTMLInputElement
    idInput.focus()

    fireEvent.change(idInput, { target: { value: 'a' } })
    fireEvent.change(idInput, { target: { value: 'ab' } })

    expect(screen.getByPlaceholderText('Record ID')).toBe(idInput)
    expect(document.activeElement).toBe(idInput)
    expect(idInput.value).toBe('ab')
  })

  it('still adds and removes assignment rows', () => {
    render(<EditorHarness initial={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add assignment' }))
    expect(screen.getByPlaceholderText('catalog.product')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove assignment' }))
    expect(screen.queryByPlaceholderText('catalog.product')).toBeNull()
  })
})
