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
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const ENTITY_ID = 'resources:resources_resource'
const GENERAL_CODE = 'resources_resource_general'
const LAPTOP_CODE = 'resources_resource_laptop'

const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]
const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', fields: ['name'] },
  { id: 'custom', title: 'Custom fields', kind: 'customFields' },
]

function configureTwoFieldsets() {
  buildFormFieldFromCustomFieldDefMock.mockImplementation((definition: any) => ({
    id: `cf_${definition.key}`,
    label: definition.label ?? definition.key,
    type: 'text',
  }))
  fetchCustomFieldFormStructureMock.mockResolvedValue({
    fields: [],
    definitions: [
      {
        entityId: ENTITY_ID,
        key: 'asset_tag',
        label: 'Asset tag',
        kind: 'text',
        fieldsets: [GENERAL_CODE],
      },
      {
        entityId: ENTITY_ID,
        key: 'serial_number',
        label: 'Serial number',
        kind: 'text',
        fieldsets: [LAPTOP_CODE],
      },
      {
        entityId: ENTITY_ID,
        key: 'notes',
        label: 'Notes',
        kind: 'text',
      },
    ],
    metadata: {
      items: [],
      fieldsetsByEntity: {
        [ENTITY_ID]: [
          { code: GENERAL_CODE, label: 'General' },
          { code: LAPTOP_CODE, label: 'Laptops' },
        ],
      },
      entitySettings: {
        [ENTITY_ID]: { singleFieldsetPerRecord: true },
      },
    },
  })
}

function DelayedHost({
  initialValues,
}: {
  initialValues: Record<string, unknown> | undefined
}) {
  return (
    <CrudForm
      embedded
      title="Resource"
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      customFieldsetBindings={{ [ENTITY_ID]: { valueKey: 'customFieldsetCode' } }}
      initialValues={initialValues ?? undefined}
      isLoading={!initialValues}
      onSubmit={() => {}}
    />
  )
}

describe('CrudForm customFieldsetBindings hydration', () => {
  beforeEach(() => {
    fetchCustomFieldFormStructureMock.mockReset()
    buildFormFieldFromCustomFieldDefMock.mockReset()
    triggerInjectionEventMock.mockReset()
    triggerInjectionEventMock.mockImplementation(async (_event: string, data: Record<string, unknown>) => ({ ok: true, data }))
    configureTwoFieldsets()
  })

  it('activates the persisted fieldset when initialValues arrive after fieldset metadata loads', async () => {
    // Mirrors the resources edit page: the record (and its persisted
    // customFieldsetCode) loads asynchronously AFTER custom-field metadata has
    // already resolved (gated behind resourceTypesLoaded), so the fieldset
    // selector is hydrated only via the binding, never via a user interaction.
    const { container, rerender } = renderWithProviders(
      <DelayedHost initialValues={undefined} />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )

    await waitFor(() => {
      expect(fetchCustomFieldFormStructureMock).toHaveBeenCalled()
    })

    await act(async () => {
      rerender(
        <DelayedHost
          initialValues={{ id: 'res-1', name: 'Engineering Laptop 1', customFieldsetCode: LAPTOP_CODE }}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="cf_serial_number"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-crud-field-id="cf_asset_tag"]')).toBeNull()
  })
})

describe('CrudForm customFieldsetAllowlist', () => {
  beforeEach(() => {
    fetchCustomFieldFormStructureMock.mockReset()
    buildFormFieldFromCustomFieldDefMock.mockReset()
    triggerInjectionEventMock.mockReset()
    triggerInjectionEventMock.mockImplementation(async (_event: string, data: Record<string, unknown>) => ({ ok: true, data }))
    configureTwoFieldsets()
  })

  it('renders only allowed fieldset sections and updates when the allowlist changes', async () => {
    function Host({ allowlist }: { allowlist?: readonly string[] }) {
      return (
        <CrudForm
          embedded
          title="Resource"
          entityId={ENTITY_ID}
          fields={fields}
          groups={groups}
          customFieldsetAllowlist={allowlist === undefined ? undefined : { [ENTITY_ID]: allowlist }}
          onSubmit={() => {}}
        />
      )
    }

    const { container, rerender } = renderWithProviders(<Host allowlist={[GENERAL_CODE]} />)
    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="cf_asset_tag"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-crud-field-id="cf_serial_number"]')).toBeNull()
    expect(container.querySelector('[data-crud-field-id="cf_notes"]')).toBeNull()
    expect(container.querySelector('[role="combobox"]')).toBeNull()

    rerender(<Host allowlist={[GENERAL_CODE, LAPTOP_CODE, '__general__']} />)
    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="cf_asset_tag"]')).not.toBeNull()
      expect(container.querySelector('[data-crud-field-id="cf_serial_number"]')).not.toBeNull()
      expect(container.querySelector('[data-crud-field-id="cf_notes"]')).not.toBeNull()
    })
    expect(container.querySelector('[role="combobox"]')).toBeNull()

    rerender(<Host allowlist={[]} />)
    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="cf_serial_number"]')).toBeNull()
      expect(container.querySelector('[data-crud-field-id="cf_notes"]')).toBeNull()
    })
    expect(container.querySelector('[data-crud-field-id="cf_asset_tag"]')).toBeNull()

    rerender(<Host />)
    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="cf_asset_tag"]')).not.toBeNull()
      expect(container.querySelector('[data-crud-field-id="cf_notes"]')).not.toBeNull()
    })
    expect(container.querySelector('[role="combobox"]')).not.toBeNull()
  })

  it('submits only active custom fields while retaining hidden edit values for a later type switch', async () => {
    const onSubmit = jest.fn()
    function Host({ allowlist }: { allowlist: readonly string[] }) {
      return (
        <CrudForm
          embedded
          title="Resource"
          entityId={ENTITY_ID}
          fields={fields}
          groups={groups}
          customFieldsetAllowlist={{ [ENTITY_ID]: allowlist }}
          initialValues={{ id: 'res-1', name: 'Laptop', cf_asset_tag: 'ASSET-1', cf_serial_number: 'SERIAL-1' }}
          onSubmit={onSubmit}
        />
      )
    }

    const { container, rerender } = renderWithProviders(<Host allowlist={[GENERAL_CODE]} />)
    await waitFor(() => expect(container.querySelector('[data-crud-field-id="cf_asset_tag"]')).not.toBeNull())
    await act(async () => { fireEvent.submit(container.querySelector('form') as HTMLFormElement) })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ cf_asset_tag: 'ASSET-1' })
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('cf_serial_number')

    rerender(<Host allowlist={[LAPTOP_CODE]} />)
    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="cf_serial_number"] input')).toHaveValue('SERIAL-1')
    })
  })
})

describe('CrudForm calendar widget errors', () => {
  it('clears widget field errors after the selected event type changes', async () => {
    triggerInjectionEventMock.mockReset()
    triggerInjectionEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) =>
      event === 'onBeforeSave'
        ? { ok: false, fieldErrors: { name: 'Unavailable' } }
        : { ok: true, data },
    )
    function Host({ eventType }: { eventType: string }) {
      return (
        <CrudForm
          embedded
          title="Event"
          fields={fields}
          initialValues={{ name: 'Meeting' }}
          injectionSpotId="crud-form:customers.customer_interaction"
          calendarEventTypeKey={eventType}
          onSubmit={() => {}}
        />
      )
    }
    const { container, rerender } = renderWithProviders(<Host eventType="visit" />)
    await act(async () => { fireEvent.submit(container.querySelector('form') as HTMLFormElement) })
    await waitFor(() => expect(container.querySelector('[data-crud-field-id="name"]')).toHaveTextContent('Unavailable'))
    rerender(<Host eventType="meeting" />)
    await waitFor(() => expect(container.querySelector('[data-crud-field-id="name"]')).not.toHaveTextContent('Unavailable'))
  })
})
