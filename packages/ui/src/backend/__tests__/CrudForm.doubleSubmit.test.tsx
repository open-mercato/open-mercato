/** @jest-environment jsdom */
jest.setTimeout(15000)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
// A shared, per-test-overridable mock so the onBeforeNavigate-denial test below
// can simulate a blocking injection widget without a real injection spot.
const triggerInjectionEventMock = jest.fn(async () => ({ ok: true }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: triggerInjectionEventMock }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

describe('CrudForm double-submit protection (issue #1539)', () => {
  const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]

  afterEach(() => {
    triggerInjectionEventMock.mockReset().mockImplementation(async () => ({ ok: true }))
  })

  it('ignores rapid repeated submits while the first onSubmit is still running', async () => {
    let resolveSubmit: (() => void) | null = null
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve
        }),
    )

    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ name: 'alpha' }}
        onSubmit={onSubmit}
      />,
    )

    const form = container.querySelector('form') as HTMLFormElement
    expect(form).not.toBeNull()

    await act(async () => {
      fireEvent.submit(form)
      fireEvent.submit(form)
      fireEvent.submit(form)
      fireEvent.submit(form)
      fireEvent.submit(form)
    })

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      resolveSubmit?.()
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('allows a fresh submit once the previous one settles', async () => {
    const onSubmit = jest.fn(() => Promise.resolve())

    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ name: 'alpha' }}
        onSubmit={onSubmit}
      />,
    )

    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
  })

  it.each([
    '/somewhere',
    () => '/somewhere',
  ])('ignores a second submit after a successful save that redirects, before the route unmounts the form (issue #8645)', async (successRedirect) => {
    let resolveSubmit: (() => void) | null = null
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve
        }),
    )

    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ name: 'alpha' }}
        onSubmit={onSubmit}
        successRedirect={successRedirect}
      />,
    )

    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    // Resolve the save. The mocked router's push() never unmounts the form,
    // mirroring the real window between router.push resolving and the route
    // actually unmounting. By the time this act() settles, the success path
    // (including the success-redirect call) has fully run.
    await act(async () => {
      resolveSubmit?.()
    })

    // A second submit fired in that window must not call onSubmit again.
    await act(async () => {
      fireEvent.submit(form)
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it.each([
    '/somewhere',
    () => '/somewhere',
  ])('releases the lock when onBeforeNavigate blocks the success redirect, so the next submit proceeds normally', async (successRedirect) => {
    triggerInjectionEventMock.mockImplementation(async (eventName: unknown) =>
      eventName === 'onBeforeNavigate' ? { ok: false, message: 'blocked' } : { ok: true },
    )

    const onSubmit = jest.fn(() => Promise.resolve())

    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ name: 'alpha' }}
        onSubmit={onSubmit}
        successRedirect={successRedirect}
        injectionSpotId="test:crudform-nav-guard"
      />,
    )

    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    // navigateWithGuard's canNavigateTo refused the target, so
    // redirectNavigationStarted stays false and both finally blocks release
    // the lock immediately — unlike the allowed-redirect case above, a second
    // submit right away must go through rather than being swallowed.
    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
  })

  it('resolves the redirect with the saved result after the success lifecycle completes', async () => {
    const onSubmitSuccess = jest.fn()
    const successRedirect = jest.fn(() => '/created/123')
    const { container } = renderWithProviders(
      <CrudForm
        fields={fields}
        initialValues={{ name: 'alpha' }}
        onSubmit={() => ({ resourceId: '123' })}
        onSubmitSuccess={onSubmitSuccess}
        successRedirect={successRedirect}
      />,
    )

    await act(async () => { fireEvent.submit(container.querySelector('form')!) })

    await waitFor(() => expect(successRedirect).toHaveBeenCalledWith({ name: 'alpha' }, { resourceId: '123' }))
    expect(onSubmitSuccess.mock.invocationCallOrder[0]).toBeLessThan(successRedirect.mock.invocationCallOrder[0])
  })

  it('releases the lock when the redirect resolver returns no destination', async () => {
    const onSubmit = jest.fn(() => Promise.resolve())
    const { container } = renderWithProviders(
      <CrudForm fields={fields} onSubmit={onSubmit} successRedirect={() => undefined} />,
    )
    const form = container.querySelector('form')!

    await act(async () => { fireEvent.submit(form) })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    await act(async () => { fireEvent.submit(form) })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
  })

})
