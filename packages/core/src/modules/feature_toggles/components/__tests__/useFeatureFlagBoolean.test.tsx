/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useFeatureFlagBoolean } from '../hooks/useFeatureFlagBoolean'
import { FeatureGuard } from '../FeatureGuard'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const readApiResultOrThrowMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function Probe({ defaultValue }: { defaultValue?: boolean }) {
  const { enabled, isLoading } = useFeatureFlagBoolean({ id: 'demo_toggle', defaultValue })
  return <div data-testid="probe" data-enabled={String(enabled)} data-loading={String(isLoading)} />
}

async function renderAndSettle(defaultValue?: boolean) {
  const { unmount } = render(<Probe defaultValue={defaultValue} />, { wrapper: createWrapper() })
  await waitFor(() => {
    expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('false')
  })
  const enabled = screen.getByTestId('probe').getAttribute('data-enabled')
  unmount()
  return enabled
}

describe('useFeatureFlagBoolean', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the resolved toggle value', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ ok: true, value: false } as never)
    expect(await renderAndSettle()).toBe('false')

    readApiResultOrThrowMock.mockResolvedValue({ ok: true, value: true } as never)
    expect(await renderAndSettle()).toBe('true')
  })

  it('prefers the resolved value over defaultValue', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ ok: true, value: false } as never)
    expect(await renderAndSettle(true)).toBe('false')
  })

  it('falls back to false when the check fails and no default is given', async () => {
    readApiResultOrThrowMock.mockRejectedValue(new Error('Toggle "demo_toggle" not found (missing).'))
    expect(await renderAndSettle()).toBe('false')
  })

  it('falls back to defaultValue when the check fails', async () => {
    readApiResultOrThrowMock.mockRejectedValue(new Error('Toggle "demo_toggle" not found (missing).'))
    expect(await renderAndSettle(true)).toBe('true')
  })

  it('reports defaultValue while the check is in flight', async () => {
    readApiResultOrThrowMock.mockReturnValue(new Promise(() => {}) as never)
    render(<Probe defaultValue />, { wrapper: createWrapper() })
    const probe = screen.getByTestId('probe')
    expect(probe.getAttribute('data-loading')).toBe('true')
    expect(probe.getAttribute('data-enabled')).toBe('true')
  })
})

describe('FeatureGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  async function renderGuard(props: { defaultValue?: boolean }) {
    render(
      <FeatureGuard id="demo_toggle" fallback={<span>disabled</span>} {...props}>
        <span>enabled</span>
      </FeatureGuard>,
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText(/enabled|disabled/)).toBeTruthy()
    })
    return screen.getByText(/enabled|disabled/).textContent
  }

  it('renders the disabled fallback when the check fails', async () => {
    readApiResultOrThrowMock.mockRejectedValue(new Error('missing toggle'))
    expect(await renderGuard({})).toBe('disabled')
  })

  it('keeps children visible when the check fails and defaultValue is true', async () => {
    readApiResultOrThrowMock.mockRejectedValue(new Error('missing toggle'))
    expect(await renderGuard({ defaultValue: true })).toBe('enabled')
  })
})
