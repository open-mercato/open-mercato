/** @jest-environment jsdom */
jest.setTimeout(15000)

const fetchCustomFieldFormStructureMock = jest.fn()
const buildFormFieldFromCustomFieldDefMock = jest.fn()
const triggerInjectionEventMock = jest.fn(async (_event: string, data: Record<string, unknown>) => ({
  ok: true,
  data,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogElement: null,
  }),
}))
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
jest.mock('../custom-fields/FieldDefinitionsManager', () => {
  const React = require('react')
  return {
    __esModule: true,
    FieldDefinitionsManager: React.forwardRef(() => <div>Field definitions manager</div>),
  }
})
jest.mock('../utils/customFieldForms', () => ({
  __esModule: true,
  buildFormFieldFromCustomFieldDef: (...args: unknown[]) => buildFormFieldFromCustomFieldDefMock(...args),
  buildFormFieldsFromCustomFields: jest.fn(() => []),
  fetchCustomFieldFormStructure: (...args: unknown[]) => fetchCustomFieldFormStructureMock(...args),
}))

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

describe('CrudForm custom field loading', () => {
  const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]
  const groups: CrudFormGroup[] = [
    {
      id: 'details',
      title: 'Details',
      fields: ['name'],
    },
    {
      id: 'custom',
      title: 'Custom fields',
      kind: 'customFields',
    },
  ]

  beforeEach(() => {
    fetchCustomFieldFormStructureMock.mockReset()
    buildFormFieldFromCustomFieldDefMock.mockReset()
    triggerInjectionEventMock.mockClear()
    buildFormFieldFromCustomFieldDefMock.mockReturnValue(null)
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [],
      definitions: [],
      metadata: {
        items: [],
        fieldsetsByEntity: {},
        entitySettings: {},
      },
    })
  })

  it('does not reload custom field definitions when entityIds contents stay the same across rerenders', async () => {
    const { rerender } = renderWithProviders(
      <CrudForm
        title="Form"
        entityIds={['customers.customer_entity', 'customers.customer_company_profile']}
        fields={fields}
        initialValues={{ name: 'Acme' }}
        onSubmit={() => {}}
      />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
        },
      },
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      rerender(
        <CrudForm
          title="Form"
          entityIds={['customers.customer_entity', 'customers.customer_company_profile']}
          fields={fields}
          initialValues={{ name: 'Acme' }}
          onSubmit={() => {}}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(1)
  })

  it('opens the field manager without submitting the parent form', async () => {
    const handleSubmit = jest.fn().mockResolvedValue(undefined)

    buildFormFieldFromCustomFieldDefMock.mockReturnValue({
      id: 'cf_custom_note',
      label: 'Custom note',
      type: 'text',
    })
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [],
      definitions: [
        {
          entityId: 'customers:customer_interaction',
          key: 'custom_note',
          label: 'Custom note',
          kind: 'text',
        },
      ],
      metadata: {
        items: [],
        fieldsetsByEntity: {},
        entitySettings: {},
      },
    })

    renderWithProviders(
      <CrudForm
        embedded
        title="Form"
        entityId="customers:customer_interaction"
        fields={fields}
        groups={groups}
        initialValues={{ name: 'Acme' }}
        onSubmit={handleSubmit}
      />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'entities.customFields.manageFieldset': 'Manage fields',
          'entities.customFields.manageDialogTitle': 'Edit custom fields',
        },
      },
    )

    await waitFor(() => {
      expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(1)
    })
    const manageButton = await screen.findByRole('button', { name: 'Manage fields' }, { timeout: 3000 })

    await act(async () => {
      fireEvent.click(manageButton)
    })

    expect(handleSubmit).not.toHaveBeenCalled()
    expect(await screen.findByText('Edit custom fields')).toBeInTheDocument()
  })
})
