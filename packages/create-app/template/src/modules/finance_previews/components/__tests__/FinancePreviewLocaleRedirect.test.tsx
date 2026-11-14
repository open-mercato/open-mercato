/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import copy from '../../i18n/pl.json'
import { FinancePreviewLocaleRedirect } from '../FinancePreviewLocaleRedirect'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => require('@open-mercato/shared/lib/i18n/translate')
    .createTranslator(require('../../i18n/pl.json')),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: require('@open-mercato/ui/backend/detail/LoadingMessage').LoadingMessage,
}))

const prototypeContent = 'Prototype content'
const renderRedirect = () => (
  <FinancePreviewLocaleRedirect>
    <p>{prototypeContent}</p>
  </FinancePreviewLocaleRedirect>
)

type Guard = ReturnType<typeof useGuardedMutation>
const runMutation = jest.fn() as jest.MockedFunction<Guard['runMutation']>
const retryLastMutation = jest.fn() as jest.MockedFunction<Guard['retryLastMutation']>

describe('FinancePreviewLocaleRedirect', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(apiCall).mockReset()
    runMutation.mockReset()
    runMutation.mockImplementation(({ operation }) => operation())
    jest.mocked(useGuardedMutation).mockReturnValue({ runMutation, retryLastMutation })
    window.history.replaceState(null, '', '/backend/finance-preview#s44')
  })

  it('shows localized loading while the guarded locale update is pending', async () => {
    let failRequest: (reason: Error) => void = () => undefined
    jest.mocked(apiCall).mockImplementation(() => new Promise((_resolve, reject) => {
      failRequest = reject
    }))

    render(renderRedirect())

    expect(screen.getByText(copy['finance_previews.page.loading'])).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(prototypeContent)).not.toBeInTheDocument()
    expect(runMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: {
        formId: 'finance-preview-locale',
        resourceKind: 'auth.locale',
        retryLastMutation,
      },
      mutationPayload: { locale: 'pl' },
    }))
    expect(apiCall).toHaveBeenCalledWith('/api/auth/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'pl' }),
    })

    await act(async () => failRequest(new Error('Network unavailable')))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('keeps the prototype usable under a translated warning and an accessible retry action after a network failure', async () => {
    jest.mocked(apiCall).mockRejectedValue(new Error('Internal transport failure'))

    const view = render(renderRedirect())

    expect(await screen.findByRole('alert')).toHaveTextContent(copy['finance_previews.page.localeError'])
    expect(screen.getByRole('button', { name: copy['finance_previews.page.retry'] })).toBeEnabled()
    expect(screen.queryByText(copy['finance_previews.page.loading'])).not.toBeInTheDocument()
    expect(screen.queryByText('Internal transport failure')).not.toBeInTheDocument()
    expect(screen.getByText(prototypeContent)).toBeInTheDocument()
    expect(window.location.pathname + window.location.hash).toBe('/backend/finance-preview#s44')

    view.rerender(renderRedirect())
    expect(apiCall).toHaveBeenCalledTimes(1)
  })

  it('treats a non-success HTTP result, such as an unsupported locale, as a recoverable warning', async () => {
    jest.mocked(apiCall).mockResolvedValue({
      ok: false,
      status: 503,
      result: null,
      response: { status: 503 } as Response,
      cacheStatus: null,
    })

    render(renderRedirect())

    expect(await screen.findByRole('alert')).toHaveTextContent(copy['finance_previews.page.localeError'])
    expect(screen.getByRole('button', { name: copy['finance_previews.page.retry'] })).toBeEnabled()
    expect(apiCall).toHaveBeenCalledTimes(1)
    expect(screen.getByText(prototypeContent)).toBeInTheDocument()
    expect(window.location.hash).toBe('#s44')
  })

  it('does not call the locale API when the mutation guard blocks the operation', async () => {
    runMutation.mockRejectedValue(new Error('Guard blocked the mutation'))

    render(renderRedirect())

    expect(await screen.findByRole('alert')).toHaveTextContent(copy['finance_previews.page.localeError'])
    expect(screen.getByRole('button', { name: copy['finance_previews.page.retry'] })).toBeEnabled()
    expect(useGuardedMutation).toHaveBeenCalledWith({
      contextId: 'finance-preview-locale',
      blockedMessage: copy['finance_previews.page.localeError'],
    })
    expect(apiCall).not.toHaveBeenCalled()
    expect(window.location.pathname + window.location.hash).toBe('/backend/finance-preview#s44')
  })

  it('does not submit a duplicate request when React replays the effect', async () => {
    jest.mocked(apiCall).mockRejectedValue(new Error('Network unavailable'))

    render(<React.StrictMode>{renderRedirect()}</React.StrictMode>)

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(apiCall).toHaveBeenCalledTimes(1)
    expect(runMutation).toHaveBeenCalledTimes(1)
  })
})
