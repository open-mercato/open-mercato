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
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn(async () => ({ ok: true, data: {} })) }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: injectedFieldWidgets, isLoading: false, error: null }),
}))

import * as React from 'react'
import { waitFor } from '@testing-library/react'
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
