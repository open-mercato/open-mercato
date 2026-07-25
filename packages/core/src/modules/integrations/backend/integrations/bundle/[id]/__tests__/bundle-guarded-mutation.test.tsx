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

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/integrations/bundle/payments_bundle',
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  RecordNotFoundState: ({ label }: { label: string }) => <div>{label}</div>,
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

import BundleConfigPage from '../page'

const bundleDetail = {
  integration: { id: 'payments_bundle', title: 'Payments bundle', bundleId: 'payments_bundle' },
  bundle: {
    id: 'payments_bundle',
    title: 'Payments bundle',
    description: 'Shared payment credentials',
    credentials: { fields: [{ key: 'apiKey', label: 'API Key', type: 'text', required: true }] },
  },
  bundleIntegrations: [
    { id: 'gateway_stripe', title: 'Stripe', category: 'payment', isEnabled: false },
  ],
  state: { isEnabled: true },
  hasCredentials: true,
}

function mockLoadResponses() {
  apiCallMock.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.endsWith('/credentials')) {
      return Promise.resolve({ ok: true, result: { credentials: { apiKey: 'existing' } } })
    }
    return Promise.resolve({ ok: true, result: bundleDetail })
  })
}

describe('Integrations bundle — guarded mutation wiring', () => {
  beforeEach(() => {
    runMutationMock.mockReset()
    apiCallMock.mockReset()
    flashMock.mockReset()
    mockLoadResponses()
  })

  it('routes the child integration toggle through runMutation and updates local state on success', async () => {
    runMutationMock.mockResolvedValue({ ok: true, result: null })

    renderWithProviders(<BundleConfigPage params={{ id: 'payments_bundle' }} />)

    const toggle = await screen.findByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)

    await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
    const runArgs = runMutationMock.mock.calls[0][0]
    expect(runArgs.mutationPayload).toMatchObject({ integrationId: 'gateway_stripe', isEnabled: true })
    expect(runArgs.context).toMatchObject({ actionId: 'toggle-state', resourceId: 'gateway_stripe' })
    expect(typeof runArgs.operation).toBe('function')

    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'))
  })

  it('routes the shared credentials save through runMutation and flashes success', async () => {
    runMutationMock.mockResolvedValue({ ok: true, result: null })

    renderWithProviders(<BundleConfigPage params={{ id: 'payments_bundle' }} />)

    const saveButton = await screen.findByText('integrations.detail.credentials.save')
    fireEvent.click(saveButton)

    await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
    const saveCall = runMutationMock.mock.calls.find((call) => call[0]?.context?.actionId === 'save-credentials')
    expect(saveCall).toBeTruthy()
    expect(saveCall[0].mutationPayload).toMatchObject({ bundleId: 'payments_bundle' })
    expect(typeof saveCall[0].operation).toBe('function')

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('integrations.detail.credentials.saved', 'success'))
  })
})
