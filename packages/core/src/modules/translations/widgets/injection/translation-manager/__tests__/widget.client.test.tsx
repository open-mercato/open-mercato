/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('next/navigation', () => ({
  useParams: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../../../../components/TranslationManager', () => ({
  TranslationManager: () => null,
}))

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import TranslationWidget from '../widget.client'

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>
type ApiResult = Awaited<ReturnType<typeof apiCall>>

function featureCheckResult(granted: string[]): ApiResult {
  return {
    ok: true,
    status: 200,
    result: { ok: granted.length > 0, granted, userId: 'user-1' },
    cacheStatus: null,
  } as unknown as ApiResult
}

const widgetContext = { entityId: 'customers:person', recordId: 'record-1' }
const widgetData = { id: 'record-1' }

function renderWidget() {
  return renderWithProviders(
    <TranslationWidget context={widgetContext} data={widgetData} />,
  )
}

describe('TranslationWidget — access probe', () => {
  beforeEach(() => {
    mockedApiCall.mockReset()
  })

  it('probes access through apiCall/feature-check (no native fetch) and shows the trigger when granted', async () => {
    mockedApiCall.mockResolvedValue(featureCheckResult(['translations.view']))
    renderWidget()

    expect(await screen.findByRole('button', { name: 'Translation manager' })).toBeInTheDocument()

    expect(mockedApiCall).toHaveBeenCalledTimes(1)
    const [url, init] = mockedApiCall.mock.calls[0]
    expect(url).toBe('/api/auth/feature-check')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ features: ['translations.view'] })
  })

  it('hides the widget when the user lacks translations.view', async () => {
    mockedApiCall.mockResolvedValue(featureCheckResult([]))
    renderWidget()

    await waitFor(() => expect(mockedApiCall).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Translation manager' })).not.toBeInTheDocument()
  })

  it('hides gracefully on a forbidden response without throwing or redirecting', async () => {
    // apiCall throws ForbiddenError on a 403 now that the redirect-on-403 behavior is gone.
    // The probe must swallow it (retry: false) and keep the widget hidden.
    mockedApiCall.mockRejectedValue(new Error('Forbidden'))
    renderWidget()

    await waitFor(() => expect(mockedApiCall).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Translation manager' })).not.toBeInTheDocument()
  })

  it('dedupes the access probe across multiple injected widget instances', async () => {
    mockedApiCall.mockResolvedValue(featureCheckResult(['translations.view']))
    renderWithProviders(
      <>
        <TranslationWidget context={widgetContext} data={widgetData} />
        <TranslationWidget context={widgetContext} data={widgetData} />
      </>,
    )

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Translation manager' })).toHaveLength(2),
    )
    expect(mockedApiCall).toHaveBeenCalledTimes(1)
  })
})
