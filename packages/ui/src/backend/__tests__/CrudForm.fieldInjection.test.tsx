/** @jest-environment jsdom */
jest.setTimeout(15000)

// Injected field definitions for the CrudForm `:fields` injection spot. The
// hook is mocked so the test drives `injectedFieldDefinitions` directly without
// standing up the full injection registry/bootstrap. See issue #3047.
let injectedFieldWidgets: Array<Record<string, unknown> & { fields: unknown[] }> = []
const withScopedApiRequestBodyMock = jest.fn(async (_payload: unknown, run: () => Promise<unknown>) => run())
let capturedEventWidgets: Array<{ widgetId: string; module: { eventHandlers?: Record<string, unknown> } }> = []
let transformFormDataOverride: ((data: unknown) => unknown) | null = null

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: (_spotId: string, widgets?: typeof capturedEventWidgets) => {
    capturedEventWidgets = widgets ?? []
    return {
      triggerEvent: jest.fn(async (event: string, data: unknown) => ({
        ok: true,
        data: event === 'transformFormData' && transformFormDataOverride
          ? transformFormDataOverride(data)
          : data,
      })),
    }
  },
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  // `CrudForm` also calls this for its (unused-here) legacy-bridge spot, which
  // resolves to the `__disabled__:fields` sentinel — keep that call empty so it
  // does not double up on the fixture below.
  useInjectionDataWidgets: (spotId: string) => ({
    widgets: spotId.startsWith('__disabled__') ? [] : injectedFieldWidgets,
    isLoading: false,
    error: null,
  }),
}))
jest.mock('../utils/apiCall', () => {
  const actual = jest.requireActual('../utils/apiCall')
  return {
    ...actual,
    withScopedApiRequestBody: (...args: unknown[]) => withScopedApiRequestBodyMock(args[0], args[1] as () => Promise<unknown>),
  }
})

import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

const baseFields: CrudField[] = [
  { id: 'firstName', label: 'First name', type: 'text' },
  { id: 'lastName', label: 'Last name', type: 'text' },
  // A trailing field so that "after lastName" is distinct from "end of group":
  // the buggy unconditional push would land the injected field after `email`.
  { id: 'email', label: 'Email', type: 'text' },
]

const groups: CrudFormGroup[] = [
  { id: 'personalData', label: 'Personal data', fields: ['firstName', 'lastName', 'email'] },
]

function orderedFieldIds(container: HTMLElement): string[] {
  const seen: string[] = []
  container.querySelectorAll('[data-crud-field-id]').forEach((node) => {
    const id = node.getAttribute('data-crud-field-id')
    if (id && !seen.includes(id)) seen.push(id)
  })
  return seen
}

describe('CrudForm group field injection (#3047)', () => {
  afterEach(() => {
    injectedFieldWidgets = []
    withScopedApiRequestBodyMock.mockClear()
    capturedEventWidgets = []
    transformFormDataOverride = null
  })

  it('honors placement when injecting a field into an existing group', async () => {
    injectedFieldWidgets = [
      {
        moduleId: 'relations',
        fields: [
          {
            id: 'cf:middle_name',
            label: 'Middle name',
            type: 'text',
            group: 'personalData',
            placement: { position: InjectionPosition.After, relativeTo: 'lastName' },
          },
        ],
      },
    ]

    const { container } = renderWithProviders(
      React.createElement(CrudForm as any, {
        title: 'Form',
        entityId: 'customers:person',
        fields: baseFields,
        groups,
        onSubmit: () => {},
      }),
    )

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="cf:middle_name"]')).toBeTruthy()
    })

    const ids = orderedFieldIds(container)
    const lastNameIdx = ids.indexOf('lastName')
    const middleIdx = ids.indexOf('cf:middle_name')
    const firstNameIdx = ids.indexOf('firstName')
    const emailIdx = ids.indexOf('email')
    expect(firstNameIdx).toBeGreaterThanOrEqual(0)
    expect(lastNameIdx).toBeGreaterThan(firstNameIdx)
    // Injected field lands directly after `lastName` (placement honored), not at
    // the end of the group after `email` (the pre-fix append behavior).
    expect(middleIdx).toBe(lastNameIdx + 1)
    expect(emailIdx).toBe(middleIdx + 1)
  })

  it('renders the injected field label exactly once', async () => {
    injectedFieldWidgets = [
      {
        moduleId: 'relations',
        fields: [
          {
            id: 'cf:middle_name',
            label: 'Middle name',
            type: 'text',
            group: 'personalData',
            placement: { position: InjectionPosition.After, relativeTo: 'lastName' },
          },
        ],
      },
    ]

    const { container } = renderWithProviders(
      React.createElement(CrudForm as any, {
        title: 'Form',
        entityId: 'customers:person',
        fields: baseFields,
        groups,
        onSubmit: () => {},
      }),
    )

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="cf:middle_name"]')).toBeTruthy()
    })

    const labelMatches = Array.from(container.querySelectorAll('label')).filter(
      (node) => node.textContent?.trim() === 'Middle name',
    )
    expect(labelMatches).toHaveLength(1)
  })

  it('scopes active injected field values around the host submit callback', async () => {
    injectedFieldWidgets = [{
      moduleId: 'customer_relations',
      fields: [{ id: 'relatedPersonId', label: 'Related person', type: 'text', group: 'personalData' }],
    }]
    const onSubmit = jest.fn(async () => undefined)

    const { container } = renderWithProviders(
      React.createElement(CrudForm as any, {
        title: 'Form',
        entityId: 'customers:person',
        fields: baseFields,
        groups,
        initialValues: { relatedPersonId: 'person-1' },
        onSubmit,
      }),
    )

    await waitFor(() => expect(container.querySelector('[data-crud-field-id="relatedPersonId"]')).toBeTruthy())
    fireEvent.change(container.querySelector('[data-crud-field-id="relatedPersonId"] input') as HTMLInputElement, {
      target: { value: 'person-2' },
    })
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    expect(withScopedApiRequestBodyMock).toHaveBeenCalledWith({
      customer_relations: { relatedPersonId: 'person-2' },
    }, expect.any(Function))
  })

  it('scopes the transformed injected value rather than the stale form value', async () => {
    injectedFieldWidgets = [{
      moduleId: 'customer_relations',
      fields: [{ id: 'relatedPersonId', label: 'Related person', type: 'text', group: 'personalData' }],
    }]
    transformFormDataOverride = (data) => ({
      ...(data as Record<string, unknown>),
      relatedPersonId: 'person-normalized',
    })
    const onSubmit = jest.fn(async () => undefined)

    const { container } = renderWithProviders(
      React.createElement(CrudForm as any, {
        title: 'Form',
        entityId: 'customers:person',
        fields: baseFields,
        groups,
        initialValues: { relatedPersonId: 'person-raw' },
        onSubmit,
      }),
    )

    await waitFor(() => expect(container.querySelector('[data-crud-field-id="relatedPersonId"]')).toBeTruthy())
    await act(async () => {
      ;(container.querySelector('form') as HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    expect(withScopedApiRequestBodyMock).toHaveBeenCalledWith({
      customer_relations: { relatedPersonId: 'person-normalized' },
    }, expect.any(Function))
  })

  it('does not scope an injected value whose entire group is hidden', async () => {
    injectedFieldWidgets = [{
      moduleId: 'customer_relations',
      fields: [{ id: 'relatedPersonId', label: 'Related person', type: 'text', group: 'personalData' }],
    }]
    const onSubmit = jest.fn(async () => undefined)

    const { container } = renderWithProviders(
      React.createElement(CrudForm as any, {
        title: 'Form',
        entityId: 'customers:person',
        fields: baseFields,
        groups,
        hiddenGroupIds: ['personalData'],
        initialValues: { relatedPersonId: 'person-hidden' },
        onSubmit,
      }),
    )

    await act(async () => {
      ;(container.querySelector('form') as HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    expect(withScopedApiRequestBodyMock).not.toHaveBeenCalled()
  })

  it('renders a group-kind injection targeting an undeclared group as its own card, even when the last group is customFields (#6142)', async () => {
    const onBeforeSave = jest.fn(async () => ({ ok: true }))
    injectedFieldWidgets = [
      {
        metadata: { id: 'wms.injection.catalog-inventory-profile' },
        moduleId: 'wms',
        key: 'wms:catalog-inventory-profile',
        placement: { kind: 'group', column: 2, groupLabel: 'Inventory profile', groupDescription: 'Warehouse settings', priority: 120 },
        fields: [
          { id: 'wms.manageInventory', label: 'Manage inventory with WMS', type: 'boolean', group: 'wms.inventoryProfile' },
          { id: 'wms.safetyStock', label: 'Safety stock', type: 'number', group: 'wms.inventoryProfile' },
        ],
        eventHandlers: { onBeforeSave },
      },
    ]

    const { container, getByText } = renderWithProviders(
      React.createElement(CrudForm as any, {
        title: 'Form',
        entityId: 'catalog:catalog_product',
        fields: baseFields,
        groups: [
          ...groups,
          { id: 'custom', title: 'Custom attributes', column: 2, kind: 'customFields' },
        ],
        onSubmit: () => {},
      }),
    )

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="wms.manageInventory"]')).toBeTruthy()
    })
    expect(container.querySelector('[data-crud-field-id="wms.safetyStock"]')).toBeTruthy()
    expect(getByText('Inventory profile')).toBeTruthy()
    expect(getByText('Warehouse settings')).toBeTruthy()
    expect(orderedFieldIds(container).slice(0, 3)).toEqual(['firstName', 'lastName', 'email'])
  })

  it('dispatches injection events to field widgets that declare event handlers (#6142)', async () => {
    const onBeforeSave = jest.fn(async () => ({ ok: true }))
    injectedFieldWidgets = [
      {
        metadata: { id: 'wms.injection.catalog-inventory-profile' },
        moduleId: 'wms',
        key: 'wms:catalog-inventory-profile',
        fields: [{ id: 'wms.manageInventory', label: 'Manage inventory with WMS', type: 'boolean', group: 'personalData' }],
        eventHandlers: { onBeforeSave },
      },
      {
        metadata: { id: 'example.injection.handlerless-field' },
        moduleId: 'example',
        key: 'example:handlerless-field',
        fields: [{ id: 'example.note', label: 'Note', type: 'text', group: 'personalData' }],
      },
    ]

    renderWithProviders(
      React.createElement(CrudForm as any, {
        title: 'Form',
        entityId: 'catalog:catalog_product',
        fields: baseFields,
        groups,
        onSubmit: () => {},
      }),
    )

    await waitFor(() => {
      expect(capturedEventWidgets.map((widget) => widget.widgetId)).toEqual(['wms.injection.catalog-inventory-profile'])
    })
    const handlers = capturedEventWidgets[0].module.eventHandlers as Record<string, (...args: unknown[]) => unknown>
    expect(handlers.onBeforeSave).toBe(onBeforeSave)
    for (const deleteEvent of ['onBeforeDelete', 'onDelete', 'onAfterDelete']) {
      expect(typeof handlers[deleteEvent]).toBe('function')
      await handlers[deleteEvent]({})
    }
    expect(onBeforeSave).not.toHaveBeenCalled()
  })
})

describe('CrudForm injected field id collisions', () => {
  afterEach(() => {
    injectedFieldWidgets = []
  })

  function renderCollisionForm(options: {
    fields: CrudField[]
    initialValues: Record<string, unknown>
    onSubmit: (values: unknown) => void
    schema?: z.ZodTypeAny
  }) {
    return renderWithProviders(
      React.createElement(CrudForm as any, {
        title: 'Form',
        entityId: 'catalog:catalog_product_price',
        fields: options.fields,
        groups: [{ id: 'scope', title: 'Scope', fields: options.fields.map((field) => field.id) }],
        initialValues: options.initialValues,
        schema: options.schema,
        onSubmit: options.onSubmit,
      }),
    )
  }

  it('submits the value of an injected field that reuses a host field id', async () => {
    injectedFieldWidgets = [
      { fields: [{ id: 'customerGroupId', label: 'Customer group', type: 'text', group: 'scope' }] },
    ]
    const onSubmit = jest.fn()
    const { container } = renderCollisionForm({
      fields: [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'customerGroupId', label: 'Customer group id', type: 'text' },
      ],
      initialValues: { name: 'Retail', customerGroupId: 'group-1' },
      onSubmit,
    })

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: 'Retail', customerGroupId: 'group-1' }),
    )
  })

  it('submits the value of an injected field that reuses a group-inline host field id', async () => {
    injectedFieldWidgets = [
      { fields: [{ id: 'customerGroupId', label: 'Customer group', type: 'text', group: 'scope' }] },
    ]
    const onSubmit = jest.fn()
    const { container } = renderWithProviders(
      React.createElement(CrudForm as any, {
        title: 'Form',
        entityId: 'catalog:catalog_product_price',
        fields: [{ id: 'name', label: 'Name', type: 'text' }],
        groups: [
          {
            id: 'scope',
            title: 'Scope',
            fields: ['name', { id: 'customerGroupId', label: 'Customer group id', type: 'text' }],
          },
        ],
        initialValues: { name: 'Retail', customerGroupId: 'group-1' },
        onSubmit,
      }),
    )

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="customerGroupId"]')).toBeTruthy()
    })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: 'Retail', customerGroupId: 'group-1' }),
    )
  })

  it('still strips an injected-only field from the host payload', async () => {
    injectedFieldWidgets = [
      { fields: [{ id: 'widgetOnlyNote', label: 'Widget note', type: 'text', group: 'scope' }] },
    ]
    const onSubmit = jest.fn()
    const { container } = renderCollisionForm({
      fields: [{ id: 'name', label: 'Name', type: 'text' }],
      initialValues: { name: 'Retail', widgetOnlyNote: 'extra' },
      onSubmit,
    })

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="widgetOnlyNote"]')).toBeTruthy()
    })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const submitted = onSubmit.mock.calls[0][0] as Record<string, unknown>
    expect(submitted.name).toBe('Retail')
    expect(submitted).not.toHaveProperty('widgetOnlyNote')
  })

  it('collapses a dot-path host field that an injected field reuses into its nested shape', async () => {
    injectedFieldWidgets = [
      { fields: [{ id: 'metadata.channel', label: 'Channel', type: 'text', group: 'scope' }] },
    ]
    const onSubmit = jest.fn()
    const { container } = renderCollisionForm({
      fields: [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'metadata.channel', label: 'Channel', type: 'text' },
      ],
      initialValues: { name: 'Retail', metadata: { channel: 'web' } },
      schema: z.object({
        name: z.string(),
        metadata: z.object({ channel: z.string() }).optional(),
      }),
      onSubmit,
    })

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="metadata.channel"] input')).toBeTruthy()
    })
    const channelInput = container.querySelector('[data-crud-field-id="metadata.channel"] input') as HTMLInputElement
    await waitFor(() => expect(channelInput.value).toBe('web'))
    fireEvent.change(channelInput, { target: { value: 'store' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toEqual({ name: 'Retail', metadata: { channel: 'store' } })
  })
})
