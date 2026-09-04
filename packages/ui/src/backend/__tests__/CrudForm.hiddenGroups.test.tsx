/** @jest-environment jsdom */
jest.setTimeout(15000)

// Coverage for `hiddenGroupIds` (#5876): a host may omit declared groups by their
// stable id. Hiding is presentation-only — the fields of a hidden group keep their
// values and are still submitted, so a smaller form can never silently clear data.
let injectedGroupWidgets: unknown[] = []
let injectedFieldWidgets: Array<{ fields: unknown[] }> = []
const fetchCustomFieldFormStructureMock = jest.fn()
const buildFormFieldFromCustomFieldDefMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: injectedGroupWidgets, loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn(async () => ({ ok: true, data: {} })) }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: injectedFieldWidgets, isLoading: false, error: null }),
}))
jest.mock('../utils/customFieldForms', () => ({
  __esModule: true,
  buildFormFieldFromCustomFieldDef: (...args: unknown[]) => buildFormFieldFromCustomFieldDefMock(...args),
  buildFormFieldsFromCustomFields: jest.fn(() => []),
  fetchCustomFieldFormStructure: (...args: unknown[]) => fetchCustomFieldFormStructureMock(...args),
}))

import * as React from 'react'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'legalName', label: 'Legal name', type: 'text' },
  { id: 'note', label: 'Note', type: 'text' },
]

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['name'] },
  { id: 'profile', title: 'Profile', column: 1, fields: ['legalName'] },
  { id: 'notes', title: 'Notes', column: 2, fields: ['note'] },
]

const initialValues = { name: 'Acme', legalName: 'Acme Sp. z o.o.', note: 'hello' }

type RenderOptions = {
  hiddenGroupIds?: readonly string[]
  onSubmit?: (values: unknown) => void
  formGroups?: CrudFormGroup[]
  formFields?: CrudField[]
  formInitialValues?: Record<string, unknown>
  noGroups?: boolean
  entityId?: string
  collapsibleGroups?: boolean
  sortableGroups?: boolean
}

function renderForm(options: RenderOptions = {}) {
  return renderWithProviders(
    <CrudForm
      title="Company"
      fields={options.formFields ?? fields}
      groups={options.noGroups ? undefined : (options.formGroups ?? groups)}
      entityId={options.entityId}
      initialValues={options.formInitialValues ?? initialValues}
      hiddenGroupIds={options.hiddenGroupIds}
      collapsibleGroups={options.collapsibleGroups}
      sortableGroups={options.sortableGroups}
      onSubmit={options.onSubmit ?? (() => {})}
    />,
  )
}

// Group cards render their title in a `text-sm font-medium` div; every rendered
// field control is wrapped in a `data-crud-field-id` node.
function groupTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('div.text-sm.font-medium'))
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean)
}

function fieldIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-crud-field-id]'))
    .map((node) => node.getAttribute('data-crud-field-id') ?? '')
    .filter(Boolean)
}

function submitForm(container: HTMLElement) {
  fireEvent.submit(container.querySelector('form') as HTMLFormElement)
}

describe('CrudForm hiddenGroupIds', () => {
  afterEach(() => {
    injectedGroupWidgets = []
    injectedFieldWidgets = []
    fetchCustomFieldFormStructureMock.mockReset()
    buildFormFieldFromCustomFieldDefMock.mockReset()
  })

  describe('absence preserves existing behavior', () => {
    it('renders every declared group when the prop is omitted', () => {
      const { container } = renderForm()
      expect(groupTitles(container)).toEqual(expect.arrayContaining(['Details', 'Profile', 'Notes']))
      expect(fieldIds(container)).toEqual(['name', 'legalName', 'note'])
    })

    it('renders identically for an omitted prop and an empty array', () => {
      // React's useId yields a fresh form id per render, so normalize it away —
      // everything else must match byte for byte.
      const normalize = (html: string) => html.replace(/_r_[0-9a-z]+_/g, '_r_id_')
      const omitted = normalize(renderForm().container.innerHTML)
      const empty = normalize(renderForm({ hiddenGroupIds: [] }).container.innerHTML)
      expect(empty).toBe(omitted)
    })

    it('still uses the flat layout for a form that declares no groups at all', () => {
      const { container } = renderForm({ noGroups: true })
      expect(fieldIds(container)).toEqual(['name', 'legalName', 'note'])
      expect(groupTitles(container)).not.toContain('Details')
    })
  })

  describe('hiding by stable id', () => {
    it('removes only the named group and leaves its siblings untouched', () => {
      const { container } = renderForm({ hiddenGroupIds: ['profile'] })
      const titles = groupTitles(container)
      expect(titles).toEqual(expect.arrayContaining(['Details', 'Notes']))
      expect(titles).not.toContain('Profile')
      expect(fieldIds(container)).toEqual(['name', 'note'])
    })

    it('hides several groups at once', () => {
      const { container } = renderForm({ hiddenGroupIds: ['profile', 'notes'] })
      const titles = groupTitles(container)
      expect(titles).toContain('Details')
      expect(titles).not.toContain('Profile')
      expect(titles).not.toContain('Notes')
      expect(fieldIds(container)).toEqual(['name'])
    })

    it('ignores an id that matches no declared group', () => {
      const { container } = renderForm({ hiddenGroupIds: ['does-not-exist'] })
      expect(groupTitles(container)).toEqual(expect.arrayContaining(['Details', 'Profile', 'Notes']))
      expect(fieldIds(container)).toEqual(['name', 'legalName', 'note'])
    })

    it('does not fall back to the flat field list when every group is hidden', () => {
      const { container } = renderForm({ hiddenGroupIds: ['details', 'profile', 'notes'] })
      expect(fieldIds(container)).toEqual([])
      const titles = groupTitles(container)
      expect(titles).not.toContain('Details')
      expect(titles).not.toContain('Profile')
      expect(titles).not.toContain('Notes')
    })

    it('drops the secondary column when the only column-2 group is hidden', () => {
      const findSidebarGrid = (root: HTMLElement) =>
        Array.from(root.querySelectorAll('div')).find((node) => node.className.includes('7fr_3fr'))

      expect(findSidebarGrid(renderForm().container)).toBeTruthy()
      expect(findSidebarGrid(renderForm({ hiddenGroupIds: ['notes'] }).container)).toBeUndefined()
    })
  })

  describe('interaction with other group features', () => {
    it('excludes hidden groups from the sortable drag handles', () => {
      const visible = renderForm({ sortableGroups: true, collapsibleGroups: true }).container
      expect(visible.querySelectorAll('button[aria-label="Drag to reorder"]').length).toBe(2)

      const { container } = renderForm({
        hiddenGroupIds: ['profile'],
        sortableGroups: true,
        collapsibleGroups: true,
      })
      expect(container.querySelectorAll('button[aria-label="Drag to reorder"]').length).toBe(1)
    })

    it('renders no collapsible header or control for a hidden group', () => {
      const { container } = renderForm({ hiddenGroupIds: ['profile'], collapsibleGroups: true })
      expect(groupTitles(container)).not.toContain('Profile')
      expect(fieldIds(container)).not.toContain('legalName')
    })

    it('hides an injected widget group card addressed by its widget: id', async () => {
      injectedGroupWidgets = [
        {
          widgetId: 'customer_accounts.injection.company-users',
          placement: { kind: 'group', column: 1, groupLabel: 'Portal users', priority: 200 },
          module: {
            metadata: { title: 'Portal users', description: '' },
            Widget: () => <div data-testid="portal-users-widget">portal users</div>,
          },
        },
      ]

      const { container: shown } = renderForm()
      await waitFor(() => {
        expect(shown.querySelector('[data-testid="portal-users-widget"]')).toBeTruthy()
      })

      const { container } = renderForm({
        hiddenGroupIds: ['widget:customer_accounts.injection.company-users'],
      })
      expect(container.querySelector('[data-testid="portal-users-widget"]')).toBeNull()
      // the rest of the form is untouched
      expect(fieldIds(container)).toEqual(['name', 'legalName', 'note'])
    })

    it('does not gate submit on an injected field that fell back into a hidden group', async () => {
      // A definition whose target group does not exist is appended to the LAST
      // declared group; when that group is hidden the field renders nowhere, so
      // it must not block submit either.
      injectedFieldWidgets = [
        {
          fields: [
            {
              id: 'injectedOnly',
              label: 'Injected only',
              type: 'text',
              group: 'no-such-group',
              required: true,
            },
          ],
        },
      ]
      const onSubmit = jest.fn()

      const { container } = renderForm({
        formFields: [fields[0]],
        formGroups: [
          { id: 'details', title: 'Details', column: 1, fields: ['name'] },
          { id: 'profile', title: 'Profile', column: 1, fields: [] },
        ],
        formInitialValues: { name: 'Acme' },
        hiddenGroupIds: ['profile'],
        onSubmit,
      })

      await waitFor(() => {
        expect(fieldIds(container)).not.toContain('injectedOnly')
      })

      submitForm(container)

      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    })

    it('hides a customFields group card together with its resolved custom fields', async () => {
      fetchCustomFieldFormStructureMock.mockResolvedValue({
        definitions: [
          {
            key: 'segment',
            entityId: 'customers:company',
            label: 'Segment',
            kind: 'text',
            formEditable: true,
          },
        ],
        metadata: { items: [], fieldsetsByEntity: {}, entitySettings: {} },
      })
      buildFormFieldFromCustomFieldDefMock.mockImplementation(
        (definition: { key: string; label?: string }) => ({
          id: `cf_${definition.key}`,
          label: definition.label ?? definition.key,
          type: 'text',
        }),
      )

      const withCustomFields: CrudFormGroup[] = [
        groups[0],
        { id: 'customFields', column: 2, kind: 'customFields' },
      ]

      const { container: shown } = renderForm({
        formGroups: withCustomFields,
        entityId: 'customers:company',
        formInitialValues: { name: 'Acme' },
        formFields: [fields[0]],
      })
      await waitFor(() => {
        expect(fieldIds(shown)).toContain('cf_segment')
      })

      const { container } = renderForm({
        formGroups: withCustomFields,
        entityId: 'customers:company',
        formInitialValues: { name: 'Acme' },
        formFields: [fields[0]],
        hiddenGroupIds: ['customFields'],
      })
      await waitFor(() => {
        expect(fetchCustomFieldFormStructureMock).toHaveBeenCalled()
      })
      expect(fieldIds(container)).toEqual(['name'])
      expect(fieldIds(container)).not.toContain('cf_segment')
    })
  })

  describe('submission semantics', () => {
    it('submits the values of a hidden group unchanged', async () => {
      const onSubmit = jest.fn()
      const { container } = renderForm({ hiddenGroupIds: ['profile'], onSubmit })

      submitForm(container)

      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      expect(onSubmit.mock.calls[0][0]).toEqual(
        expect.objectContaining({ name: 'Acme', legalName: 'Acme Sp. z o.o.', note: 'hello' }),
      )
    })

    it('does not block submit on a required field that lives only in a hidden group', async () => {
      const onSubmit = jest.fn()

      const { container } = renderForm({
        formFields: [
          { id: 'name', label: 'Name', type: 'text' },
          { id: 'legalName', label: 'Legal name', type: 'text', required: true },
        ],
        formGroups: [
          { id: 'details', title: 'Details', column: 1, fields: ['name'] },
          { id: 'profile', title: 'Profile', column: 1, fields: ['legalName'] },
        ],
        formInitialValues: { name: 'Acme', legalName: '' },
        hiddenGroupIds: ['profile'],
        onSubmit,
      })
      expect(fieldIds(container)).toEqual(['name'])

      submitForm(container)

      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    })

    it('still blocks submit when that required field is also placed in a visible group', async () => {
      const onSubmit = jest.fn()

      const { container } = renderForm({
        formFields: [{ id: 'legalName', label: 'Legal name', type: 'text', required: true }],
        formGroups: [
          { id: 'details', title: 'Details', column: 1, fields: ['legalName'] },
          { id: 'profile', title: 'Profile', column: 1, fields: ['legalName'] },
        ],
        formInitialValues: { legalName: '' },
        hiddenGroupIds: ['profile'],
        onSubmit,
      })
      expect(fieldIds(container)).toEqual(['legalName'])

      submitForm(container)

      await waitFor(() => {
        expect(container.querySelector('[data-crud-field-id="legalName"]')).toBeTruthy()
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
