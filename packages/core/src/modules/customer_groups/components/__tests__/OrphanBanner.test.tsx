/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { OrphanBanner } from '../OrphanBanner'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>

describe('OrphanBanner', () => {
  it('reports a failed reconcile scan and renders nothing', async () => {
    mockedApiCall.mockRejectedValue(new Error('network down'))
    const { container } = render(<OrphanBanner />)

    await waitFor(() =>
      expect(mockReportError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ module: 'customer_groups', code: 'customer_groups.orphan_banner_load_failed' }),
      ),
    )
    expect(container.textContent).toBe('')
  })
})
