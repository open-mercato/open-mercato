/** @jest-environment jsdom */
jest.setTimeout(15000)

// Injected field definitions for the CrudForm `:fields` injection spot. The
// hook is mocked so the test drives `injectedFieldDefinitions` directly without
// standing up the full injection registry/bootstrap. See issue #3047.
let injectedFieldWidgets: Array<{ fields: unknown[] }> = []

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
  // Echo the payload so `transformFormData` is a no-op and submit assertions see
  // exactly what CrudForm forwards to the host `onSubmit`.
  useInjectionSpotEvents: () => ({
    triggerEvent: jest.fn(async (_event: string, data: unknown) => ({ ok: true, data })),
  }),
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

import * as React from 'react'
import { fireEvent, waitFor } from '@testing-library/react'
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
  })

  it('honors placement when injecting a field into an existing group', async () => {
    injectedFieldWidgets = [
      {
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
