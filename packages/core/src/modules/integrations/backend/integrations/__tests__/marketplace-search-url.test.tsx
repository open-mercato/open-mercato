/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const replaceMock = jest.fn()
const apiCallMock = jest.fn()
let currentQuery = ''

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: replaceMock, refresh: jest.fn() }),
  usePathname: () => '/backend/integrations',
  useSearchParams: () => new URLSearchParams(currentQuery),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => <div>loading</div>,
}))

jest.mock('@open-mercato/ui/backend/FilterBar', () => ({
  FilterBar: () => <div>filter-bar</div>,
}))

jest.mock('lucide-react', () => new Proxy({}, {
  get: () => () => null,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: <T,>(_headers: Record<string, string>, run: () => Promise<T>) => run(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

import IntegrationsMarketplacePage from '../page'

const emptyList = { items: [], bundles: [], total: 0, page: 1, pageSize: 100, totalPages: 1 }

describe('Integrations marketplace — search URL state', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    currentQuery = ''
    replaceMock.mockReset()
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: emptyList })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('writes ?search to the URL once after typing settles, not on every keystroke', async () => {
    renderWithProviders(<IntegrationsMarketplacePage />)
    const input = await screen.findByPlaceholderText('integrations.marketplace.search') as HTMLInputElement

    fireEvent.change(input, { target: { value: 's' } })
    fireEvent.change(input, { target: { value: 'st' } })
    fireEvent.change(input, { target: { value: 'stripe' } })
    expect(replaceMock).not.toHaveBeenCalled()
    expect(input.value).toBe('stripe')

    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    expect(replaceMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).toHaveBeenCalledWith('/backend/integrations?search=stripe', { scroll: false })
    expect(input.value).toBe('stripe')
  })

  it('restores the search input from ?search on load', async () => {
    currentQuery = 'search=stripe'
    renderWithProviders(<IntegrationsMarketplacePage />)
    const input = await screen.findByPlaceholderText('integrations.marketplace.search') as HTMLInputElement
    expect(input.value).toBe('stripe')
    expect(replaceMock).not.toHaveBeenCalled()
  })
})
