/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { InlineTextEditor, resolveSafeInlineUrlHref } from '../InlineEditors'

describe('InlineTextEditor URL display', () => {
  it('renders allowed URL protocols as links', () => {
    renderWithProviders(
      <InlineTextEditor
        label="Website"
        value="https://example.com"
        emptyLabel="No website"
        type="url"
        onSave={jest.fn()}
      />,
      { dict: {} },
    )

    expect(screen.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('href', 'https://example.com')
  })

  it('renders javascript URLs as text instead of links', () => {
    const unsafeValue = "javascript:fetch('/api/auth/logout',{method:'POST'})"

    renderWithProviders(
      <InlineTextEditor
        label="Website"
        value={unsafeValue}
        emptyLabel="No website"
        type="url"
        onSave={jest.fn()}
      />,
      { dict: {} },
    )

    expect(screen.getByText(unsafeValue)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: unsafeValue })).not.toBeInTheDocument()
  })
})

describe('InlineTextEditor date types — DS unification (no native date input)', () => {
  function activateEditor() {
    // Pencil/edit toggle is the trailing icon-only button on the InlineTextEditor.
    // It has no accessible text label, so we grab the last data-slot="button".
    const buttons = document.querySelectorAll('[data-slot="button"]')
    expect(buttons.length).toBeGreaterThan(0)
    const editToggle = buttons[buttons.length - 1] as HTMLButtonElement
    act(() => {
      fireEvent.click(editToggle)
    })
  }

  it('inputType="date" renders the DatePicker primitive trigger when editing', () => {
    renderWithProviders(
      <InlineTextEditor
        label="Date"
        value="2026-05-09"
        emptyLabel="No date"
        type="date"
        inputType="date"
        onSave={jest.fn()}
      />,
      { dict: {} },
    )
    activateEditor()
    expect(document.querySelector('[data-slot="date-picker-trigger"]')).toBeInTheDocument()
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })

  it('inputType="datetime-local" renders the DatePicker primitive (with withTime) when editing', () => {
    renderWithProviders(
      <InlineTextEditor
        label="When"
        value="2026-05-09T10:30"
        emptyLabel="No value"
        type="text"
        inputType="datetime-local"
        onSave={jest.fn()}
      />,
      { dict: {} },
    )
    activateEditor()
    expect(document.querySelector('[data-slot="date-picker-trigger"]')).toBeInTheDocument()
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull()
  })

  it('non-date inputType still renders a raw input (regression: text editing path unchanged)', () => {
    renderWithProviders(
      <InlineTextEditor
        label="Title"
        value="Hello"
        emptyLabel="No title"
        type="text"
        onSave={jest.fn()}
      />,
      { dict: {} },
    )
    activateEditor()
    expect(document.querySelector('input[type="text"]')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="date-picker-trigger"]')).toBeNull()
  })

  it('date type hides the form Save/Cancel buttons (DatePicker provides Apply/Cancel in popover)', () => {
    renderWithProviders(
      <InlineTextEditor
        label="Date"
        value="2026-05-09"
        emptyLabel="No date"
        type="date"
        inputType="date"
        onSave={jest.fn()}
      />,
      { dict: {} },
    )
    activateEditor()
    // Form Save (submit) button should not be rendered for date types
    expect(screen.queryByRole('button', { name: /Save|Zapisz|⌘/ })).not.toBeInTheDocument()
  })
})

describe('resolveSafeInlineUrlHref', () => {
  it.each(['http://example.com', 'https://example.com', 'mailto:user@example.com', 'tel:+48123456789'])(
    'allows %s',
    (value) => {
      expect(resolveSafeInlineUrlHref(value)).toBe(value)
    },
  )

  it.each(['javascript:alert(1)', 'data:text/html,<svg>', 'ftp://example.com', '/relative/path', 'example.com'])(
    'rejects %s',
    (value) => {
      expect(resolveSafeInlineUrlHref(value)).toBeNull()
    },
  )
})
