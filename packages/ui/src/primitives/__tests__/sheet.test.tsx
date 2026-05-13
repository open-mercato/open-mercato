/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../sheet'

function renderControlled(
  initial = false,
  contentProps: Partial<React.ComponentProps<typeof SheetContent>> = {},
) {
  function Harness() {
    const [open, setOpen] = React.useState(initial)
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button type="button">Open</button>
        </SheetTrigger>
        <SheetContent {...contentProps}>
          <SheetHeader>
            <SheetTitle>Notifications</SheetTitle>
            <SheetDescription>Recent activity from your team.</SheetDescription>
          </SheetHeader>
          <div data-testid="sheet-body">body</div>
          <SheetFooter>
            <SheetClose asChild>
              <button type="button" data-testid="explicit-close">
                Close
              </button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }
  return render(<Harness />)
}

describe('Sheet primitive', () => {
  it('does not render content when closed', () => {
    renderControlled(false)
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sheet-body')).not.toBeInTheDocument()
  })

  it('opens when the trigger is clicked', () => {
    renderControlled(false)
    fireEvent.click(screen.getByText('Open'))
    expect(screen.getByText('Notifications')).toBeInTheDocument()
    expect(screen.getByTestId('sheet-body')).toBeInTheDocument()
  })

  it('renders content immediately when controlled open=true', () => {
    renderControlled(true)
    expect(screen.getByText('Notifications')).toBeInTheDocument()
  })

  it('renders a built-in close X with the default closeLabel', () => {
    renderControlled(true)
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })

  it('respects a custom closeLabel', () => {
    renderControlled(true, { closeLabel: 'Close notifications' })
    expect(screen.getByLabelText('Close notifications')).toBeInTheDocument()
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument()
  })

  it('omits the built-in close when hideClose is set', () => {
    renderControlled(true, { hideClose: true, closeLabel: 'Close notifications' })
    expect(screen.queryByLabelText('Close notifications')).not.toBeInTheDocument()
  })

  it('closes when the built-in close X is clicked', () => {
    renderControlled(true)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument()
  })

  it('closes when an explicit SheetClose child is clicked', () => {
    renderControlled(true)
    fireEvent.click(screen.getByTestId('explicit-close'))
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument()
  })

  it('renders content with dialog role', () => {
    renderControlled(true)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders side="right" by default with slide-in-from-right animation class', () => {
    renderControlled(true)
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('right-0')
    expect(dialog.className).toContain('data-[state=open]:slide-in-from-right')
  })

  it('renders side="left" with corresponding slide direction', () => {
    renderControlled(true, { side: 'left' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('left-0')
    expect(dialog.className).toContain('data-[state=open]:slide-in-from-left')
  })

  it('renders side="top" with corresponding slide direction', () => {
    renderControlled(true, { side: 'top' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('top-0')
    expect(dialog.className).toContain('data-[state=open]:slide-in-from-top')
  })

  it('renders side="bottom" with corresponding slide direction', () => {
    renderControlled(true, { side: 'bottom' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('bottom-0')
    expect(dialog.className).toContain('data-[state=open]:slide-in-from-bottom')
  })

  it('content references --topbar-height CSS variable so it sits below the AppShell sticky topbar', () => {
    renderControlled(true)
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('top-[var(--topbar-height,0px)]')
  })

  it('merges custom className onto the content node', () => {
    renderControlled(true, { className: 'custom-test-class' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('custom-test-class')
  })
})
