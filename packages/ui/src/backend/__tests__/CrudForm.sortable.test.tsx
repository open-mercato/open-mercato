/** @jest-environment jsdom */
jest.setTimeout(15000)

const triggerInjectionEventMock = jest.fn(async (_event: string, data: Record<string, unknown>) => ({
  ok: true,
  data,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))
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

import * as React from 'react'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'note', label: 'Note', type: 'text' },
]

const groups: CrudFormGroup[] = [
  { id: 'main', title: 'Main', fields: ['name'], column: 1 },
  { id: 'extra', title: 'Extra', fields: ['note'], column: 1 },
]

describe('CrudForm sortable groups', () => {
  it('renders a drag handle button with the expected aria-label when sortable + collapsible', () => {
    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        groups={groups}
        onSubmit={() => {}}
        sortableGroups={true}
        collapsibleGroups={true}
      />,
    )
    const handles = container.querySelectorAll('button[aria-label="Drag to reorder"]')
    expect(handles.length).toBe(2)
  })

  it('does not render any drag handle when sortable is disabled', () => {
    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        groups={groups}
        onSubmit={() => {}}
        collapsibleGroups={true}
      />,
    )
    const handles = container.querySelectorAll('button[aria-label="Drag to reorder"]')
    expect(handles.length).toBe(0)
  })

  it('does not greys out a sortable card when space is pressed from a focused input', () => {
    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        groups={groups}
        initialValues={{ name: '' }}
        onSubmit={() => {}}
        sortableGroups={true}
        collapsibleGroups={true}
      />,
    )
    const input = container.querySelector('[data-crud-field-id="name"] input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()
    input.focus()
    fireEvent.keyDown(input, { key: ' ', code: 'Space' })
    const sortableHandles = container.querySelectorAll('button[aria-label="Drag to reorder"]')
    expect(sortableHandles.length).toBeGreaterThan(0)
    sortableHandles.forEach((handle) => {
      const card = handle.closest('[style]') as HTMLElement | null
      const style = card?.getAttribute('style') || ''
      expect(style).not.toMatch(/opacity:\s*0\.5/)
    })
  })
})
