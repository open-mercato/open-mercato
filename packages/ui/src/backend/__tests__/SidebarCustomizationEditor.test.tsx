/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SidebarCustomizationEditor } from '../sidebar/SidebarCustomizationEditor'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

type ApiCallResult<T> = {
  ok: boolean
  status: number
  result: T | null
  response: unknown
  cacheStatus: 'hit' | 'miss' | null
}

const apiCallMock = jest.fn<Promise<ApiCallResult<unknown>>, [string, RequestInit | undefined]>()

jest.mock('../utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(args[0] as string, args[1] as RequestInit | undefined),
  withScopedApiRequestHeaders: (
    _headers: Record<string, string>,
    operation: () => Promise<unknown>,
  ) => operation(),
}))

const flashMock = jest.fn()
jest.mock('../FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('next/image', () => (props: { alt?: string }) => {
  const React = require('react')
  return React.createElement('img', { alt: props.alt, ...props })
})

jest.mock('../BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: null, isLoading: false }),
}))

jest.mock('../injection/resolveInjectedIcon', () => ({
  resolveInjectedIcon: () => null,
}))

jest.mock('../injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionSpotEvents: () => ({
    triggerEvent: jest.fn(async () => ({ ok: true, requestHeaders: {} })),
  }),
}))

jest.mock('../injection/mutationEvents', () => ({
  GLOBAL_MUTATION_INJECTION_SPOT_ID: 'backend-mutation:global',
  dispatchBackendMutationError: jest.fn(),
}))

const fakeGroups = [
  {
    id: 'core',
    name: 'Core',
    items: [
      { href: '/backend/users', title: 'Users' },
      { href: '/backend/roles', title: 'Roles' },
    ],
  },
  {
    id: 'catalog',
    name: 'Catalog',
    items: [
      { href: '/backend/products', title: 'Products' },
    ],
  },
]

const dict: Record<string, string> = {
  'appShell.sidebarCustomizationHeading': 'Sidebar customization',
  'appShell.sidebarCustomizationLoading': 'Loading preferences…',
  'appShell.sidebarCustomizationLoadError': 'We couldn’t load your sidebar preferences.',
  'appShell.sidebarCustomizationSave': 'Save',
  'appShell.sidebarCustomizationCancel': 'Cancel',
  'appShell.sidebarCustomizationReset': 'Reset',
  'appShell.sidebarCustomizationDragToReorder': 'Drag to reorder',
  'appShell.sidebarCustomizationVariantNew': 'Add new variant',
  'appShell.sidebarCustomizationVariantsEmpty': 'No saved variants yet',
}

function setApiCallSequence(responses: Array<{ url: RegExp; response: ApiCallResult<unknown> }>) {
  apiCallMock.mockImplementation((url: string) => {
    const match = responses.find((entry) => entry.url.test(url))
    if (!match) {
      throw new Error(`apiCall mock: no response configured for ${url}`)
    }
    return Promise.resolve(match.response)
  })
}

function okResult<T>(result: T): ApiCallResult<T> {
  return { ok: true, status: 200, result, response: {}, cacheStatus: null }
}

function errorResult(status: number): ApiCallResult<unknown> {
  return { ok: false, status, result: null, response: {}, cacheStatus: null }
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
})

describe('SidebarCustomizationEditor', () => {
  it('shows the loading skeleton before async data resolves', () => {
    setApiCallSequence([
      { url: /\/api\/auth\/sidebar\/variants/, response: okResult({ locale: 'en', variants: [] }) },
      { url: /\/api\/auth\/sidebar\/preferences/, response: okResult({ canApplyToRoles: false, roles: [] }) },
    ])

    const { container } = renderWithProviders(
      <SidebarCustomizationEditor groups={fakeGroups} />,
      { dict },
    )

    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument()
  })

  it('renders draggable item handles after variants load', async () => {
    setApiCallSequence([
      { url: /\/api\/auth\/sidebar\/variants/, response: okResult({ locale: 'en', variants: [] }) },
      { url: /\/api\/auth\/sidebar\/preferences/, response: okResult({ canApplyToRoles: false, roles: [] }) },
    ])

    renderWithProviders(<SidebarCustomizationEditor groups={fakeGroups} />, { dict })

    await waitFor(() => {
      expect(screen.queryByText('Loading preferences…')).not.toBeInTheDocument()
    })

    const dragHandles = await screen.findAllByLabelText('Drag to reorder')
    expect(dragHandles.length).toBeGreaterThan(0)

    expect(screen.getByText('Variant name')).toBeInTheDocument()
  })

  it('surfaces a load error when the variants endpoint fails', async () => {
    setApiCallSequence([
      { url: /\/api\/auth\/sidebar\/variants/, response: errorResult(500) },
      { url: /\/api\/auth\/sidebar\/preferences/, response: okResult({ canApplyToRoles: false, roles: [] }) },
    ])

    renderWithProviders(<SidebarCustomizationEditor groups={fakeGroups} />, { dict })

    await waitFor(() => {
      expect(screen.getByText('We couldn’t load your sidebar preferences.')).toBeInTheDocument()
    })
  })

  it('renders the role-apply target list when canApplyToRoles is true', async () => {
    setApiCallSequence([
      { url: /\/api\/auth\/sidebar\/variants/, response: okResult({ locale: 'en', variants: [] }) },
      {
        url: /\/api\/auth\/sidebar\/preferences/,
        response: okResult({
          canApplyToRoles: true,
          roles: [
            { id: 'role-staff', name: 'Staff', hasPreference: false },
            { id: 'role-admin', name: 'Admin', hasPreference: true },
          ],
        }),
      },
    ])

    renderWithProviders(<SidebarCustomizationEditor groups={fakeGroups} />, { dict })

    await waitFor(() => {
      expect(screen.getByText('Staff')).toBeInTheDocument()
    })
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('shows duplicate-name error inline inside the add-variant dialog (not on the page behind it)', async () => {
    const duplicateMessage = 'A variant with this name already exists. Choose a different name.'

    apiCallMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && /\/api\/auth\/sidebar\/variants$/.test(url)) {
        return Promise.resolve({
          ok: false,
          status: 409,
          result: { error: duplicateMessage, code: 'duplicate_name' },
          response: {},
          cacheStatus: null,
        } as ApiCallResult<unknown>)
      }
      if (/\/api\/auth\/sidebar\/variants/.test(url)) {
        return Promise.resolve(okResult({ locale: 'en', variants: [] }))
      }
      if (/\/api\/auth\/sidebar\/preferences/.test(url)) {
        return Promise.resolve(okResult({ canApplyToRoles: false, roles: [] }))
      }
      throw new Error(`apiCall mock: no response configured for ${url}`)
    })

    renderWithProviders(<SidebarCustomizationEditor groups={fakeGroups} />, { dict })

    const openDialogButton = await screen.findByRole('button', { name: /Create new/ })
    fireEvent.click(openDialogButton)

    const dialog = await screen.findByRole('dialog')
    const nameInput = within(dialog).getByPlaceholderText('My preferences')
    fireEvent.change(nameInput, { target: { value: 'My Variant' } })

    fireEvent.click(within(dialog).getByRole('button', { name: /Create variant/ }))

    const dialogAlert = await within(dialog).findByRole('alert')
    expect(dialogAlert).toHaveTextContent(duplicateMessage)
    expect(within(dialog).getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')

    expect(screen.getByRole('dialog')).toBeInTheDocument()

    expect(screen.getAllByText(duplicateMessage)).toHaveLength(1)
  })

  it('clears the inline dialog error when the user edits the name', async () => {
    const duplicateMessage = 'A variant with this name already exists. Choose a different name.'

    apiCallMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && /\/api\/auth\/sidebar\/variants$/.test(url)) {
        return Promise.resolve({
          ok: false,
          status: 409,
          result: { error: duplicateMessage, code: 'duplicate_name' },
          response: {},
          cacheStatus: null,
        } as ApiCallResult<unknown>)
      }
      if (/\/api\/auth\/sidebar\/variants/.test(url)) {
        return Promise.resolve(okResult({ locale: 'en', variants: [] }))
      }
      if (/\/api\/auth\/sidebar\/preferences/.test(url)) {
        return Promise.resolve(okResult({ canApplyToRoles: false, roles: [] }))
      }
      throw new Error(`apiCall mock: no response configured for ${url}`)
    })

    renderWithProviders(<SidebarCustomizationEditor groups={fakeGroups} />, { dict })

    const openDialogButton = await screen.findByRole('button', { name: /Create new/ })
    fireEvent.click(openDialogButton)
    const dialog = await screen.findByRole('dialog')
    const nameInput = within(dialog).getByPlaceholderText('My preferences')
    fireEvent.change(nameInput, { target: { value: 'My Variant' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Create variant/ }))

    await within(dialog).findByRole('alert')

    fireEvent.change(nameInput, { target: { value: 'My Variant 2' } })

    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not render the role-apply target list when canApplyToRoles is false', async () => {
    setApiCallSequence([
      { url: /\/api\/auth\/sidebar\/variants/, response: okResult({ locale: 'en', variants: [] }) },
      {
        url: /\/api\/auth\/sidebar\/preferences/,
        response: okResult({
          canApplyToRoles: false,
          roles: [{ id: 'role-staff', name: 'Staff', hasPreference: false }],
        }),
      },
    ])

    renderWithProviders(<SidebarCustomizationEditor groups={fakeGroups} />, { dict })

    await waitFor(() => {
      expect(screen.queryByText('Loading preferences…')).not.toBeInTheDocument()
    })
    expect(screen.queryByText('Staff')).not.toBeInTheDocument()
  })
})
