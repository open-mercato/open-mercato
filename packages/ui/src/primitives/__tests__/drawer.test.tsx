/** @jest-environment jsdom */

import * as React from 'react'
import { render, fireEvent, screen } from '@testing-library/react'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
  DrawerClose,
} from '../drawer'

function ExampleDrawer({
  side,
  hideCloseButton,
  defaultOpen = true,
}: {
  side?: 'right' | 'left' | 'top' | 'bottom'
  hideCloseButton?: boolean
  defaultOpen?: boolean
}) {
  return (
    <Drawer defaultOpen={defaultOpen}>
      <DrawerTrigger>Open</DrawerTrigger>
      <DrawerContent side={side} hideCloseButton={hideCloseButton}>
        <DrawerHeader>
          <DrawerTitle>Edit person</DrawerTitle>
          <DrawerDescription>Update the person's contact info.</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <p>Body content</p>
        </DrawerBody>
        <DrawerFooter>
          <DrawerClose>Cancel</DrawerClose>
          <button>Save</button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

describe('Drawer', () => {
  it('renders trigger + content slots inside a Radix Dialog', () => {
    const { container } = render(<ExampleDrawer />)
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-overlay"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-header"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-body"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-footer"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-title"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-description"]')).not.toBeNull()
  })

  it('opens on trigger click when controlled-default is closed', () => {
    function ControlledDrawer() {
      const [open, setOpen] = React.useState(false)
      return (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger>Open</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Test</DrawerTitle>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>
      )
    }
    const { container, getByText } = render(<ControlledDrawer />)
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull()
    fireEvent.click(getByText('Open'))
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull()
  })

  it('marks the content with data-side="right" by default', () => {
    const { container } = render(<ExampleDrawer />)
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.getAttribute('data-side')).toBe('right')
  })

  it('applies right-side positioning classes by default', () => {
    const { container } = render(<ExampleDrawer />)
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.className).toContain('right-0')
    expect(content.className).toContain('inset-y-0')
    expect(content.className).toContain('max-w-md')
    expect(content.className).toContain('border-l')
  })

  it('applies left-side classes when side="left"', () => {
    const { container } = render(<ExampleDrawer side="left" />)
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.className).toContain('left-0')
    expect(content.className).toContain('inset-y-0')
    expect(content.className).toContain('border-r')
    expect(content.getAttribute('data-side')).toBe('left')
  })

  it('applies top-side classes when side="top"', () => {
    const { container } = render(<ExampleDrawer side="top" />)
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.className).toContain('top-0')
    expect(content.className).toContain('inset-x-0')
    expect(content.className).toContain('border-b')
    expect(content.className).toContain('max-h-[80vh]')
  })

  it('applies bottom-side classes when side="bottom"', () => {
    const { container } = render(<ExampleDrawer side="bottom" />)
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.className).toContain('bottom-0')
    expect(content.className).toContain('inset-x-0')
    expect(content.className).toContain('border-t')
    expect(content.className).toContain('max-h-[80vh]')
  })

  it('renders the auto close button by default', () => {
    const { container } = render(<ExampleDrawer />)
    expect(document.querySelector('[data-slot="drawer-close-button"]')).not.toBeNull()
  })

  it('hides the auto close button when hideCloseButton=true', () => {
    const { container } = render(<ExampleDrawer hideCloseButton />)
    expect(document.querySelector('[data-slot="drawer-close-button"]')).toBeNull()
  })

  it('renders role="dialog" with aria-labelledby/describedby wiring from Title + Description', () => {
    render(<ExampleDrawer />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    const labelledBy = dialog.getAttribute('aria-labelledby')
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(labelledBy).toBeTruthy()
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Edit person')
  })

  it('closes when DrawerClose child is clicked', () => {
    const { container, getByText } = render(<ExampleDrawer />)
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull()
    fireEvent.click(getByText('Cancel'))
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull()
  })

  it('forwards className to drawer-content without dropping side classes', () => {
    const { container } = render(
      <Drawer defaultOpen>
        <DrawerTrigger>Open</DrawerTrigger>
        <DrawerContent className="custom-class">
          <DrawerHeader>
            <DrawerTitle>Title</DrawerTitle>
          </DrawerHeader>
        </DrawerContent>
      </Drawer>,
    )
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.className).toContain('custom-class')
    expect(content.className).toContain('right-0')
  })
})
