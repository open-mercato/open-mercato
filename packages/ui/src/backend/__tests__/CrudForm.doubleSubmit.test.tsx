/** @jest-environment jsdom */
jest.setTimeout(15000)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn() }),
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

})
