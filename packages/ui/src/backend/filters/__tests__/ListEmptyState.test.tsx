/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ListEmptyState } from '../ListEmptyState'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string, params?: Record<string, unknown>) => {
    let out = fallback ?? _key
    if (params) for (const k of Object.keys(params)) out = out.replace(`{${k}}`, String(params[k]))
    return out
  },
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

describe('ListEmptyState', () => {
  it('builds the title from entityName', () => {
    render(<ListEmptyState entityName="companies" />)
    expect(screen.getByText('No companies yet')).toBeInTheDocument()
  })

  it('renders a create link (role=link) with href and label when createHref is set', () => {
    render(<ListEmptyState entityName="companies" createHref="/backend/customers/companies/create" createLabel="New company" />)
    const link = screen.getByRole('link', { name: /new company/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/backend/customers/companies/create')
  })

  it('renders a create button when onCreate is provided', () => {
    const onCreate = jest.fn()
    render(<ListEmptyState entityName="users" onCreate={onCreate} createLabel="Add user" />)
    expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders no action when neither createHref nor onCreate is provided', () => {
    render(<ListEmptyState entityName="records" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
