/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ConfirmDialog } from '../ConfirmDialog'

// jsdom implements neither showModal() nor the top layer, so this suite reuses
// the polyfill the sibling ConfirmDialog tests already install: showModal/close
// only toggle the `open` attribute. The defect covered here is attribute-level
// (aria-hidden on the portal), so it reproduces faithfully under that polyfill.
// What jsdom cannot represent is the top-layer painting and pointer
// interception — which is the half that was never broken.
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

/**
 * Mirrors `hideOthers()` from the `aria-hidden` package that a modal Radix
 * Dialog uses: every child of the parent node that is not on the kept element's
 * own branch gets both `aria-hidden="true"` and `data-aria-hidden="true"`.
 */
function hideOthers(keep: Element): () => void {
  const marked: Element[] = []
  for (const node of Array.from(document.body.children)) {
    if (node === keep || node.contains(keep)) continue
    node.setAttribute('aria-hidden', 'true')
    node.setAttribute('data-aria-hidden', 'true')
    marked.push(node)
  }
  return () => {
    for (const node of marked) {
      node.removeAttribute('aria-hidden')
      node.removeAttribute('data-aria-hidden')
    }
  }
}

function mountOuterModalContent(): HTMLElement {
  const content = document.createElement('div')
  content.setAttribute('role', 'dialog')
  content.setAttribute('aria-label', 'Version preview')
  document.body.appendChild(content)
  return content
}

function confirmation(open: boolean) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={() => undefined}
      onConfirm={() => undefined}
      title="Restore this version?"
      text="The current content will be replaced."
      confirmText="Restore"
      cancelText="Cancel"
    />
  )
}

function nativeDialog(): HTMLDialogElement {
  const dialog = document.body.querySelector('dialog')
  if (!dialog) {
    throw new Error('[internal] ConfirmDialog did not portal a native <dialog> into document.body')
  }
  return dialog
}

describe('ConfirmDialog — perceivable when stacked over an aria-hidden modal', () => {
  let outerModalContent: HTMLElement | null = null
  let undoHideOthers: (() => void) | null = null

  beforeEach(() => {
    installDialogPolyfill()
  })

  afterEach(() => {
    undoHideOthers?.()
    undoHideOthers = null
    outerModalContent?.remove()
    outerModalContent = null
    document.body.removeAttribute('aria-hidden')
    document.body.removeAttribute('data-aria-hidden')
  })

  it('resolves getByRole("alertdialog") standalone', () => {
    renderWithProviders(confirmation(true))

    const dialog = screen.getByRole('alertdialog', { name: 'Restore this version?' })
    expect(dialog).toBe(nativeDialog())
    expect(dialog.hasAttribute('aria-hidden')).toBe(false)
    expect(dialog.hasAttribute('data-aria-hidden')).toBe(false)
  })

  it('resolves getByRole("alertdialog") when an outer modal marked its portal aria-hidden', () => {
    const view = renderWithProviders(confirmation(false))
    const dialog = nativeDialog()

    outerModalContent = mountOuterModalContent()
    undoHideOthers = hideOthers(outerModalContent)

    expect(dialog.getAttribute('aria-hidden')).toBe('true')
    expect(dialog.getAttribute('data-aria-hidden')).toBe('true')
    expect(screen.queryByRole('alertdialog')).toBeNull()

    view.rerender(confirmation(true))

    expect(screen.getByRole('alertdialog', { name: 'Restore this version?' })).toBe(dialog)
    expect(dialog.hasAttribute('aria-hidden')).toBe(false)
    expect(dialog.hasAttribute('data-aria-hidden')).toBe(false)
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
  })

  it('restores the outer modal aria-hidden values exactly when the confirmation closes', () => {
    const view = renderWithProviders(confirmation(false))
    const dialog = nativeDialog()

    outerModalContent = mountOuterModalContent()
    undoHideOthers = hideOthers(outerModalContent)

    view.rerender(confirmation(true))
    expect(dialog.hasAttribute('aria-hidden')).toBe(false)
    expect(dialog.hasAttribute('data-aria-hidden')).toBe(false)

    view.rerender(confirmation(false))

    expect(dialog.getAttribute('aria-hidden')).toBe('true')
    expect(dialog.getAttribute('data-aria-hidden')).toBe('true')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('re-strips a marking applied by a modal that opens while the confirmation is already open', async () => {
    const view = renderWithProviders(confirmation(true))
    const dialog = nativeDialog()

    outerModalContent = mountOuterModalContent()
    undoHideOthers = hideOthers(outerModalContent)

    await waitFor(() => {
      expect(dialog.hasAttribute('aria-hidden')).toBe(false)
    })
    expect(dialog.hasAttribute('data-aria-hidden')).toBe(false)
    expect(screen.getByRole('alertdialog', { name: 'Restore this version?' })).toBe(dialog)

    view.rerender(confirmation(false))

    expect(dialog.getAttribute('aria-hidden')).toBe('true')
    expect(dialog.getAttribute('data-aria-hidden')).toBe('true')
  })

  it('clears and restores a marking carried by an ancestor rather than the dialog itself', () => {
    const view = renderWithProviders(confirmation(false))

    document.body.setAttribute('aria-hidden', 'true')
    document.body.setAttribute('data-aria-hidden', 'true')

    view.rerender(confirmation(true))

    expect(document.body.hasAttribute('aria-hidden')).toBe(false)
    expect(document.body.hasAttribute('data-aria-hidden')).toBe(false)
    expect(screen.getByRole('alertdialog', { name: 'Restore this version?' })).toBe(nativeDialog())

    view.rerender(confirmation(false))

    expect(document.body.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.getAttribute('data-aria-hidden')).toBe('true')
  })

  it('leaves no mutated attributes behind after unmounting while open', () => {
    const view = renderWithProviders(confirmation(false))

    outerModalContent = mountOuterModalContent()
    undoHideOthers = hideOthers(outerModalContent)
    document.body.setAttribute('aria-hidden', 'true')
    document.body.setAttribute('data-aria-hidden', 'true')

    view.rerender(confirmation(true))
    expect(document.body.hasAttribute('aria-hidden')).toBe(false)

    view.unmount()

    expect(document.body.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.getAttribute('data-aria-hidden')).toBe('true')
    expect(document.body.querySelector('dialog')).toBeNull()
  })
})
