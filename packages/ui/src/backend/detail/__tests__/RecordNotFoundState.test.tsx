/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { RecordNotFoundState } from '../RecordNotFoundState'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('next/link', () => {
  const React = require('react')
  return React.forwardRef(
    ({ children, href, ...rest }: any, ref: React.ForwardedRef<HTMLAnchorElement>) => (
      <a href={typeof href === 'string' ? href : href?.toString?.()} ref={ref} {...rest}>
        {children}
      </a>
    ),
  )
})

describe('RecordNotFoundState', () => {
  it('renders the label as the empty-state title', () => {
    render(<RecordNotFoundState label="Company not found." />)
    expect(screen.getByText('Company not found.')).toBeInTheDocument()
  })

  it('renders a back link (role=link) with the given href and default label', () => {
    render(<RecordNotFoundState label="Company not found." backHref="/backend/customers/companies" />)
    const backLink = screen.getByRole('link', { name: /back to list/i })
    expect(backLink).toBeInTheDocument()
    expect(backLink).toHaveAttribute('href', '/backend/customers/companies')
  })

  it('uses a custom backLabel when provided', () => {
    render(
      <RecordNotFoundState
        label="Company not found."
        backHref="/backend/customers/companies"
        backLabel="Back to companies"
      />,
    )
    expect(screen.getByRole('link', { name: /back to companies/i })).toBeInTheDocument()
  })

  it('renders a custom action instead of the default back link', () => {
    render(
      <RecordNotFoundState
        label="Company not found."
        backHref="/ignored"
        action={<button type="button">Retry</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders no action when neither backHref nor action is provided', () => {
    render(<RecordNotFoundState label="Company not found." />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is a neutral empty state, not a destructive alert (regression guard for #2127)', () => {
    render(<RecordNotFoundState label="Company not found." backHref="/backend/customers/companies" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders a custom icon when provided', () => {
    render(
      <RecordNotFoundState
        label="Company not found."
        icon={<svg data-testid="custom-icon" />}
      />,
    )
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })
})
