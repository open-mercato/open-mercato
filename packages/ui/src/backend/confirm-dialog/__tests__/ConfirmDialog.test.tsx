/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
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
})
