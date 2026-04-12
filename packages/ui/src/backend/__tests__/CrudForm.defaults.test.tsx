/** @jest-environment jsdom */

const fetchCustomFieldFormStructureMock = jest.fn()
const buildFormFieldFromCustomFieldDefMock = jest.fn()

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
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const dict = {
  'ui.forms.actions.save': 'Save',
}

function setupMockDefinitions(definitions: Array<Record<string, unknown>>) {
  buildFormFieldFromCustomFieldDefMock.mockImplementation((def: Record<string, unknown>) => {
    if (def.kind === 'boolean') return { id: `cf_${def.key}`, label: String(def.label || def.key), type: 'checkbox' }
    return { id: `cf_${def.key}`, label: String(def.label || def.key), type: 'text' }
  })
  fetchCustomFieldFormStructureMock.mockResolvedValue({
    fields: [],
    definitions,
    metadata: { items: definitions, fieldsetsByEntity: {}, entitySettings: {} },
  })
}

describe('CrudForm custom field default application', () => {
  const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]

  beforeEach(() => {
    fetchCustomFieldFormStructureMock.mockReset()
    buildFormFieldFromCustomFieldDefMock.mockReset()
    buildFormFieldFromCustomFieldDefMock.mockReturnValue(null)
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [],
      definitions: [],
      metadata: { items: [], fieldsetsByEntity: {}, entitySettings: {} },
    })
  })

  it('applies defaultValue to text inputs on create form', async () => {
    setupMockDefinitions([
      { key: 'status', kind: 'text', label: 'Status', defaultValue: 'active', formEditable: true },
    ])

    renderWithProviders(
      <CrudForm
        title="Create"
        entityId="test:entity"
        fields={fields}
        initialValues={{ name: 'Test' }}
        onSubmit={() => {}}
      />,
      { dict },
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const statusInput = screen.queryByDisplayValue('active')
    expect(statusInput).toBeInTheDocument()
  })

  it('does not apply defaults on edit form (when initialValues has id)', async () => {
    setupMockDefinitions([
      { key: 'status', kind: 'text', label: 'Status', defaultValue: 'active', formEditable: true },
    ])

    renderWithProviders(
      <CrudForm
        title="Edit"
        entityId="test:entity"
        fields={fields}
        initialValues={{ id: 'record-1', name: 'Test' } as any}
        onSubmit={() => {}}
      />,
      { dict },
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const statusInput = screen.queryByDisplayValue('active')
    expect(statusInput).toBeNull()
  })

  it('does not overwrite explicit initialValues with defaults', async () => {
    setupMockDefinitions([
      { key: 'status', kind: 'text', label: 'Status', defaultValue: 'active', formEditable: true },
    ])

    renderWithProviders(
      <CrudForm
        title="Create"
        entityId="test:entity"
        fields={fields}
        initialValues={{ name: 'Test', cf_status: 'inactive' } as any}
        onSubmit={() => {}}
      />,
      { dict },
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const inactiveInput = screen.queryByDisplayValue('inactive')
    expect(inactiveInput).toBeInTheDocument()
    const activeInput = screen.queryByDisplayValue('active')
    expect(activeInput).toBeNull()
  })

  it('does not apply defaults while isLoading is true (async edit page)', async () => {
    setupMockDefinitions([
      { key: 'status', kind: 'text', label: 'Status', defaultValue: 'active', formEditable: true },
    ])

    // Simulate an async edit page: starts with isLoading=true and empty initialValues
    const { rerender } = renderWithProviders(
      <CrudForm
        title="Edit"
        entityId="test:entity"
        fields={fields}
        initialValues={{}}
        isLoading={true}
        onSubmit={() => {}}
      />,
      { dict },
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // While loading, defaults must not be applied
    expect(screen.queryByDisplayValue('active')).toBeNull()

    // Now simulate record arriving: isLoading=false, initialValues gets id
    await act(async () => {
      rerender(
        <CrudForm
          title="Edit"
          entityId="test:entity"
          fields={fields}
          initialValues={{ id: 'record-1', name: 'Loaded' } as any}
          isLoading={false}
          onSubmit={() => {}}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // After loading completes with an id, defaults should still not be applied (edit mode)
    expect(screen.queryByDisplayValue('active')).toBeNull()
  })
})
