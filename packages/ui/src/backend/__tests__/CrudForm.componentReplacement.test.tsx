/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { registerComponentOverrides, type ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentOverrideProvider } from '../injection/ComponentOverrideProvider'
import { CrudForm } from '../CrudForm'
import { DataTable } from '../DataTable'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
jest.mock('../fields/registry', () => ({ loadGeneratedFieldRegistrations: async () => {} }))
afterEach(() => { registerComponentOverrides([]) })

const hosts = [
  { name: 'CrudForm', handle: 'crud-form:test.override', element: <CrudForm replacementHandle="crud-form:test.override" title="Native" fields={[{ id: 'name', label: 'Name', type: 'text' }]} initialValues={{ name: 'Original' }} /> },
  { name: 'DataTable', handle: 'data-table:test.override', element: <DataTable replacementHandle="data-table:test.override" title="Native" columns={[{ accessorKey: 'name', header: 'Name' }]} data={[{ id: 'record-1', name: 'Original' }]} /> },
]

describe.each(hosts)('$name actual replacement boundary', ({ handle, element }) => {
  it('renders the default component', () => {
    const { getByText, container } = renderWithProviders(element)
    expect(getByText('Native')).toBeInTheDocument()
    expect(container.querySelector(`[data-component-handle="${handle}"]`)).not.toBeNull()
  })
  it('applies props transforms before rendering the native component', () => {
    registerComponentOverrides([{ target: { componentId: handle }, priority: 10, propsTransform: (props: Record<string, unknown>) => ({ ...props, title: 'Transformed' }) }])
    const { getByText, queryByText } = renderWithProviders(element)
    expect(getByText('Transformed')).toBeInTheDocument()
    expect(queryByText('Native')).toBeNull()
  })
  it('wraps the native component', () => {
    registerComponentOverrides([{ target: { componentId: handle }, priority: 10, wrapper: (Original) => function Wrapped(props) { return <section data-testid="wrapped"><Original {...props} /></section> } }])
    const { getByTestId, getByText } = renderWithProviders(element)
    expect(getByTestId('wrapped')).toContainElement(getByText('Native'))
  })
  it('replaces the native component with compatible props', () => {
    registerComponentOverrides([{ target: { componentId: handle }, priority: 10, replacement: (props: Record<string, unknown>) => <section>Replacement: {String(props.title)}</section>, propsSchema: z.object({ title: z.string() }).passthrough() }])
    const { getByText, container } = renderWithProviders(element)
    expect(getByText('Replacement: Native')).toBeInTheDocument()
    expect(container.querySelector(`[data-component-handle="${handle}"]`)).toBeNull()
  })
})

it('keeps edited CrudForm state when an unrelated override arrives after bootstrap', async () => {
  const renderHost = (overrides: ComponentOverride[]) => <ComponentOverrideProvider overrides={overrides}><CrudForm replacementHandle="crud-form:test.stable" fields={[{ id: 'name', label: 'Name', type: 'text' }]} initialValues={{ name: 'Original' }} /></ComponentOverrideProvider>
  const { container, rerender } = renderWithProviders(renderHost([]))
  const input = container.querySelector('[data-crud-field-id="name"] input')!
  fireEvent.change(input, { target: { value: 'Typed' } })
  rerender(renderHost([{ target: { componentId: 'unrelated.component' }, priority: 10, propsTransform: (props) => props }]))
  await waitFor(() => expect(container.querySelector('[data-crud-field-id="name"] input')).toHaveValue('Typed'))
  expect(container.querySelector('[data-crud-field-id="name"] input')).toBe(input)
})
