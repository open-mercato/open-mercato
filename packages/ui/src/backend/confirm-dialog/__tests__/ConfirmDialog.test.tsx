/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ConfirmDialog } from '../ConfirmDialog'

function installDialogPolyfill() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open')
    },
  })
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    installDialogPolyfill()
  })

  it('restores pointer events for nested modal confirmations', () => {
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        onConfirm={() => undefined}
        title="Discard unsaved changes?"
        text="Changes will be discarded."
        confirmText="Discard"
        cancelText="Cancel"
      />,
    )

    expect(screen.getByRole('alertdialog').className).toEqual(expect.stringContaining('pointer-events-auto'))
  })

  it('portals the native dialog out of hidden ancestors', () => {
    const { container } = renderWithProviders(
      <div hidden>
        <ConfirmDialog
          open
          onOpenChange={() => undefined}
          onConfirm={() => undefined}
          title="Discard unsaved changes?"
          confirmText="Discard"
          cancelText="Cancel"
        />
      </div>,
    )

    const dialog = screen.getByRole('alertdialog')
    expect(container.contains(dialog)).toBe(false)
    expect(dialog.parentElement).toBe(document.body)
  })

  it('renders the destructive confirmation as the solid variant', () => {
    renderWithProviders(
      <ConfirmDialog
        open
        variant="destructive"
        onOpenChange={() => undefined}
        onConfirm={() => undefined}
        title="Delete customer?"
        confirmText="Delete"
        cancelText="Cancel"
      />,
    )

    const classNames = screen.getByRole('button', { name: 'Delete' }).className.split(/\s+/)
    expect(classNames).toContain('bg-destructive')
    expect(classNames).toContain('text-white')
  })

  it('keeps the default confirmation on the primary variant', () => {
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        onConfirm={() => undefined}
        title="Publish article?"
        confirmText="Publish"
        cancelText="Cancel"
      />,
    )

    const classNames = screen.getByRole('button', { name: 'Publish' }).className.split(/\s+/)
    expect(classNames).toContain('bg-primary')
    expect(classNames).not.toContain('bg-destructive')
  })

  it('closes only the confirmation that owns an Escape event', () => {
    const firstOpenChange = jest.fn()
    const secondOpenChange = jest.fn()

    renderWithProviders(
      <>
        <ConfirmDialog
          open
          onOpenChange={firstOpenChange}
          onConfirm={() => undefined}
          title="First confirmation"
          confirmText="Confirm first"
          cancelText="Cancel first"
        />
        <ConfirmDialog
          open
          onOpenChange={secondOpenChange}
          onConfirm={() => undefined}
          title="Second confirmation"
          confirmText="Confirm second"
          cancelText="Cancel second"
        />
      </>,
    )

    const secondDialog = screen.getByRole('alertdialog', { name: 'Second confirmation' })
    fireEvent.keyDown(within(secondDialog).getByRole('button', { name: 'Cancel second' }), { key: 'Escape' })

    expect(firstOpenChange).not.toHaveBeenCalled()
    expect(secondOpenChange).toHaveBeenCalledWith(false)
  })
})
