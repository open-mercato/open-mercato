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

  // `react-remove-scroll` (the dialog's scroll lock) listens on the document for
  // both `wheel` and `touchmove` and cancels either one when it is raised outside
  // the dialog content, which would freeze the portaled list.
  it.each(['wheel', 'touchMove'] as const)('keeps %s events off the dialog scroll lock so a long list stays scrollable', (eventName) => {
    render(<DialogHarness />)
    openSuggestions()

    const domEventName = eventName === 'wheel' ? 'wheel' : 'touchmove'
    // The scroll lock reads coordinates off the event, so give it usable ones.
    const init = eventName === 'wheel'
      ? { deltaY: 120 }
      : { touches: [{ clientX: 0, clientY: 0 }], changedTouches: [{ clientX: 0, clientY: 0 }] }
    const onDocumentEvent = jest.fn()
    document.addEventListener(domEventName, onDocumentEvent)
    try {
      fireEvent[eventName](screen.getByRole('listbox'), init)
      expect(onDocumentEvent).not.toHaveBeenCalled()

      // control: the same event anywhere else still reaches the document listener
      fireEvent[eventName](screen.getByRole('combobox'), init)
      expect(onDocumentEvent).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener(domEventName, onDocumentEvent)
    }
  })

  it('does not add a second dialog node while the suggestions are open', () => {
    render(<DialogHarness />)
    openSuggestions()

    // Radix hardcodes role="dialog" on popover content; ~35 test files resolve
    // `getByRole('dialog')`, which is strict about multiple matches.
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(screen.getByRole('dialog')).toHaveAttribute('data-dialog-content')
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

  it('still dismisses the dialog on a genuinely outside pointer down', async () => {
    render(<DialogHarness />)
    openSuggestions()

    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // Control for the case above: the suppression must be scoped to the portaled
    // list, not a blanket block on the dialog's outside-interaction handling.
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      await act(async () => {
        fireEvent.pointerDown(outside, { bubbles: true })
        fireEvent.mouseDown(outside, { bubbles: true })
        fireEvent.click(outside)
      })
      expect(document.querySelector('[data-dialog-content]')).toBeNull()
    } finally {
      outside.remove()
    }
  })
})
