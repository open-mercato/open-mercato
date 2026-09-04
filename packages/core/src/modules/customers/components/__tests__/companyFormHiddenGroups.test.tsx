/** @jest-environment jsdom */
jest.setTimeout(15000)

// The FR #5876 acceptance criterion, expressed against the real core group ids:
// a host can render the built-in company form with groups omitted, without
// copying the page or rebuilding `createCompanyFormGroups`.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn(async () => ({ ok: true, data: {} })) }),
}))
jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))
jest.mock('../AddressTiles', () => ({ CustomerAddressTiles: () => null }))
jest.mock('../detail/RolesSection', () => ({ RolesSection: () => null }))

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCompanyFormGroups, type Translator } from '../formConfig'

const t: Translator = (key, fallback) => fallback ?? key

function renderCompanyForm(hiddenGroupIds?: readonly string[]) {
  return renderWithProviders(
    <CrudForm
      title="Company"
      fields={[
        { id: 'displayName', label: 'Display name', type: 'text' },
        { id: 'legalName', label: 'Legal name', type: 'text' },
        { id: 'description', label: 'Description', type: 'textarea' },
      ]}
      groups={createCompanyFormGroups(t)}
      initialValues={{
        displayName: 'Acme',
        legalName: 'Acme Sp. z o.o.',
        description: 'A note',
      }}
      hiddenGroupIds={hiddenGroupIds}
      onSubmit={() => {}}
    />,
  )
}

function renderedFieldIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-crud-field-id]'))
    .map((node) => node.getAttribute('data-crud-field-id') ?? '')
    .filter(Boolean)
}

describe('company form group visibility', () => {
  it('declares the stable group ids a host can address', () => {
    expect(createCompanyFormGroups(t).map((group) => group.id)).toEqual([
      'details',
      'profile',
      'addresses',
      'notes',
      'customFields',
    ])
  })

  it('renders every built-in group when no ids are hidden', () => {
    const { container } = renderCompanyForm()
    expect(renderedFieldIds(container)).toEqual(
      expect.arrayContaining(['displayName', 'legalName', 'description']),
    )
  })

  it('omits the named built-in groups without copying the page', () => {
    const { container } = renderCompanyForm(['profile', 'customFields'])
    const fieldIds = renderedFieldIds(container)

    // `details` and `notes` survive…
    expect(fieldIds).toEqual(expect.arrayContaining(['displayName', 'description']))
    // …while the hidden `profile` group's field is gone.
    expect(fieldIds).not.toContain('legalName')
  })

  it('still submits the hidden group values unchanged', async () => {
    const submitted: unknown[] = []
    const { container } = renderWithProviders(
      <CrudForm
        title="Company"
        fields={[
          { id: 'displayName', label: 'Display name', type: 'text' },
          { id: 'legalName', label: 'Legal name', type: 'text' },
        ]}
        groups={createCompanyFormGroups(t)}
        initialValues={{ displayName: 'Acme', legalName: 'Acme Sp. z o.o.' }}
        hiddenGroupIds={['profile']}
        onSubmit={(values) => {
          submitted.push(values)
        }}
      />,
    )

    const form = container.querySelector('form') as HTMLFormElement
    const { fireEvent, waitFor } = await import('@testing-library/react')
    fireEvent.submit(form)

    await waitFor(() => expect(submitted.length).toBe(1))
    expect(submitted[0]).toEqual(
      expect.objectContaining({ displayName: 'Acme', legalName: 'Acme Sp. z o.o.' }),
    )
  })
})
