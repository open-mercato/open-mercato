/** @jest-environment jsdom */
jest.setTimeout(15000)

const routerRefreshMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: routerRefreshMock }),
  usePathname: () => '/backend/profile/change-password',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: async () => ({ ok: true }) }),
}))
jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/FlashMessages'),
  flash: jest.fn(),
}))

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import ProfileChangePasswordPage from '../page'

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>
const readApiResultOrThrowMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const flashMock = flash as jest.MockedFunction<typeof flash>

const SAVED_EMAIL = 'ada@example.com'
const EDITED_EMAIL = 'ada.lovelace@example.com'

function saveBar() {
  return document.querySelector<HTMLElement>('[data-slot="form-save-bar"]')
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save changes' })
}

async function renderLoadedPage() {
  renderWithProviders(<ProfileChangePasswordPage />)
  return (await screen.findByDisplayValue(SAVED_EMAIL)) as HTMLInputElement
}

async function editEmail(input: HTMLInputElement, value: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value } })
  })
  await waitFor(() => expect(saveBar()).not.toBeNull())
}

describe('ProfileChangePasswordPage save bar', () => {
  beforeEach(() => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: { email: SAVED_EMAIL, name: 'Ada' },
    } as Awaited<ReturnType<typeof apiCall>>)
    readApiResultOrThrowMock.mockResolvedValue({ ok: true, email: EDITED_EMAIL })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('shows no save bar and no Save button while the form is clean', async () => {
    await renderLoadedPage()
    expect(screen.getByRole('heading', { name: 'Change Password' })).toBeInTheDocument()
    expect(saveBar()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('shows the bar with one Save button wired to the form after a change', async () => {
    const emailInput = await renderLoadedPage()
    await editEmail(emailInput, EDITED_EMAIL)
    expect(saveBar()).toHaveAttribute('data-state', 'dirty')
    expect(saveBar()).toHaveAttribute('data-placement', 'floating')
    expect(screen.getAllByRole('button', { name: 'Save changes' })).toHaveLength(1)
    expect(saveButton()).toHaveAttribute('type', 'submit')
    expect(saveButton()).toHaveAttribute('form', emailInput.closest('form')?.id)
  })

  it('submits the form from the bar and hides it after a successful save', async () => {
    const emailInput = await renderLoadedPage()
    await editEmail(emailInput, EDITED_EMAIL)
    await act(async () => {
      fireEvent.click(saveButton())
    })
    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1))
    const [url, init] = readApiResultOrThrowMock.mock.calls[0]
    expect(url).toBe('/api/auth/profile')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({ email: EDITED_EMAIL })
    await waitFor(() => expect(saveBar()).toBeNull())
    expect(flashMock).toHaveBeenCalledWith('Profile updated.', 'success')
    expect(flashMock).toHaveBeenCalledTimes(1)
    expect(routerRefreshMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByDisplayValue(EDITED_EMAIL)).toBeInTheDocument()
  })

  it('reports saving while the request is pending', async () => {
    let finishSave: (value: { ok: boolean; email: string }) => void = () => undefined
    readApiResultOrThrowMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        }),
    )
    const emailInput = await renderLoadedPage()
    await editEmail(emailInput, EDITED_EMAIL)
    await act(async () => {
      fireEvent.click(saveButton())
    })
    await waitFor(() => expect(saveBar()).toHaveAttribute('data-state', 'saving'))
    expect(document.querySelector('[data-slot="form-save-bar-save"]')).toBeDisabled()
    await act(async () => {
      finishSave({ ok: true, email: EDITED_EMAIL })
    })
    await waitFor(() => expect(saveBar()).toBeNull())
  })

  it('restores the last saved values and hides the bar on Reset', async () => {
    const emailInput = await renderLoadedPage()
    await editEmail(emailInput, EDITED_EMAIL)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    })
    await waitFor(() => expect(saveBar()).toBeNull())
    expect(screen.getByDisplayValue(SAVED_EMAIL)).toBeInTheDocument()
    expect(screen.queryByDisplayValue(EDITED_EMAIL)).not.toBeInTheDocument()
    expect(readApiResultOrThrowMock).not.toHaveBeenCalled()
  })

  it('shows the failed state with a retry when the save is rejected', async () => {
    readApiResultOrThrowMock.mockRejectedValue(new Error('Failed to update profile.'))
    const emailInput = await renderLoadedPage()
    await editEmail(emailInput, EDITED_EMAIL)
    await act(async () => {
      fireEvent.click(saveButton())
    })
    await waitFor(() => expect(saveBar()).toHaveAttribute('data-state', 'failed'))
    expect(saveButton()).toBeEnabled()
    expect(screen.getByDisplayValue(EDITED_EMAIL)).toBeInTheDocument()
    expect(flashMock).toHaveBeenCalledWith('Failed to update profile.', 'error')
    expect(flashMock).not.toHaveBeenCalledWith('Profile updated.', 'success')

    readApiResultOrThrowMock.mockResolvedValue({ ok: true, email: EDITED_EMAIL })
    await act(async () => {
      fireEvent.click(saveButton())
    })
    await waitFor(() => expect(saveBar()).toBeNull())
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
  })
})
