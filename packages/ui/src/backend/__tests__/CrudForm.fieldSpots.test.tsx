/** @jest-environment jsdom */
jest.setTimeout(20000)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

import * as React from 'react'
import { act, waitFor } from '@testing-library/react'
import type { InjectionWidgetComponentProps, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import {
  invalidateInjectionWidgetCache,
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
  registerEnabledModuleIds,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const SPOT_ID = 'crud-form:test.deal'
const RECORD_ID = '0f6b3c1e-6a43-4f6f-9b9e-2a0c8d1f2e3a'
const FIELD_WIDGET_ID = 'test.injection.field-after'
const SILENT_FIELD_WIDGET_ID = 'test.injection.field-after-silent'
const WILDCARD_WIDGET_ID = 'record_locks.injection.crud-form-locking'

const fields: CrudField[] = [
  { id: 'title', label: 'Title', type: 'text' },
  { id: 'status', label: 'Status', type: 'text' },
]

type FieldContext = { entityId?: string; recordId?: string; fieldId?: string; resourceKind?: string }

function FieldAfterProbe({ context }: InjectionWidgetComponentProps<FieldContext>) {
  const { entityId, recordId, fieldId, resourceKind } = context
  return (
    <span
      data-testid={`field-after-${fieldId}`}
      data-context={JSON.stringify({ entityId, recordId, fieldId, resourceKind: resourceKind ?? null })}
    />
  )
}

function WildcardProbe() {
  return <span data-testid="wildcard-widget" />
}

function SilentWidget() {
  return null
}

function widgetEntry(moduleId: string, widgetId: string, Widget: React.ComponentType<InjectionWidgetComponentProps<FieldContext>>): ModuleInjectionWidgetEntry {
  return {
    moduleId,
    key: `${moduleId}:${widgetId}`,
    source: 'package',
    widgetId,
    loader: async () => ({
      metadata: { id: widgetId, title: widgetId, description: widgetId, enabled: true },
      Widget,
    }),
  } as ModuleInjectionWidgetEntry
}

function registerRegistry(tables: Array<{ moduleId: string; table: ModuleInjectionTable }>) {
  registerCoreInjectionWidgets([
    widgetEntry('test', FIELD_WIDGET_ID, FieldAfterProbe),
    widgetEntry('test', SILENT_FIELD_WIDGET_ID, SilentWidget),
    widgetEntry('record_locks', WILDCARD_WIDGET_ID, WildcardProbe),
  ])
  registerCoreInjectionTables(tables)
}

type FormOptions = {
  initialValues?: Record<string, unknown>
  groups?: CrudFormGroup[]
  versionHistory?: { resourceKind: string; resourceId: string }
}

function renderForm(options: FormOptions = {}) {
  return renderWithProviders(
    <CrudForm
      title="Deal"
      formId="deal-form"
      fields={fields}
      groups={options.groups}
      initialValues={options.initialValues ?? { id: RECORD_ID, title: 'Deal A', status: 'open' }}
      injectionSpotId={SPOT_ID}
      versionHistory={options.versionHistory}
      onSubmit={() => {}}
    />,
    { dict: { 'ui.forms.actions.save': 'Save' } },
  )
}

async function settle() {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function normalizedMarkup(container: HTMLElement): string {
  return container.innerHTML
    .replace(/«r[0-9a-z]+»/g, '«id»')
    .replace(/_r_[0-9a-z]+_/g, '_id_')
    .replace(/:r[0-9a-z]+:/g, ':id:')
}

async function renderedMarkup(options: FormOptions = {}): Promise<string> {
  const view = renderForm(options)
  await settle()
  const markup = normalizedMarkup(view.container)
  view.unmount()
  return markup
}

function readContext(element: HTMLElement): FieldContext {
  return JSON.parse(element.getAttribute('data-context') ?? '{}') as FieldContext
}

describe('CrudForm field-level injection spots', () => {
  beforeEach(() => {
    invalidateInjectionWidgetCache()
    registerCoreInjectionWidgets([])
    registerCoreInjectionTables([])
    registerEnabledModuleIds(['test', 'record_locks'])
  })

  it('renders crud-form:<entityId>:field:<fieldId>:after inside each field of an edit form', async () => {
    registerRegistry([{ moduleId: 'test', table: { [`${SPOT_ID}:field:*:after`]: FIELD_WIDGET_ID } }])
    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="status"] [data-testid="field-after-status"]')).not.toBeNull()
    })
    const titleProbe = container.querySelector('[data-crud-field-id="title"] [data-testid="field-after-title"]') as HTMLElement
    const statusProbe = container.querySelector('[data-crud-field-id="status"] [data-testid="field-after-status"]') as HTMLElement
    expect(readContext(titleProbe)).toEqual({ entityId: 'test.deal', recordId: RECORD_ID, fieldId: 'title', resourceKind: null })
    expect(readContext(statusProbe)).toEqual({ entityId: 'test.deal', recordId: RECORD_ID, fieldId: 'status', resourceKind: null })
  })

  it('renders an exact field registration only for that field and passes the resource kind', async () => {
    registerRegistry([{ moduleId: 'test', table: { [`${SPOT_ID}:field:status:after`]: FIELD_WIDGET_ID } }])
    const { container } = renderForm({
      groups: [{ id: 'main', title: 'Main', fields: ['title', 'status'] }],
      versionHistory: { resourceKind: 'test.deal', resourceId: RECORD_ID },
    })

    await waitFor(() => {
      expect(container.querySelector('[data-testid="field-after-status"]')).not.toBeNull()
    })
    await settle()
    expect(container.querySelector('[data-testid="field-after-title"]')).toBeNull()
    const statusProbe = container.querySelector('[data-crud-field-id="status"] [data-testid="field-after-status"]') as HTMLElement
    expect(readContext(statusProbe)).toEqual({ entityId: 'test.deal', recordId: RECORD_ID, fieldId: 'status', resourceKind: 'test.deal' })
  })

  it('does not render field spots in create mode', async () => {
    const baseline = await renderedMarkup({ initialValues: { title: '', status: '' } })
    registerRegistry([{ moduleId: 'test', table: { [`${SPOT_ID}:field:*:after`]: FIELD_WIDGET_ID } }])

    const view = renderForm({ initialValues: { title: '', status: '' } })
    await settle()
    expect(view.container.querySelector('[data-testid^="field-after-"]')).toBeNull()
    expect(normalizedMarkup(view.container)).toBe(baseline)
  })

  it('renders byte-identical DOM when no field registration targets the form', async () => {
    const baseline = await renderedMarkup()
    expect(baseline).toContain('data-crud-field-id="status"')

    registerRegistry([{ moduleId: 'test', table: { 'crud-form:other.entity:field:*:after': FIELD_WIDGET_ID } }])
    expect(await renderedMarkup()).toBe(baseline)

    registerRegistry([{ moduleId: 'test', table: { [`${SPOT_ID}:field:*:after`]: SILENT_FIELD_WIDGET_ID } }])
    expect(await renderedMarkup()).toBe(baseline)
  })

  it('keeps a record_locks-style crud-form:* registration out of field spots', async () => {
    registerRegistry([{ moduleId: 'record_locks', table: { 'crud-form:*': [{ widgetId: WILDCARD_WIDGET_ID, priority: 400 }] } }])
    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelector('[data-testid="wildcard-widget"]')).not.toBeNull()
    })
    await settle()
    expect(container.querySelector('[data-crud-field-id] [data-testid="wildcard-widget"]')).toBeNull()
    expect(container.querySelector('[data-testid^="field-after-"]')).toBeNull()
  })

  it('does not resolve a crud-form:* widget into field spots rendered for another registration', async () => {
    registerRegistry([
      { moduleId: 'record_locks', table: { 'crud-form:*': [{ widgetId: WILDCARD_WIDGET_ID, priority: 400 }] } },
      { moduleId: 'test', table: { [`${SPOT_ID}:field:*:after`]: FIELD_WIDGET_ID } },
    ])
    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="status"] [data-testid="field-after-status"]')).not.toBeNull()
    })
    await settle()
    expect(container.querySelector('[data-testid="wildcard-widget"]')).not.toBeNull()
    expect(container.querySelector('[data-crud-field-id] [data-testid="wildcard-widget"]')).toBeNull()
  })

  it('renders field spots once the registry registers after the form mounted', async () => {
    const { container } = renderForm()
    await settle()
    expect(container.querySelector('[data-testid^="field-after-"]')).toBeNull()

    act(() => {
      registerRegistry([{ moduleId: 'test', table: { [`${SPOT_ID}:field:*:after`]: FIELD_WIDGET_ID } }])
    })

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="title"] [data-testid="field-after-title"]')).not.toBeNull()
    })
  })
})
