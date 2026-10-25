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
import type { CustomFieldDefDto } from '../utils/customFieldDefs'
import { I18nProvider, useT } from '@open-mercato/shared/lib/i18n/context'

const polishCustomFields = {
  'example.customFields.fields.delivery_timeline.label': 'Termin realizacji',
  'example.customFields.fields.delivery_timeline.description': 'Kiedy klient może oczekiwać kolejnego kroku, rozmowy lub efektów usługi.',
  'example.customFields.fields.delivery_timeline.group.title': 'Przed płatnością',
  'example.customFields.fields.delivery_timeline.group.hint': 'Wskazówka sekcji',
  'example.customFields.fields.custom_note.group.title': 'Przed płatnością',
  'example.customFields.fields.custom_note.group.hint': 'Wskazówka sekcji',
  'example.customFields.fieldsets.service_package.label': 'Pakiet usług',
  'example.customFields.fieldsets.service_package.description': 'Informacje dla klientów dotyczące konsultacji, usług i płatności za wizyty.',
  'example.customFields.fieldsets.service_package.groups.details.title': 'Przed płatnością',
  'example.customFields.fieldsets.service_package.groups.details.hint': 'Wskazówka sekcji',
}

function LocalizedCustomFieldForm({ onSubmit }: { onSubmit: jest.Mock }) {
  const translate = useT()
  const resolveCustomFieldText = React.useCallback((text: string, { path }: { path: string }) =>
    translate(`example.customFields.${path}`, text), [translate])
  return (
    <CrudForm
      embedded
      entityId="example:example_record"
      fields={[]}
      groups={[{ id: 'custom', kind: 'customFields' }]}
      initialValues={{ cf_delivery_timeline: 'Tomorrow', cf_custom_note: 'Unchanged' }}
      resolveCustomFieldText={resolveCustomFieldText}
      onSubmit={onSubmit}
    />
  )
}

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

  it.each(['pl', 'en'] as const)('localizes persisted custom-field metadata in %s and preserves custom text and values', async (locale) => {
    const entityId = 'example:example_record'
    const definition: CustomFieldDefDto = {
      entityId,
      key: 'delivery_timeline',
      kind: 'text',
      label: 'Delivery timeline',
      description: 'When the customer should expect the next step, call, or deliverable.',
      fieldset: 'service_package',
      group: { code: 'details', title: 'Before you pay', hint: 'Group hint' },
    }
    buildFormFieldFromCustomFieldDefMock.mockImplementation((field: CustomFieldDefDto) => ({
      id: `cf_${field.key}`,
      label: field.label ?? field.key,
      description: field.description,
      type: 'text',
    }))
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [],
      definitions: [definition, { ...definition, key: 'custom_note', label: 'Our custom note', description: 'Our custom hint' }],
      metadata: {
        fieldsetsByEntity: {
          [entityId]: [{
            code: 'service_package',
            label: 'Service package',
            description: 'Customer-facing details for consulting, services, and appointment-style links.',
          }],
        },
      },
    })
    const onSubmit = jest.fn()
    const polishDictionary = polishCustomFields
    const dict = locale === 'pl' ? polishDictionary : {}
    const form = (
      <LocalizedCustomFieldForm onSubmit={onSubmit} />
    )
    const { rerender } = renderWithProviders(
      <I18nProvider locale={locale} dict={dict}>{form}</I18nProvider>,
    )
    const label = locale === 'pl' ? 'Termin realizacji' : 'Delivery timeline'
    await screen.findByText(label)
    const input = screen.getByDisplayValue('Tomorrow')
    expect(input).toHaveValue('Tomorrow')
    expect(screen.getByRole('combobox')).toHaveTextContent(locale === 'pl' ? 'Pakiet usług' : 'Service package')
    expect(screen.getByText(locale === 'pl'
      ? 'Informacje dla klientów dotyczące konsultacji, usług i płatności za wizyty.'
      : 'Customer-facing details for consulting, services, and appointment-style links.')).toBeInTheDocument()
    expect(screen.getByText(locale === 'pl' ? 'Przed płatnością' : 'Before you pay')).toBeInTheDocument()
    expect(screen.getByText(locale === 'pl' ? 'Wskazówka sekcji' : 'Group hint')).toBeInTheDocument()
    expect(screen.getByText(locale === 'pl'
      ? 'Kiedy klient może oczekiwać kolejnego kroku, rozmowy lub efektów usługi.'
      : 'When the customer should expect the next step, call, or deliverable.')).toBeInTheDocument()
    expect(screen.getByText('Our custom note')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Unchanged')).toBeInTheDocument()
    expect(screen.getByText('Our custom hint')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Next week' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ cf_delivery_timeline: 'Next week', cf_custom_note: 'Unchanged' }),
      undefined,
    ))
    const nextLocale = locale === 'pl' ? 'en' : 'pl'
    rerender(
      <I18nProvider locale={nextLocale} dict={nextLocale === 'pl' ? polishDictionary : {}}>
        {form}
      </I18nProvider>,
    )
    expect(await screen.findByText(nextLocale === 'pl' ? 'Termin realizacji' : 'Delivery timeline')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent(nextLocale === 'pl' ? 'Pakiet usług' : 'Service package')
    expect(screen.getByDisplayValue('Next week')).toBeInTheDocument()
    expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(1)
    expect(definition.label).toBe('Delivery timeline')
  })

  it.each(['Support contact', 'common.save'])('keeps tenant metadata literal without an explicit resolver, including %s', async (label) => {
    const entityId = 'customers:customer_company_profile'
    buildFormFieldFromCustomFieldDefMock.mockImplementation((definition: CustomFieldDefDto) => ({
      id: `cf_${definition.key}`,
      label: definition.label,
      description: definition.description,
      type: 'text',
    }))
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      definitions: [{
        entityId, key: 'tenant_note', kind: 'text', label, description: 'Delivery timeline',
        fieldset: 'tenant_fields', group: { code: 'details', title: 'Before you pay', hint: 'Group hint' },
      }],
      metadata: { fieldsetsByEntity: { [entityId]: [{
        code: 'tenant_fields', label: 'Session format', description: 'Service package',
      }] } },
    })
    renderWithProviders(
      <CrudForm embedded entityId={entityId} fields={[]} groups={[{ id: 'custom', kind: 'customFields' }]} onSubmit={jest.fn()} />,
      { dict: {
        'Support contact': 'Unrelated translated label',
        'common.save': 'Unrelated translated label',
        'Delivery timeline': 'Unrelated translated description',
        'Session format': 'Unrelated translated fieldset',
        'Service package': 'Unrelated translated fieldset description',
        'Before you pay': 'Unrelated translated group',
        'Group hint': 'Unrelated translated hint',
      } },
    )
    expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.getByText('Delivery timeline')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent('Session format')
    expect(screen.getByText('Service package')).toBeInTheDocument()
    expect(screen.getByText('Before you pay')).toBeInTheDocument()
    expect(screen.getByText('Group hint')).toBeInTheDocument()
    expect(screen.queryByText(/Unrelated translated/)).not.toBeInTheDocument()
  })

  it('resolves fieldset group metadata when a field supplies only a group code', async () => {
    const entityId = 'example:example_record'
    buildFormFieldFromCustomFieldDefMock.mockImplementation((definition: CustomFieldDefDto) => ({
      id: `cf_${definition.key}`, label: definition.label, type: 'text',
    }))
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      definitions: [{
        entityId, key: 'delivery_timeline', kind: 'text', label: 'Delivery timeline',
        fieldset: 'service_package', group: { code: 'details' },
      }],
      metadata: { fieldsetsByEntity: { [entityId]: [{
        code: 'service_package', label: 'Service package',
        groups: [{ code: 'details', title: 'Before you pay', hint: 'Group hint' }],
      }] } },
    })
    renderWithProviders(<LocalizedCustomFieldForm onSubmit={jest.fn()} />, { dict: polishCustomFields })
    expect(await screen.findByText('Termin realizacji')).toBeInTheDocument()
    expect(screen.getByText('Przed płatnością')).toBeInTheDocument()
    expect(screen.getByText('Wskazówka sekcji')).toBeInTheDocument()
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

  it('omits custom fields with formEditable:false from the generated custom-fields section', async () => {
    buildFormFieldFromCustomFieldDefMock.mockImplementation((definition: any) => ({
      id: `cf_${definition.key}`,
      label: definition.label ?? definition.key,
      type: 'text',
    }))
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [],
      definitions: [
        {
          entityId: 'customers:customer_company_profile',
          key: 'editable_note',
          label: 'Editable note',
          kind: 'text',
          formEditable: true,
        },
        {
          entityId: 'customers:customer_company_profile',
          key: 'readonly_note',
          label: 'Readonly note',
          kind: 'text',
          formEditable: false,
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
        initialValues={{ name: 'Acme', editable_note: 'x', readonly_note: 'y' }}
        onSubmit={() => {}}
      />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'entities.customFields.manageFieldset': 'Manage fields',
        },
      },
    )

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="cf_editable_note"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-crud-field-id="cf_readonly_note"]')).toBeNull()
    expect(buildFormFieldFromCustomFieldDefMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: 'readonly_note' }),
      expect.anything(),
    )
  })

  it('submits custom entity values without loaded record metadata', async () => {
    const handleSubmit = jest.fn().mockResolvedValue(undefined)

    buildFormFieldFromCustomFieldDefMock.mockImplementation((definition: any) => ({
      id: definition.key,
      label: definition.label ?? definition.key,
      type: 'select',
      multiple: true,
      listbox: true,
      options: [
        { value: 'north', label: 'North' },
        { value: 'south', label: 'South' },
      ],
    }))
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [],
      definitions: [
        {
          entityId: 'user:qa_entity',
          key: 'regions',
          label: 'Regions',
          kind: 'dictionary',
          multi: true,
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
        title="Form"
        entityId="user:qa_entity"
        fields={[]}
        customEntity
        initialValues={{
          id: '123e4567-e89b-12d3-a456-426614174000',
          regions: ['north', 'south'],
          updatedAt: '2026-06-19T10:00:00.000Z',
          createdAt: '2026-06-19T09:00:00.000Z',
        }}
        onSubmit={handleSubmit}
      />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
        },
      },
    )

    await waitFor(() => {
      expect(screen.getByText('North')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!)
    })

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1)
    })
    expect(handleSubmit).toHaveBeenCalledWith({ regions: ['north', 'south'] }, expect.any(Object))
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
