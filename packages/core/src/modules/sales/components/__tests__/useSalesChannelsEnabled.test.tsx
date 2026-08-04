/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

const { useSalesChannelsEnabled } = require('../useSalesChannelsEnabled')

function Probe() {
  const { enabled, isLoading } = useSalesChannelsEnabled()
  return <div data-testid="probe" data-enabled={String(enabled)} data-loading={String(isLoading)} />
}

async function renderAndSettle() {
  const { unmount } = render(<Probe />)
  await waitFor(() => {
    expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('false')
  })
  const enabled = screen.getByTestId('probe').getAttribute('data-enabled')
  unmount()
  return enabled
}

describe('useSalesChannelsEnabled', () => {
  let clock = 1_000_000

  beforeEach(() => {
    jest.clearAllMocks()
    // The hook caches its result for 60s keyed off Date.now(); jump past the
    // TTL so every test starts with a cold cache.
    clock += 120_000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('disables channels only when the toggle explicitly resolves to false', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { ok: true, value: false } })
    expect(await renderAndSettle()).toBe('false')
  })

  it('keeps channels enabled when the toggle resolves to true', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { ok: true, value: true } })
    expect(await renderAndSettle()).toBe('true')
  })

  it('fails open when the toggle definition is missing (404)', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 404, result: { ok: false } })
    expect(await renderAndSettle()).toBe('true')
  })

  it('fails open when the check request throws', async () => {
    mockApiCall.mockRejectedValue(new Error('network down'))
    expect(await renderAndSettle()).toBe('true')
  })

  it('reuses the cached result across consumers within the TTL', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { ok: true, value: true } })
    await renderAndSettle()
    await renderAndSettle()
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })
})
