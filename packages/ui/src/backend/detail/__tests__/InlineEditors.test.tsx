/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  InlineMultilineEditor,
  InlineSelectEditor,
  InlineTextEditor,
  resolveSafeInlineUrlHref,
} from '../InlineEditors'

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
    // Pencil/edit toggle is the trailing icon-only button on the InlineTextEditor,
    // reachable by its accessible name.
    const editToggle = screen.getByRole('button', { name: 'Edit' })
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

describe('inline editor trigger accessibility and touch reachability (#5947)', () => {
  const editors = [
    {
      name: 'InlineTextEditor',
      render: () =>
        renderWithProviders(
          <InlineTextEditor label="Email" value="a@example.com" emptyLabel="No email" onSave={jest.fn()} />,
          { dict: {} },
        ),
    },
    {
      name: 'InlineMultilineEditor',
      render: () =>
        renderWithProviders(
          <InlineMultilineEditor label="Notes" value="Hello" emptyLabel="No notes" onSave={jest.fn()} />,
          { dict: {} },
        ),
    },
    {
      name: 'InlineSelectEditor',
      render: () =>
        renderWithProviders(
          <InlineSelectEditor
            label="Status"
            value="active"
            emptyLabel="No status"
            options={[{ value: 'active', label: 'Active' }]}
            onSave={jest.fn()}
          />,
          { dict: {} },
        ),
    },
  ]

  it.each(editors)('$name exposes an accessible name on its edit trigger', ({ render }) => {
    render()

    const trigger = screen.getByRole('button', { name: 'Edit' })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-label', 'Edit')
  })

  it.each(editors)('$name relabels the trigger to Cancel while editing', ({ render }) => {
    render()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    })

    // The open form renders its own textual Cancel button with the same action, so match
    // the icon-only toggle by the aria-label this fix adds rather than by name alone.
    const labelledTriggers = screen
      .getAllByRole('button', { name: 'Cancel' })
      .filter((button) => button.getAttribute('aria-label') === 'Cancel')
    expect(labelledTriggers).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it.each(editors)('$name reveals the trigger on coarse-pointer devices that never hover', ({ render }) => {
    render()

    const trigger = screen.getByRole('button', { name: 'Edit' })
    // Without this variant the trigger stays at opacity-0 forever on touch, since no
    // hover event exists to satisfy group-hover: and it is not focused before the tap.
    expect(trigger.className).toContain('[@media(hover:none)]:opacity-100')
    expect(trigger.className).toContain('group-hover:opacity-100')
  })

  it('keeps a caller-supplied triggerClassName able to override the default reveal', () => {
    renderWithProviders(
      <InlineTextEditor
        label="Email"
        value="a@example.com"
        emptyLabel="No email"
        triggerClassName="opacity-100"
        onSave={jest.fn()}
      />,
      { dict: {} },
    )

    // Substring matching would hold on the default constant alone, which already carries
    // group-hover:opacity-100 — tokenise the class list so the override is really pinned.
    const classNames = screen.getByRole('button', { name: 'Edit' }).className.split(/\s+/)
    expect(classNames).toContain('opacity-100')
    expect(classNames).not.toContain('opacity-0')
    expect(classNames).toContain('[@media(hover:none)]:opacity-100')
  })

  it('keeps the coarse-pointer reveal when a caller supplies its own hover-only reveal', () => {
    // The literal string CompanyHighlights, PersonHighlights and the sales document page
    // pass. For those fields the touch fix only reaches the browser because tailwind-merge
    // does not treat their unprefixed opacity-0 as conflicting with the arbitrary variant.
    renderWithProviders(
      <InlineTextEditor
        label="Email"
        value="a@example.com"
        emptyLabel="No email"
        triggerClassName="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 mt-1"
        onSave={jest.fn()}
      />,
      { dict: {} },
    )

    const classNames = screen.getByRole('button', { name: 'Edit' }).className.split(/\s+/)
    // mt-1 comes only from the caller, so it proves the override really reached the merge
    // rather than the assertions below passing on the default constant alone.
    expect(classNames).toContain('mt-1')
    expect(classNames).toContain('[@media(hover:none)]:opacity-100')
    expect(classNames).toContain('group-hover:opacity-100')
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
