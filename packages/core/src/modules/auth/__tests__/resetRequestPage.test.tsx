/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { fireEvent, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import ResetPage from '../frontend/reset'

describe('ResetPage (staff password reset request)', () => {
  const originalFetch = global.fetch
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('server-renders a disabled POST form so a pre-hydration submit cannot leak the email into a GET URL', () => {
    const html = renderToString(
      <I18nProvider locale="en" dict={{}}>
        <ResetPage />
      </I18nProvider>,
    )
    const container = document.createElement('div')
    container.innerHTML = html
    const form = container.querySelector('form')
    const submit = container.querySelector('button[type="submit"]')
    expect(form?.getAttribute('method')).toBe('post')
    expect(form?.getAttribute('data-auth-ready')).toBe('0')
    expect(submit?.hasAttribute('disabled')).toBe(true)
  })

  it('enables the form after hydration and posts the email to the reset API', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const { container, findByText } = renderWithProviders(<ResetPage />)
    const form = container.querySelector('form') as HTMLFormElement
    await waitFor(() => expect(form.getAttribute('data-auth-ready')).toBe('1'))
    const submit = container.querySelector('button[type="submit"]')
    expect(submit).not.toBeDisabled()

    fireEvent.change(container.querySelector('input[name="email"]') as HTMLInputElement, {
      target: { value: 'user@example.com' },
    })
    fireEvent.submit(form)

    await findByText(/if an account with that email exists/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: FormData }]
    expect(url).toBe('/api/auth/reset')
    expect(init.method).toBe('POST')
    expect(init.body.get('email')).toBe('user@example.com')
  })
})
