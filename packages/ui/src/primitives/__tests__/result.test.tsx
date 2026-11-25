/** @jest-environment jsdom */

import * as React from 'react'
import { render as baseRender, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

import { Result, resultLook } from '../result'

function render(ui: React.ReactElement) {
  return baseRender(ui, { wrapper: ({ children }) => <I18nProvider locale="en" dict={{}}>{children}</I18nProvider> })
}

describe('Result', () => {
  it('renders a success result with title, subtitle and actions', () => {
    render(<Result status="success" title="Order placed" subtitle="SO-1042 is waiting for payment." actions={<button type="button">View order</button>} />)
    const region = screen.getByRole('status', { name: 'Order placed' })
    expect(region).toHaveAttribute('data-status', 'success')
    expect(screen.getByRole('heading', { level: 2, name: 'Order placed' })).toBeInTheDocument()
    expect(screen.getByText('SO-1042 is waiting for payment.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View order' })).toBeInTheDocument()
  })

  it('announces errors as alerts and uses status tokens', () => {
    const { container } = render(<Result status="error" title="Payment failed" />)
    expect(screen.getByRole('alert', { name: 'Payment failed' })).toBeInTheDocument()
    const face = container.querySelector('[data-slot="result-face"]')
    expect(face).toHaveAttribute('data-eyes', 'cross')
    expect(face).toHaveAttribute('data-mouth', 'frown')
    expect(container.querySelector('[data-slot="result-icon"]')?.className).toContain('bg-muted')
    expect(resultLook('500').live).toBe('alert')
    expect(resultLook('404').live).toBe('status')
  })

  it('falls back to translated copy for page errors', () => {
    render(<Result status="404" />)
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByText('The page was moved or deleted, or the link is incorrect.')).toBeInTheDocument()
  })

  it('keeps a custom title without adding the default subtitle', () => {
    render(<Result status="403" title="Billing is restricted" />)
    expect(screen.getByRole('heading', { name: 'Billing is restricted' })).toBeInTheDocument()
    expect(screen.queryByText(/Ask an administrator/)).toBeNull()
  })

  it('renders extra content and can move focus to the title', () => {
    render(
      <Result status="error" title="Submission failed" focusTitle>
        <ul>
          <li>Tax ID is missing</li>
        </ul>
      </Result>,
    )
    expect(screen.getByText('Tax ID is missing').closest('[data-slot="result-content"]')).not.toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Submission failed' }))
  })

  it('accepts a custom icon and a compact size', () => {
    const { container } = render(<Result title="Saved" size="compact" icon={<svg data-testid="custom" />} />)
    expect(screen.getByTestId('custom')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="result-icon"]')?.className).toContain('size-14')
    expect(container.querySelector('[data-slot="result"]')?.className).toContain('px-panel')
    expect(container.querySelector('[data-slot="result-face"]')).toBeNull()
  })
})
