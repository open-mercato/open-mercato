/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import CreateCompanyPage from '../companies/create/page'
import CreatePersonPage from '../people/create/page'

const pushMock = jest.fn()
let returnTo: string | null = null

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/backend/customers/create',
  useSearchParams: () => ({ get: (key: string) => key === 'returnTo' ? returnTo : null }),
}))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1' }),
  useOrganizationScopeVersion: () => 0,
}))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: async () => ({ ok: true }) }),
}))
jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))
jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  fetchCustomFieldDefs: async () => [],
  fetchCustomFieldFormStructure: async () => ({ definitions: [], metadata: {} }),
}))
jest.mock('../../../components/formConfig', () => {
  const createFields = () => [
    { id: 'displayName', label: 'Name', type: 'text' },
    {
      id: 'addresses',
      label: 'Addresses',
      type: 'custom',
      component: ({ setValue }: CrudCustomFieldRenderProps) => (
        <input
          aria-label="Address company name"
          onChange={(event) => setValue([{
            id: 'staged-address',
            addressLine1: ' Portowa 3 ',
            companyName: event.target.value,
            country: 'pl',
            isPrimary: true,
          }])}
        />
      ),
    },
  ]
  return {
    createCompanyFormSchema: () => undefined,
    createPersonFormSchema: () => undefined,
    createCompanyFormFields: createFields,
    createPersonFormFields: createFields,
    createCompanyFormGroups: () => undefined,
    createPersonFormGroups: () => undefined,
    buildCompanyPayload: (values: Record<string, unknown>) => values,
    buildPersonPayload: (values: Record<string, unknown>) => values,
  }
})

describe.each([
  ['company', CreateCompanyPage, 'customers/companies', '/backend/customers/companies-v2/new-record', '/backend/customers/companies'],
  ['person', CreatePersonPage, 'customers/people', '/backend/customers/people-v2/new-record', '/backend/customers/people'],
] as const)('%s create submit lifecycle', (_kind, CreatePage, resource, detailHref, listHref) => {
  beforeEach(() => {
    jest.clearAllMocks()
    returnTo = null
    jest.mocked(createCrud).mockResolvedValue({ result: { id: 'new-record' }, response: {} as Response })
  })

  function renderCreatePage() {
    const view = renderWithProviders(<CreatePage />)
    const form = view.container.querySelector('form')!
    fireEvent.change(view.getByRole('textbox', { name: 'Name' }), { target: { value: 'New customer' } })
    return { ...view, form }
  }

  it.each([
    ['Warehouse Świętek', 'Warehouse Świętek'],
    ['  Warehouse Świętek  ', 'Warehouse Świętek'],
    ['   ', undefined],
  ])('submits the staged address company name %j as %j', async (input, expected) => {
    const { form, getByRole } = renderCreatePage()
    fireEvent.change(getByRole('textbox', { name: 'Address company name' }), { target: { value: input } })
    await act(async () => { fireEvent.submit(form) })
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(detailHref))

    const addressCalls = jest.mocked(createCrud).mock.calls.filter(([path]) => path === 'customers/addresses')
    expect(addressCalls).toHaveLength(1)
    expect(addressCalls[0][1]).toEqual({
      entityId: 'new-record',
      organizationId: 'org-1',
      addressLine1: 'Portowa 3',
      country: 'PL',
      isPrimary: true,
      ...(expected === undefined ? {} : { companyName: expected }),
    })
  })

  it('ignores click, keyboard and direct submissions after save resolves until navigation unmounts the form', async () => {
    const { container, form, getByRole } = renderCreatePage()
    await act(async () => { fireEvent.submit(form) })
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(detailHref))

    const submitButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))
    expect(submitButtons.length).toBeGreaterThan(0)
    for (const button of submitButtons) {
      fireEvent.click(button)
    }
    getByRole('textbox', { name: 'Name' }).focus()
    await userEvent.keyboard('{Enter}{Control>}{Enter}{/Control}{Meta>}{Enter}{/Meta}')
    await act(async () => { fireEvent.submit(form) })

    expect(createCrud).toHaveBeenCalledTimes(1)
    expect(createCrud).toHaveBeenCalledWith(resource, expect.objectContaining({ displayName: 'New customer' }))
    expect(pushMock).toHaveBeenCalledTimes(1)
    for (const button of submitButtons) expect(button).toBeDisabled()
  })

  it('releases the lock on a failed save and locks after a successful keyboard retry', async () => {
    jest.mocked(createCrud).mockRejectedValueOnce(new Error('Save failed'))
    const { container, form, getByRole } = renderCreatePage()
    await act(async () => { fireEvent.submit(form) })
    await waitFor(() => expect(container.querySelector('button[type="submit"]')).toBeEnabled())
    expect(pushMock).not.toHaveBeenCalled()

    getByRole('textbox', { name: 'Name' }).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(detailHref))
    await act(async () => { fireEvent.submit(form) })
    expect(createCrud).toHaveBeenCalledTimes(2)
    expect(container.querySelector('button[type="submit"]')).toBeDisabled()
  })

  it('preserves the returnTo destination', async () => {
    returnTo = '/backend/customers/deals'
    const { form } = renderCreatePage()
    await act(async () => { fireEvent.submit(form) })
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(returnTo))
  })

  it('preserves the list fallback when the response has no record ID', async () => {
    jest.mocked(createCrud).mockResolvedValue({ result: {}, response: {} as Response })
    const { form } = renderCreatePage()
    await act(async () => { fireEvent.submit(form) })
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(listHref))
  })
})
