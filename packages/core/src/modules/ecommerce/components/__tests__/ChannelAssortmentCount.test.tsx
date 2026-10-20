/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ChannelAssortmentCountPanel } from '../ChannelAssortmentCount'
import type { AssortmentCountResult } from '../storeChannels'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, string>) => {
    const text = fallback ?? key
    return params ? text.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? '') : text
  },
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

function result(overrides: Partial<AssortmentCountResult> = {}): AssortmentCountResult {
  return {
    count: 1234,
    scopeSource: 'saved',
    requireAuthentication: false,
    reducedByAuthentication: false,
    countWithoutAuthentication: 1234,
    unindexedCount: 0,
    ...overrides,
  }
}

describe('ChannelAssortmentCountPanel', () => {
  it('asks to save the binding first while idle', () => {
    render(<ChannelAssortmentCountPanel state={{ status: 'idle' }} unrestricted={false} />)
    expect(screen.getByText(/Save the binding to see how many products it shows/)).toBeInTheDocument()
    expect(screen.queryByTestId('channel-assortment-count')).not.toBeInTheDocument()
  })

  it('shows an unavailable message on error', () => {
    render(<ChannelAssortmentCountPanel state={{ status: 'error' }} unrestricted={false} />)
    expect(screen.getByText('The product count is unavailable right now.')).toBeInTheDocument()
  })

  it('shows a loading indicator while counting', () => {
    render(<ChannelAssortmentCountPanel state={{ status: 'loading' }} unrestricted={false} />)
    expect(screen.getByText('Counting products…')).toBeInTheDocument()
  })

  it('renders the restricted and unrestricted counts with locale formatting', () => {
    const { rerender } = render(
      <ChannelAssortmentCountPanel state={{ status: 'ready', result: result(), refreshing: false }} unrestricted={false} />,
    )
    expect(screen.getByText('Products matching this scope: 1,234.')).toBeInTheDocument()
    rerender(<ChannelAssortmentCountPanel state={{ status: 'ready', result: result(), refreshing: false }} unrestricted />)
    expect(screen.getByText("All products in this channel's catalog: 1,234.")).toBeInTheDocument()
  })

  it('explains a count reduced to zero by the sign-in requirement', () => {
    render(
      <ChannelAssortmentCountPanel
        state={{
          status: 'ready',
          result: result({ count: 0, requireAuthentication: true, reducedByAuthentication: true, countWithoutAuthentication: 42 }),
          refreshing: false,
        }}
        unrestricted={false}
      />,
    )
    expect(
      screen.getByText('0 products for anonymous visitors because sign-in is required; 42 without that requirement.'),
    ).toBeInTheDocument()
  })

  it('explains an empty scope behind the sign-in requirement', () => {
    render(
      <ChannelAssortmentCountPanel
        state={{
          status: 'ready',
          result: result({ count: 0, requireAuthentication: true, reducedByAuthentication: false, countWithoutAuthentication: 0 }),
          refreshing: false,
        }}
        unrestricted={false}
      />,
    )
    expect(screen.getByText(/sign-in is required, and the scope matches no products/)).toBeInTheDocument()
  })

  it('mentions products still waiting for the visibility index', () => {
    render(
      <ChannelAssortmentCountPanel
        state={{ status: 'ready', result: result({ unindexedCount: 3 }), refreshing: false }}
        unrestricted={false}
      />,
    )
    expect(screen.getByText(/3 active products are not indexed for visibility yet/)).toBeInTheDocument()
  })
})
