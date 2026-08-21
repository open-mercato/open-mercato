/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Dialog, DialogContent, DialogTitle } from '../../../primitives/dialog'
import { ComboboxInput } from '../ComboboxInput'

function DialogHarness() {
  const [open, setOpen] = React.useState(true)
  const [value, setValue] = React.useState('')
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Move inventory</DialogTitle>
        <ComboboxInput
          value={value}
          onChange={setValue}
          suggestions={[
            { value: 'red', label: 'Red' },
            { value: 'green', label: 'Green' },
          ]}
        />
        <output data-testid="value">{value}</output>
      </DialogContent>
    </Dialog>
  )
}

function openSuggestions() {
  const input = screen.getByRole('combobox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'gre' } })
  return input
}

describe('ComboboxInput inside a Dialog', () => {
  it('renders the suggestion list outside the dialog scroll container', () => {
    render(<DialogHarness />)
    openSuggestions()

    const dialogContent = document.querySelector('[data-dialog-content]')
    const listbox = screen.getByRole('listbox')

    expect(dialogContent).not.toBeNull()
    expect(dialogContent!.contains(listbox)).toBe(false)
  })

  it('keeps wheel events off the dialog scroll lock so a long list stays scrollable', () => {
    render(<DialogHarness />)
    openSuggestions()

    // `react-remove-scroll` (the dialog's scroll lock) listens on the document and
    // cancels wheel events raised outside the dialog content, which would freeze the
    // portaled list.
    const onDocumentWheel = jest.fn()
    document.addEventListener('wheel', onDocumentWheel)
    try {
      const list = screen.getByRole('listbox')
      fireEvent.wheel(list, { deltaY: 120 })
      expect(onDocumentWheel).not.toHaveBeenCalled()

      // control: a wheel anywhere else still reaches the document listener
      fireEvent.wheel(screen.getByRole('combobox'), { deltaY: 120 })
      expect(onDocumentWheel).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('wheel', onDocumentWheel)
    }
  })

  it('keeps the dialog open when an option is picked', async () => {
    render(<DialogHarness />)
    openSuggestions()

    // Radix registers its outside-interaction listener on a macrotask, so let it
    // land before simulating the pointer sequence a real click produces.
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const option = screen.getByRole('option', { name: /green/i })
    fireEvent.pointerDown(option, { bubbles: true })
    fireEvent.mouseDown(option, { bubbles: true })
    fireEvent.click(option)

    expect(screen.getByTestId('value')).toHaveTextContent('green')
    expect(document.querySelector('[data-dialog-content]')).not.toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
