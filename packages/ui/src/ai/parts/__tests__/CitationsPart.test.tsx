/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CitationsPart } from '../CitationsPart'
import { registerCitationResolver, resetCitationResolversForTests } from '../../citations/registry'
import { defaultAiUiPartRegistry } from '../../ui-part-registry'

const dict = {
  'ui.ai.citations.title': 'Sources',
  'ui.ai.citations.showMore': 'Show more',
  'ui.ai.citations.showLess': 'Show less',
  'ui.ai.citations.openSource': 'Open source: {title} (opens in a new tab)',
}

function renderPart(payload: unknown) {
  return renderWithProviders(<CitationsPart componentId="ai_assistant:citations" payload={payload} />, { dict })
}

afterEach(() => {
  resetCitationResolversForTests()
})

describe('CitationsPart', () => {
  it('is registered in the default UI-part registry', () => {
    expect(defaultAiUiPartRegistry.resolve('ai_assistant:citations')).toBe(CitationsPart)
  })

  it('renders a numbered list with the default title and label/ref fallbacks', () => {
    renderPart({
      citations: [
        { kind: 'unknown', ref: 'doc-1', label: 'Doc one' },
        { kind: 'unknown', ref: 'doc-2', locator: 'p. 4' },
      ],
    })
    const region = screen.getByRole('region', { name: 'Sources' })
    const items = within(region).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('[1]')
    expect(items[0]).toHaveTextContent('Doc one')
    expect(items[1]).toHaveTextContent('doc-2')
    expect(items[1]).toHaveTextContent('p. 4')
  })

  it('uses the payload title when provided', () => {
    renderPart({ citations: [{ kind: 'kb', ref: 'a' }], title: 'Policies' })
    expect(screen.getByRole('region', { name: 'Policies' })).toBeInTheDocument()
  })

  it('renders nothing for an empty or invalid payload', () => {
    const { container } = renderPart({ citations: [{ kind: 'kb' }] })
    expect(container).toBeEmptyDOMElement()
  })

  it('opens external links in a new tab with noopener noreferrer and an accessible label', () => {
    renderPart({ citations: [{ kind: 'web', ref: 'r', label: 'Example', href: 'https://example.com/docs' }] })
    const link = screen.getByRole('link', { name: 'Open source: Example (opens in a new tab)' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders same-origin links in-app without target', () => {
    renderPart({ citations: [{ kind: 'record', ref: 'r', label: 'Person', href: '/backend/customers/people/1' }] })
    const link = screen.getByRole('link', { name: 'Person' })
    expect(link).toHaveAttribute('href', '/backend/customers/people/1')
    expect(link).not.toHaveAttribute('target')
  })

  it('does not render a link for an unsafe href', () => {
    renderPart({ citations: [{ kind: 'web', ref: 'r', label: 'Bad', href: 'javascript:alert(1)' }] })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Bad')).toBeInTheDocument()
  })

  it('applies a registered resolver and falls back when it throws', async () => {
    registerCitationResolver('kb', async (citation) => ({ title: `KB ${citation.ref}`, href: `/kb/${citation.ref}` }))
    registerCitationResolver('broken', () => {
      throw new Error('boom')
    })
    renderPart({
      citations: [
        { kind: 'kb', ref: 'refund' },
        { kind: 'broken', ref: 'b', label: 'Broken label' },
      ],
    })
    await waitFor(() => expect(screen.getByRole('link', { name: 'KB refund' })).toHaveAttribute('href', '/kb/refund'))
    expect(screen.getByText('Broken label')).toBeInTheDocument()
  })

  it('clamps the quote and toggles it with an expand control', () => {
    renderPart({ citations: [{ kind: 'kb', ref: 'r', quote: 'Refunds are issued within 14 days.' }] })
    const quote = screen.getByText('Refunds are issued within 14 days.')
    expect(quote.tagName).toBe('BLOCKQUOTE')
    expect(quote).toHaveClass('line-clamp-3')
    const toggle = screen.getByRole('button', { name: 'Show more' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(quote).not.toHaveClass('line-clamp-3')
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  })
})
