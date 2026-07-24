/**
 * @jest-environment jsdom
 *
 * Regression coverage for #4338: the upload dialog's assignment row key must
 * stay stable while the user types — a value-derived key remounts the row on
 * every keystroke, dropping focus after each character.
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { AttachmentAssignmentsEditor } from '../AttachmentLibrary'
import type { AssignmentDraft } from '@open-mercato/ui/backend/detail'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

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

describe('AttachmentAssignmentsEditor (upload dialog)', () => {
  it('keeps the Type input mounted and focused while typing multiple characters', () => {
    render(<EditorHarness initial={[{ type: '', id: '', href: '', label: '' }]} />)

    const typeInput = screen.getAllByRole('textbox')[0] as HTMLInputElement
    typeInput.focus()

    let typed = ''
    for (const char of 'catalog.product') {
      typed += char
      fireEvent.change(typeInput, { target: { value: typed } })
      expect(screen.getAllByRole('textbox')[0]).toBe(typeInput)
      expect(document.activeElement).toBe(typeInput)
    }

    expect(typeInput.value).toBe('catalog.product')
  })

  it('keeps the Record ID input mounted and focused while typing', () => {
    render(<EditorHarness initial={[{ type: 'catalog.product', id: '', href: '', label: '' }]} />)

    const idInput = screen.getAllByRole('textbox')[1] as HTMLInputElement
    idInput.focus()

    fireEvent.change(idInput, { target: { value: 'a' } })
    fireEvent.change(idInput, { target: { value: 'ab' } })

    expect(screen.getAllByRole('textbox')[1]).toBe(idInput)
    expect(document.activeElement).toBe(idInput)
    expect(idInput.value).toBe('ab')
  })
})
