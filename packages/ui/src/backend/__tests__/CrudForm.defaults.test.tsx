/** @jest-environment jsdom */

const fetchCustomFieldFormStructureMock = jest.fn()
const fetchCustomFieldDefsMock = jest.fn()
const buildFormFieldFromCustomFieldDefMock = jest.fn()

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
jest.mock('../utils/customFieldDefs', () => ({
  ...jest.requireActual('../utils/customFieldDefs'),
  fetchCustomFieldDefs: (...args: unknown[]) => fetchCustomFieldDefsMock(...args),
}))

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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
    fetchCustomFieldDefsMock.mockReset()
    buildFormFieldFromCustomFieldDefMock.mockReset()
    buildFormFieldFromCustomFieldDefMock.mockReturnValue(null)
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [],
      definitions: [],
      metadata: { items: [], fieldsetsByEntity: {}, entitySettings: {} },
    })
  })

  it('forwards explicit title heading semantics while preserving the section-level default', () => {
    const { rerender } = renderWithProviders(
      <CrudForm
        title="Edit"
        fields={fields}
        initialValues={{ name: 'Test' }}
        onSubmit={() => {}}
      />,
      { dict },
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Edit' })).toBeInTheDocument()

    rerender(
      <CrudForm
        title="Edit"
        titleHeadingLevel={1}
        fields={fields}
        initialValues={{ name: 'Test' }}
        onSubmit={() => {}}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Edit' })).toBeInTheDocument()
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

  it.each(['high', null])('keeps the initial custom field alias %s on early submit and on load', async (severity) => {
    const definitions = [
      { key: 'severity', kind: 'text', label: 'Severity', defaultValue: 'medium', formEditable: true },
      { key: 'priority', kind: 'integer', label: 'Priority', defaultValue: 3, formEditable: true, required: true },
    ]
    setupMockDefinitions(definitions)
    const { promise, resolve } = Promise.withResolvers<{
      fields: CrudField[]
      definitions: typeof definitions
      metadata: { items: typeof definitions }
    }>()
    fetchCustomFieldFormStructureMock.mockReturnValueOnce(promise)
    fetchCustomFieldDefsMock.mockResolvedValueOnce(definitions)
    const onSubmit = jest.fn()
    renderWithProviders(
      <CrudForm
        title="Create"
        entityId="test:entity"
        fields={fields}
        initialValues={{ name: 'Test', 'cf:severity': severity }}
        onSubmit={onSubmit}
      />,
      { dict },
    )

    await waitFor(() => expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(1))
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      cf_priority: 3, cf_severity: severity,
    }), undefined))
    expect(fetchCustomFieldDefsMock).toHaveBeenCalledTimes(1)

    await act(async () => resolve({ fields: [], definitions, metadata: { items: definitions } }))
    expect(await screen.findByRole('textbox', { name: 'Severity' })).toHaveValue(severity ?? '')
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
