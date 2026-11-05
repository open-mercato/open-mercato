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
import { act, waitFor } from '@testing-library/react'
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
    triggerInjectionEventMock.mockClear()
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
