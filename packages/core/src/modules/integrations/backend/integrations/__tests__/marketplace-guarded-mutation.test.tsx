/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const runMutationMock = jest.fn()
const apiCallMock = jest.fn()
const flashMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => (
    <button {...props}>{children}</button>
  ),
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

jest.mock('@open-mercato/ui/primitives/switch', () => ({
  Switch: ({ checked, disabled, onCheckedChange }: { checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
    >
      toggle
    </button>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: <T,>(_headers: Record<string, string>, run: () => Promise<T>) => run(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => runMutationMock(...args),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

import IntegrationsMarketplacePage from '../page'

const standaloneIntegration = {
  id: 'gateway_stripe',
  title: 'Stripe',
  description: 'Payments',
  category: 'payment',
  isEnabled: false,
  hasCredentials: true,
  healthStatus: 'healthy' as const,
  analytics: { lastActivityAt: null, totalCount: 0, errorCount: 0, errorRate: 0, dailyCounts: [0, 0, 0] },
  updatedAt: '2026-06-01T00:00:00.000Z',
}

const listResponse = {
  items: [standaloneIntegration],
  bundles: [],
  total: 1,
  page: 1,
  pageSize: 100,
  totalPages: 1,
}

describe('Integrations marketplace — guarded mutation wiring', () => {
  beforeEach(() => {
    runMutationMock.mockReset()
    apiCallMock.mockReset()
    flashMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: listResponse })
  })

  it('routes the integration toggle through runMutation and updates local state on success', async () => {
    runMutationMock.mockResolvedValue({ ok: true, result: null })

    renderWithProviders(<IntegrationsMarketplacePage />)

    const toggle = await screen.findByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))
    const runArgs = runMutationMock.mock.calls[0][0]
    expect(runArgs.mutationPayload).toMatchObject({ integrationId: 'gateway_stripe', isEnabled: true })
    expect(runArgs.context).toMatchObject({ actionId: 'toggle-state', resourceId: 'gateway_stripe' })
    expect(typeof runArgs.operation).toBe('function')

    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'))
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('flashes an error and leaves local state unchanged when the guarded mutation reports failure', async () => {
    runMutationMock.mockResolvedValue({ ok: false, result: null })

    renderWithProviders(<IntegrationsMarketplacePage />)

    const toggle = await screen.findByRole('switch')
    fireEvent.click(toggle)

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('integrations.detail.stateError', 'error'))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })
})
