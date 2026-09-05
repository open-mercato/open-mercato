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

function confirmCalls(): Array<[string, { method: string; body: unknown }]> {
  return apiCallMock.mock.calls.filter(
    (call) => call[0] === '/api/auth/reset/confirm',
  ) as Array<[string, { method: string; body: unknown }]>
}

/**
 * The page checks the token against /api/auth/reset/validate before it renders
 * anything (issue #5533), so every form-level assertion has to wait for that
 * round trip to settle first.
 */
async function renderReadyForm() {
  const utils = renderWithProviders(<ResetWithTokenPage params={{ token: TOKEN }} />)
  await utils.findByLabelText('New password')
  return utils
}

describe('ResetWithTokenPage (staff password reset)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/reset/validate') return { ok: true, result: { ok: true, valid: true } }
      return { ok: true, result: { ok: true, redirect: '/login' } }
    })
  })

  it('checks the token before rendering the form', async () => {
    await renderReadyForm()

    const [url, options] = apiCallMock.mock.calls[0] as [string, { method: string; body: unknown }]
    expect(url).toBe('/api/auth/reset/validate')
    expect(options.method).toBe('POST')
    expect(readFormData(options.body)).toMatchObject({ token: TOKEN })
  })

  it('renders a terminal state instead of the form when the token is already used or expired', async () => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/reset/validate') return { ok: true, result: { ok: true, valid: false } }
      return { ok: true, result: { ok: true, redirect: '/login' } }
    })

    const { findByText, queryByLabelText, getByRole } = renderWithProviders(
      <ResetWithTokenPage params={{ token: TOKEN }} />,
    )

    await findByText(/this reset link is no longer valid/i)
    expect(queryByLabelText('New password')).toBeNull()
    expect(queryByLabelText('Confirm new password')).toBeNull()
    expect(getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/reset')
    expect(confirmCalls()).toHaveLength(0)
  })

  it('falls open to the form when the token check itself fails', async () => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/reset/validate') throw new Error('network down')
      return { ok: true, result: { ok: true, redirect: '/login' } }
    })

    const { findByLabelText } = renderWithProviders(
      <ResetWithTokenPage params={{ token: TOKEN }} />,
    )

    await findByLabelText('New password')
  })

  it('blocks submission and surfaces the requirements error when the password fails the policy', async () => {
    const { getByLabelText, getByRole, findByText } = await renderReadyForm()
    // Meets the minLength=6 requirement but has no digit / uppercase / special char,
    // which previously produced an opaque server-side "Invalid request".
    fillForm(getByLabelText, 'password', 'password')

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /update password/i }))
    })

    await findByText(/password must meet the requirements/i)
    expect(confirmCalls()).toHaveLength(0)
  })

  it('blocks submission and surfaces a mismatch error when passwords do not match', async () => {
    const { getByLabelText, getByRole, findByText } = await renderReadyForm()
    fillForm(getByLabelText, 'Password1!', 'Password2!')

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /update password/i }))
    })

    await findByText(/passwords do not match/i)
    expect(confirmCalls()).toHaveLength(0)
  })

  it('submits token + policy-compliant password to /api/auth/reset/confirm and redirects on success', async () => {
    const { getByLabelText, getByRole } = await renderReadyForm()
    fillForm(getByLabelText, 'Password1!', 'Password1!')

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /update password/i }))
    })

    await waitFor(() => expect(confirmCalls()).toHaveLength(1))
    const [, options] = confirmCalls()[0]
    expect(options.method).toBe('POST')
    expect(readFormData(options.body)).toMatchObject({ token: TOKEN, password: 'Password1!' })
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith('/login'))
  })
})
