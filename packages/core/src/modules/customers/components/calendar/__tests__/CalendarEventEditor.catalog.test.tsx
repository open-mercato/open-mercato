/** @jest-environment jsdom */

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { act, screen, waitFor } from '@testing-library/react'
import { calendarEventTypes } from '../../../calendar-event-types'
import type { ScopedCalendarEventType } from '../../../lib/calendar/eventTypeResolver'
import { buildCalendarItem } from './fixtures'

const crudPropsMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const confirmMock = jest.fn()
const groupSetValueMock = jest.fn()
let renderGroups = false

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldForms'),
  fetchCustomFieldFormStructure: async () => ({ definitions: [
    { key: 'visit_notes', kind: 'text', label: 'Visit notes', fieldset: 'visit_details' },
    { key: 'meeting_notes', kind: 'text', label: 'Meeting notes', fieldset: 'meeting_details' },
    { key: 'internal_notes', kind: 'text', label: 'Internal notes', fieldset: 'internal' },
  ] }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    crudPropsMock(props)
    const groups = props.groups as Array<{ id: string; component?: (ctx: { values: Record<string, unknown>; errors: Record<string, string>; setValue: (key: string, value: unknown) => void }) => React.ReactNode }>
    return <form id={props.formId as string}>{renderGroups ? groups.map((group) => <React.Fragment key={group.id}>{group.component?.({ values: props.initialValues as Record<string, unknown>, errors: {}, setValue: groupSetValueMock })}</React.Fragment>) : null}</form>
  },
}))

jest.mock('../editor/EventTypePanel', () => ({ EventTypePanel: () => <div data-testid="type-panel" /> }))

const visitType: ScopedCalendarEventType = {
  ...calendarEventTypes[0]!,
  key: 'visit',
  label: 'Visit',
  behavior: { ...calendarEventTypes[0]!.behavior, customFieldsetIds: ['visit_details'] },
  selectable: true,
  source: 'example',
  provenance: {},
  historical: false,
  adminConfigurable: true,
  isInherited: false,
  isLocalOverride: false,
  updatedAt: null,
  missingCustomFieldsetIds: [],
}
const meetingType: ScopedCalendarEventType = {
  ...visitType,
  key: 'meeting',
  label: 'Meeting',
  behavior: { ...visitType.behavior, customFieldsetIds: ['meeting_details'] },
}
let catalogState: { status: 'loading' | 'ready' | 'error'; items: readonly ScopedCalendarEventType[] } = {
  status: 'ready', items: [visitType],
}

jest.mock('../editor/useEventTypeCatalog', () => ({
  ...jest.requireActual('../editor/useEventTypeCatalog'),
  useEventTypeCatalog: () => ({ ...catalogState, retry: jest.fn() }),
}))

import { CalendarEventEditor } from '../CalendarEventEditor'

describe('CalendarEventEditor catalog host', () => {
  beforeEach(() => {
    renderGroups = false
    crudPropsMock.mockClear()
    apiCallOrThrowMock.mockReset()
    confirmMock.mockReset()
    groupSetValueMock.mockReset()
    catalogState = { status: 'ready', items: [visitType] }
  })

  it('builds selected-type fields in the module and keeps the shared CrudForm generic', async () => {
    const item = buildCalendarItem({
      interactionType: 'visit',
      updatedAt: '2026-09-29T12:00:00.000Z',
      raw: { id: 'item-1', interactionType: 'visit', status: 'planned' },
    })
    renderWithProviders(
      <CalendarEventEditor
        open
        mode="edit"
        item={item}
        typeLabels={{}}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    )

    await waitFor(() => {
      const props = crudPropsMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
      expect(props?.calendarEventTypeKey).toBeUndefined()
      expect(props?.customFieldsetAllowlist).toBeUndefined()
      expect(props?.entityIds).toBeUndefined()
      expect(props?.fields).toEqual([expect.objectContaining({ id: 'cf_visit_notes' })])
      expect(props?.injectionSpotId).toBe('crud-form:customers.customer_interaction')
      expect(props?.initialValues).toMatchObject({ updatedAt: '2026-09-29T12:00:00.000Z' })
    })
  })

  it('uses configured behavior for a mixed-case stored key and preserves that key on save', async () => {
    const note = calendarEventTypes.find((type) => type.key === 'note')!
    catalogState = { status: 'ready', items: [{ ...visitType, key: 'site visit', behavior: { ...note.behavior, customFieldsetIds: ['visit_details'] } }] }
    renderWithProviders(<CalendarEventEditor open mode="edit" item={buildCalendarItem({ interactionType: 'Site Visit', category: 'Site Visit' })} typeLabels={{}} onOpenChange={() => {}} onSaved={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save event' })).not.toBeDisabled())
    const props = crudPropsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(props.fields).toEqual([expect.objectContaining({ id: 'cf_visit_notes' })])
    await act(async () => {
      await (props.onSubmit as (values: Record<string, unknown>) => Promise<void>)({ ...(props.initialValues as Record<string, unknown>), relatedTo: { id: 'person-1', kind: 'person', label: 'Person' } })
    })
    const payload = JSON.parse(apiCallOrThrowMock.mock.calls[0]?.[1].body) as Record<string, unknown>
    expect(payload.interactionType).toBe('Site Visit')
    expect(payload.enforceSelectableType).toBe(true)
    expect(payload.durationMinutes).toBeNull()
    expect(payload.location).toBeNull()
  })

  it.each([...calendarEventTypes.map((type) => type.key), 'visit'])('renders the host timezone selector for %s including custom panels', async (key) => {
    renderGroups = true
    const baseline = calendarEventTypes.find((type) => type.key === key)
    catalogState = { status: 'ready', items: [{ ...visitType, ...(baseline ?? {}), key }] }
    renderWithProviders(<CalendarEventEditor open mode="edit" item={buildCalendarItem({ interactionType: key, raw: { id: 'item-1', interactionType: key, status: 'planned', timezone: 'Europe/Warsaw' } })} typeLabels={{}} onOpenChange={() => {}} onSaved={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save event' })).not.toBeDisabled())
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveTextContent('Europe/Warsaw')
    expect(screen.getByTestId('type-panel')).toBeInTheDocument()
  })

  it('renders a stored valid timezone alias that is absent from the canonical option list', async () => {
    renderGroups = true
    catalogState = { status: 'ready', items: [meetingType] }
    renderWithProviders(<CalendarEventEditor open mode="edit" item={buildCalendarItem({ raw: { id: 'item-1', interactionType: 'meeting', status: 'planned', timezone: 'US/Eastern' } })} typeLabels={{}} onOpenChange={() => {}} onSaved={() => {}} />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveTextContent('US/Eastern'))
  })

  it('seeds the first selectable type without mutating an untouched new form', async () => {
    renderGroups = true
    catalogState = { status: 'ready', items: [visitType] }
    renderWithProviders(<CalendarEventEditor open mode="create" typeLabels={{}} onOpenChange={() => {}} onSaved={() => {}} />)
    await waitFor(() => {
      const props = crudPropsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(props.initialValues).toMatchObject({ category: 'visit', kind: visitType.behavior.baseKind })
    })
    expect(groupSetValueMock).not.toHaveBeenCalled()
  })

  it('waits for the create catalog before exposing a form when meeting is disabled', async () => {
    catalogState = { status: 'loading', items: [] }
    const view = renderWithProviders(
      <CalendarEventEditor
        open
        mode="create"
        typeLabels={{}}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    )
    await act(async () => {})

    expect(crudPropsMock).not.toHaveBeenCalled()
    expect(document.getElementById('customers-calendar-event-editor')).not.toBeInTheDocument()

    catalogState = { status: 'ready', items: [visitType] }
    view.rerender(
      <CalendarEventEditor
        open
        mode="create"
        typeLabels={{}}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    )

    await waitFor(() => {
      const props = crudPropsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(props.initialValues).toMatchObject({ category: 'visit', kind: visitType.behavior.baseKind })
    })
  })

  it('saves the chosen timezone and rejects a DST gap without sending a write', async () => {
    catalogState = { status: 'ready', items: [meetingType] }
    renderWithProviders(<CalendarEventEditor open mode="edit" item={buildCalendarItem({ raw: { id: 'item-1', interactionType: 'meeting', status: 'planned', timezone: 'Europe/Warsaw' } })} typeLabels={{}} onOpenChange={() => {}} onSaved={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save event' })).not.toBeDisabled())
    const props = crudPropsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    const submit = props.onSubmit as (values: Record<string, unknown>) => Promise<void>
    const values = { ...(props.initialValues as Record<string, unknown>), timezone: 'Europe/Warsaw', date: '2026-09-29', startTime: '09:15', endDate: '2026-09-29', endTime: '12:00', relatedTo: { id: 'person-1', kind: 'person', label: 'Person' } }
    await act(async () => { await submit(values) })
    expect(JSON.parse(apiCallOrThrowMock.mock.calls[0]?.[1].body)).toMatchObject({ timezone: 'Europe/Warsaw', scheduledAt: '2026-09-29T07:15:00.000Z', durationMinutes: 165 })
    apiCallOrThrowMock.mockClear()
    await act(async () => { await expect(submit({ ...values, date: '2026-03-29', startTime: '02:30' })).rejects.toMatchObject({ fieldErrors: { startTime: 'This local time does not exist in the selected time zone' } }) })
    await act(async () => { await expect(submit({ ...values, timezone: 'Pacific/Apia', date: '2011-12-29', startTime: '10:00', endDate: '2011-12-29', endTime: '11:00', repeatFreq: 'daily', repeatEndType: 'date', repeatUntilDate: '2011-12-30' })).rejects.toMatchObject({ fieldErrors: { repeatUntilDate: 'This local time does not exist in the selected time zone' } }) })
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })

  it('keeps the create form unavailable when the authoritative catalog is unavailable', async () => {
    catalogState = { status: 'error', items: [] }
    renderWithProviders(
      <CalendarEventEditor
        open
        mode="create"
        typeLabels={{}}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Save event' })).toBeDisabled()
    expect(crudPropsMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'customers.calendar.errors.retry' })).toBeInTheDocument()
    await act(async () => {})
  })

  it('previews exact cleared fields and preserves the draft when the type switch is cancelled', async () => {
    catalogState = { status: 'ready', items: [visitType, meetingType] }
    const conflict = Object.assign(new Error('Confirmation required'), {
      status: 409,
      code: 'calendar_type_change_confirmation_required',
      fields: ['location', 'cf_visit_notes'],
    })
    apiCallOrThrowMock.mockRejectedValueOnce(conflict)
    confirmMock.mockResolvedValueOnce(false)
    const onOpenChange = jest.fn()
    const onSaved = jest.fn()
    renderWithProviders(
      <CalendarEventEditor
        open
        mode="edit"
        item={buildCalendarItem({ interactionType: 'visit', category: 'visit' })}
        typeLabels={{}}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save event' })).not.toBeDisabled())
    const props = crudPropsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    const onSubmit = props.onSubmit as (values: Record<string, unknown>) => Promise<void>
    await act(async () => {
      await onSubmit({ ...(props.initialValues as Record<string, unknown>), category: 'meeting', relatedTo: { id: 'person-1', kind: 'person', label: 'Person' } })
    })

    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive',
      text: expect.stringContaining('customers.calendar.editor.location, Visit notes'),
    }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('retries a confirmed type switch with the explicit discard flag', async () => {
    catalogState = { status: 'ready', items: [visitType, meetingType] }
    const conflict = Object.assign(new Error('Confirmation required'), {
      status: 409,
      code: 'calendar_type_change_confirmation_required',
      fields: ['location'],
    })
    apiCallOrThrowMock.mockRejectedValueOnce(conflict).mockResolvedValueOnce({})
    confirmMock.mockResolvedValueOnce(true)
    const onOpenChange = jest.fn()
    const onSaved = jest.fn()
    renderWithProviders(
      <CalendarEventEditor
        open
        mode="edit"
        item={buildCalendarItem({ interactionType: 'visit', category: 'visit' })}
        typeLabels={{}}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save event' })).not.toBeDisabled())
    const props = crudPropsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    const onSubmit = props.onSubmit as (values: Record<string, unknown>) => Promise<void>
    await act(async () => {
      await onSubmit({ ...(props.initialValues as Record<string, unknown>), category: 'meeting', relatedTo: { id: 'person-1', kind: 'person', label: 'Person' } })
    })

    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse((apiCallOrThrowMock.mock.calls[0]?.[1] as { body: string }).body)
    const confirmedBody = JSON.parse((apiCallOrThrowMock.mock.calls[1]?.[1] as { body: string }).body)
    expect(firstBody.confirmDiscardInapplicableValues).toBeUndefined()
    expect(confirmedBody).toMatchObject({ ...firstBody, confirmDiscardInapplicableValues: true })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
