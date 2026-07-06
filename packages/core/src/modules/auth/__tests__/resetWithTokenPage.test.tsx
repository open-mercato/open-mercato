/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const routerReplaceMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}))

import ResetWithTokenPage from '../frontend/reset/[token]/page'

const TOKEN = 'reset-token-0123456789abcdef'

function fillForm(
  getByLabelText: (matcher: string) => HTMLElement,
  password: string,
  confirm: string,
) {
  fireEvent.change(getByLabelText('New password'), { target: { value: password } })
  fireEvent.change(getByLabelText('Confirm new password'), { target: { value: confirm } })
}

function readFormData(body: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (body instanceof FormData) {
    for (const [key, value] of body.entries()) out[key] = String(value)
  }
  return out
}

describe('ResetWithTokenPage (staff password reset)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('blocks submission and surfaces the requirements error when the password fails the policy', async () => {
    const { getByLabelText, getByRole, findByText } = renderWithProviders(
      <ResetWithTokenPage params={{ token: TOKEN }} />,
    )
    // Meets the minLength=6 requirement but has no digit / uppercase / special char,
    // which previously produced an opaque server-side "Invalid request".
    fillForm(getByLabelText, 'password', 'password')

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /update password/i }))
    })

    await findByText(/password must meet the requirements/i)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('blocks submission and surfaces a mismatch error when passwords do not match', async () => {
    const { getByLabelText, getByRole, findByText } = renderWithProviders(
      <ResetWithTokenPage params={{ token: TOKEN }} />,
    )
    fillForm(getByLabelText, 'Password1!', 'Password2!')

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /update password/i }))
    })

    await findByText(/passwords do not match/i)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('submits token + policy-compliant password to /api/auth/reset/confirm and redirects on success', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: true, result: { ok: true, redirect: '/login' } })

    const { getByLabelText, getByRole } = renderWithProviders(
      <ResetWithTokenPage params={{ token: TOKEN }} />,
    )
    fillForm(getByLabelText, 'Password1!', 'Password1!')

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /update password/i }))
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const [url, options] = apiCallMock.mock.calls[0] as [string, { method: string; body: unknown }]
    expect(url).toBe('/api/auth/reset/confirm')
    expect(options.method).toBe('POST')
    expect(readFormData(options.body)).toMatchObject({ token: TOKEN, password: 'Password1!' })
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith('/login'))
  })
})
