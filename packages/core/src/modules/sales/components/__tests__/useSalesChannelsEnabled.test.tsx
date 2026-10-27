/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockReadApiResultOrThrow = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))

const { useSalesChannelsEnabled, SALES_CHANNELS_TOGGLE_ID } = require('../useSalesChannelsEnabled')

function Probe() {
  const { enabled, isLoading } = useSalesChannelsEnabled()
  return <div data-testid="probe" data-enabled={String(enabled)} data-loading={String(isLoading)} />
}

function createWrapper(options?: { keepCache?: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, ...(options?.keepCache ? {} : { gcTime: 0 }) } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

async function renderAndSettle() {
  const { unmount } = render(<Probe />, { wrapper: createWrapper() })
  await waitFor(() => {
    expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('false')
  })
  const enabled = screen.getByTestId('probe').getAttribute('data-enabled')
  unmount()
  return enabled
}

describe('useSalesChannelsEnabled', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('checks the sales channels toggle', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ ok: true, value: true })
    await renderAndSettle()
    expect(String(mockReadApiResultOrThrow.mock.calls[0][0])).toContain(
      `identifier=${SALES_CHANNELS_TOGGLE_ID}`,
    )
  })

  it('disables channels only when the toggle explicitly resolves to false', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ ok: true, value: false })
    expect(await renderAndSettle()).toBe('false')
  })

  it('keeps channels enabled when the toggle resolves to true', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ ok: true, value: true })
    expect(await renderAndSettle()).toBe('true')
  })

  it('fails open when the toggle definition is missing (404)', async () => {
    mockReadApiResultOrThrow.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    expect(await renderAndSettle()).toBe('true')
  })

  it('fails open when the check request throws', async () => {
    mockReadApiResultOrThrow.mockRejectedValue(new Error('network down'))
    expect(await renderAndSettle()).toBe('true')
  })

  it('keeps channels visible while the check is still in flight', () => {
    mockReadApiResultOrThrow.mockReturnValue(new Promise(() => {}))
    render(<Probe />, { wrapper: createWrapper() })
    const probe = screen.getByTestId('probe')
    expect(probe.getAttribute('data-loading')).toBe('true')
    expect(probe.getAttribute('data-enabled')).toBe('true')
  })

  it('reuses the cached result across consumers', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ ok: true, value: true })
    const wrapper = createWrapper({ keepCache: true })
    const first = render(<Probe />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('false')
    })
    first.unmount()
    render(<Probe />, { wrapper })
    await waitFor(() => {
      expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('false')
    })
    expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(1)
  })
})
