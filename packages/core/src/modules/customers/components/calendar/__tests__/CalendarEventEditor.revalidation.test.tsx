/** @jest-environment jsdom */

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { calendarEventTypes } from '../../../calendar-event-types'
import type { ScopedCalendarEventType } from '../../../lib/calendar/eventTypeResolver'
import { clearScopeCookies, orgA, queueReads, writeScopeCookies } from '../editor/__tests__/scopeFixtures'

const readCatalogMock = jest.fn()
const readDefinitionsMock = jest.fn()
const formMountMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readCatalogMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldForms'),
  fetchCustomFieldFormStructure: (...args: unknown[]) => readDefinitionsMock(...args),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    React.useEffect(() => { formMountMock() }, [])
    const [values, setValues] = React.useState(props.initialValues as Record<string, unknown>)
    const setValue = React.useCallback((key: string, value: unknown) => {
      setValues((previous) => ({ ...previous, [key]: value }))
    }, [])
    const groups = props.groups as Array<{ id: string; component?: (ctx: { values: Record<string, unknown>; errors: Record<string, string>; setValue: (key: string, value: unknown) => void }) => React.ReactNode }>
    return <form id={props.formId as string}>{groups.map((group) => <React.Fragment key={group.id}>{group.component?.({ values, errors: {}, setValue })}</React.Fragment>)}</form>
  },
}))

jest.mock('../editor/EventTypePanel', () => ({ EventTypePanel: () => <div data-testid="type-panel" /> }))

import { CalendarEventEditor } from '../CalendarEventEditor'
import { clearEventTypeCatalogCache } from '../editor/useEventTypeCatalog'
import { clearCalendarCustomFieldsCache } from '../editor/useCalendarCustomFields'

const baseType: ScopedCalendarEventType = {
  ...calendarEventTypes[0]!,
  key: 'meeting',
  label: 'Meeting',
  behavior: { ...calendarEventTypes[0]!.behavior, customFieldsetIds: [] },
  selectable: true,
  source: 'customers',
  provenance: {},
  historical: false,
  adminConfigurable: true,
  isInherited: false,
  isLocalOverride: false,
  updatedAt: null,
  missingCustomFieldsetIds: [],
}
const catalog = { items: [baseType, { ...baseType, key: 'visit', label: 'Visit' }] }
const definitions = { definitions: [{ key: 'visit_notes', kind: 'text', label: 'Visit notes' }] }
const noop = () => {}

const editor = (open: boolean) => <CalendarEventEditor open={open} mode="create" typeLabels={{}} onOpenChange={noop} onSaved={noop} />

const saveButton = () => screen.getByRole('button', { name: 'Save event' })
const retryButton = () => screen.getByRole('button', { name: 'customers.calendar.errors.retry' })
const typeOption = () => screen.getByRole('button', { name: 'Visit', exact: true })
const titleInput = () => screen.getByRole('textbox', { name: 'Title' })

describe('CalendarEventEditor when a refresh of confirmed data is rejected', () => {
  beforeEach(() => {
    clearEventTypeCatalogCache()
    clearCalendarCustomFieldsCache()
    clearScopeCookies()
    writeScopeCookies(orgA)
    formMountMock.mockClear()
    readCatalogMock.mockReset()
    readDefinitionsMock.mockReset()
    readCatalogMock.mockResolvedValue(catalog)
    readDefinitionsMock.mockResolvedValue(definitions)
  })

  it.each([
    { name: 'catalog', mock: readCatalogMock, answer: catalog, message: 'customers.calendar.editor.catalogLoadFailed' },
    { name: 'custom field definitions', mock: readDefinitionsMock, answer: definitions, message: 'customers.calendar.editor.customFieldsLoadFailed' },
  ])('keeps the draft and disables selection and save until a retry of the $name succeeds', async ({ mock, answer, message }) => {
    const view = renderWithProviders(editor(true))
    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    view.rerender(editor(false))
    await act(async () => {})

    const pending = queueReads(mock)
    view.rerender(editor(true))
    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    fireEvent.change(titleInput(), { target: { value: 'Typed draft' } })
    formMountMock.mockClear()

    await act(async () => { pending.shift()?.reject(Object.assign(new Error('forbidden'), { status: 403 })) })

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(typeOption()).toBeDisabled()
    expect(titleInput()).toHaveValue('Typed draft')
    expect(screen.getByTestId('type-panel')).toBeInTheDocument()

    fireEvent.click(retryButton())
    await act(async () => {})
    expect(saveButton()).toBeDisabled()
    await act(async () => { pending.shift()?.reject(new Error('offline')) })
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(titleInput()).toHaveValue('Typed draft')

    fireEvent.click(retryButton())
    await act(async () => {})
    expect(saveButton()).toBeDisabled()
    await act(async () => { pending.shift()?.resolve(answer) })

    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    expect(screen.queryByText(message)).not.toBeInTheDocument()
    expect(typeOption()).not.toBeDisabled()
    expect(titleInput()).toHaveValue('Typed draft')
    expect(formMountMock).not.toHaveBeenCalled()
  })

  it('keeps the draft through a retry when the custom fields never loaded', async () => {
    const pending = queueReads(readDefinitionsMock)
    renderWithProviders(editor(true))
    await waitFor(() => expect(readDefinitionsMock).toHaveBeenCalled())
    await act(async () => { pending.shift()?.reject(new Error('offline')) })
    fireEvent.change(titleInput(), { target: { value: 'Typed draft' } })
    expect(saveButton()).toBeDisabled()
    formMountMock.mockClear()

    fireEvent.click(retryButton())
    await act(async () => {})
    expect(titleInput()).toHaveValue('Typed draft')
    await act(async () => { pending.shift()?.resolve(definitions) })

    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    expect(titleInput()).toHaveValue('Typed draft')
    expect(formMountMock).not.toHaveBeenCalled()
  })
})

describe('CalendarEventEditor when a refresh changes the type the draft was opened with', () => {
  const offMeeting = { ...baseType, selectable: false }
  const visit = { ...baseType, key: 'visit', label: 'Visit' }
  const call = { ...baseType, key: 'call', label: 'Call' }
  const callOption = () => screen.getByRole('button', { name: 'Call', exact: true })

  beforeEach(() => {
    clearEventTypeCatalogCache()
    clearCalendarCustomFieldsCache()
    clearScopeCookies()
    writeScopeCookies(orgA)
    formMountMock.mockClear()
    readCatalogMock.mockReset()
    readDefinitionsMock.mockReset()
    readDefinitionsMock.mockResolvedValue(definitions)
  })

  it.each([
    {
      name: 'the auto-selected fallback is disabled',
      before: { items: [offMeeting, visit, call] },
      after: { items: [offMeeting, { ...visit, selectable: false }, call] },
    },
    {
      name: 'the default type is disabled',
      before: { items: [baseType, visit, call] },
      after: { items: [offMeeting, visit, call] },
    },
  ])('keeps the typed draft mounted when $name by a delayed successful refresh', async ({ before, after }) => {
    readCatalogMock.mockResolvedValue(before)
    const view = renderWithProviders(editor(true))
    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    view.rerender(editor(false))
    await act(async () => {})

    const pending = queueReads(readCatalogMock)
    view.rerender(editor(true))
    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    fireEvent.change(titleInput(), { target: { value: 'Typed draft' } })
    formMountMock.mockClear()

    await act(async () => { pending.shift()?.resolve(after) })

    expect(titleInput()).toHaveValue('Typed draft')
    expect(formMountMock).not.toHaveBeenCalled()
    expect(saveButton()).toBeDisabled()

    fireEvent.click(callOption())
    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    expect(titleInput()).toHaveValue('Typed draft')
    expect(formMountMock).not.toHaveBeenCalled()
  })
})
