/**
 * @jest-environment jsdom
 *
 * #3181 — The Product SEO injection widget must render its status states via
 * shared design-system primitives (StatusBadge / Alert) and DS status tokens,
 * never hardcoded Tailwind status colors (`text-red-*`, `bg-amber-*`,
 * `bg-emerald-*`, ...). These assertions fail against the pre-fix widget that
 * applied raw status color classes and custom pills.
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import ProductSeoWidget from '../widget.client'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) => {
    if (!fallback) return _key
    if (!vars) return fallback
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) =>
      name in vars ? String((vars as Record<string, unknown>)[name]) : `{{${name}}}`,
    )
  },
}))

const FORBIDDEN_STATUS_CLASSES = [
  'text-red-600',
  'bg-red-50',
  'border-red-200',
  'text-amber-600',
  'bg-amber-50',
  'border-amber-200',
  'text-amber-700',
  'text-amber-900',
  'text-green-600',
  'bg-green-50',
  'border-green-200',
  'bg-emerald-50',
  'text-emerald-700',
  'text-emerald-800',
  'border-emerald-200',
]

function renderWidget(data: { title?: string | null; name?: string | null; description?: string | null }) {
  return render(<ProductSeoWidget context={{}} data={data} />)
}

describe('ProductSeoWidget — DS token compliance (#3181)', () => {
  it('renders the needs-attention state without hardcoded status colors', () => {
    const { container } = renderWidget({ title: '', description: '' })
    const html = container.innerHTML
    for (const cls of FORBIDDEN_STATUS_CLASSES) {
      expect(html).not.toContain(cls)
    }
  })

  it('renders the ready/good state without hardcoded status colors', () => {
    const { container } = renderWidget({
      title: 'A perfectly good product title',
      description: 'A sufficiently long product description for good SEO ranking quality.',
    })
    const html = container.innerHTML
    for (const cls of FORBIDDEN_STATUS_CLASSES) {
      expect(html).not.toContain(cls)
    }
  })

  it('drives the score indicators through shared DS status primitives (Badge tokens)', () => {
    const { container } = renderWidget({ title: '', description: '' })
    const badges = container.querySelectorAll('[data-slot="badge"]')
    expect(badges.length).toBeGreaterThan(0)
    expect(container.innerHTML).toContain('bg-status-error-bg')
    expect(container.innerHTML).toContain('bg-status-warning-bg')
  })

  it('preserves the human-readable status text', () => {
    const { getAllByText } = renderWidget({ title: '', description: '' })
    expect(getAllByText('Missing').length).toBeGreaterThan(0)
    expect(getAllByText('Needs attention').length).toBeGreaterThan(0)
  })
})
