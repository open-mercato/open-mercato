/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen } from '@testing-library/react'
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
