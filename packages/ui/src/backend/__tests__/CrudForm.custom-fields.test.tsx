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

  it('hydrates bare-key custom field initialValues after definitions load and after remount', async () => {
    const loadOptions = jest.fn().mockResolvedValue([
      { value: 'CNY', label: 'CNY - Chinese Yuan' },
    ])

    buildFormFieldFromCustomFieldDefMock.mockImplementation((definition: any) => ({
      id: `cf_${definition.key}`,
      label: definition.label ?? definition.key,
      type: 'select',
      loadOptions,
    }))
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [],
      definitions: [
        {
          entityId: 'customers:customer_company_profile',
          key: 'preferred_currency',
          label: 'Preferred currency',
          kind: 'currency',
        },
      ],
      metadata: {
        items: [],
        fieldsetsByEntity: {},
        entitySettings: {},
      },
    })

    function Host({ visible }: { visible: boolean }) {
      if (!visible) return null
      return (
        <CrudForm
          embedded
          title="Form"
          entityId="customers:customer_company_profile"
          fields={fields}
          groups={groups}
          initialValues={{ name: 'Acme', preferred_currency: 'CNY' }}
          onSubmit={() => {}}
        />
      )
    }

    const { container, rerender } = renderWithProviders(
      <Host visible />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'entities.customFields.manageFieldset': 'Manage fields',
        },
      },
    )

    const getCurrencySelect = () =>
      container.querySelector('[data-crud-field-id="cf_preferred_currency"] select') as HTMLSelectElement | null

    await waitFor(() => {
      expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(getCurrencySelect()).not.toBeNull()
    })
    await waitFor(() => {
      expect(getCurrencySelect()?.value).toBe('CNY')
    })

    await act(async () => {
      rerender(<Host visible={false} />)
    })

    await act(async () => {
      rerender(<Host visible />)
    })

    await waitFor(() => {
      expect(getCurrencySelect()).not.toBeNull()
    })
    await waitFor(() => {
      expect(getCurrencySelect()?.value).toBe('CNY')
    })
    expect(loadOptions).toHaveBeenCalled()
  })

  it('renders custom select values from bare-key initialValues', async () => {
    buildFormFieldFromCustomFieldDefMock.mockImplementation((definition: any) => ({
      id: `cf_${definition.key}`,
      label: definition.label ?? definition.key,
      type: 'select',
      options: definition.options,
    }))
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [],
      definitions: [
        {
          entityId: 'customers:customer_company_profile',
          key: 'relationship_health',
          label: 'Relationship health',
          kind: 'select',
          options: [
            { value: 'healthy', label: 'Healthy' },
            { value: 'monitor', label: 'Monitor' },
            { value: 'at_risk', label: 'At risk' },
          ],
        },
        {
          entityId: 'customers:customer_company_profile',
          key: 'renewal_quarter',
          label: 'Renewal quarter',
          kind: 'select',
          options: [
            { value: 'Q1', label: 'Q1' },
            { value: 'Q2', label: 'Q2' },
            { value: 'Q3', label: 'Q3' },
            { value: 'Q4', label: 'Q4' },
          ],
        },
      ],
      metadata: {
        items: [],
        fieldsetsByEntity: {},
        entitySettings: {},
      },
    })

    const { container } = renderWithProviders(
      <CrudForm
        embedded
        title="Form"
        entityId="customers:customer_company_profile"
        fields={fields}
        groups={groups}
        initialValues={{ name: 'Acme', relationship_health: 'healthy', renewal_quarter: 'Q3' }}
        onSubmit={() => {}}
      />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'entities.customFields.manageFieldset': 'Manage fields',
        },
      },
    )

    const getSelectValue = (fieldId: string) =>
      (container.querySelector(`[data-crud-field-id="${fieldId}"] select`) as HTMLSelectElement | null)?.value

    await waitFor(() => {
      expect(getSelectValue('cf_relationship_health')).toBe('healthy')
    })
    await waitFor(() => {
      expect(getSelectValue('cf_renewal_quarter')).toBe('Q3')
    })
    expect(container.querySelector('[data-crud-field-id="cf_relationship_health"]')?.textContent).toContain('Healthy')
    expect(container.querySelector('[data-crud-field-id="cf_renewal_quarter"]')?.textContent).toContain('Q3')
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
