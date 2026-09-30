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
    { key: 'internal_notes', kind: 'text', label: 'Internal notes', fieldset: 'internal' },
  ] }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    crudPropsMock(props)
    return <form id={props.formId as string} />
  },
}))

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
  behavior: { ...visitType.behavior, customFieldsetIds: [] },
}
let catalogState: { status: 'ready' | 'error'; items: readonly ScopedCalendarEventType[] } = {
  status: 'ready', items: [visitType],
}

jest.mock('../editor/useEventTypeCatalog', () => ({
  ...jest.requireActual('../editor/useEventTypeCatalog'),
  useEventTypeCatalog: () => ({ ...catalogState, retry: jest.fn() }),
}))

import { CalendarEventEditor } from '../CalendarEventEditor'

describe('CalendarEventEditor catalog host', () => {
  beforeEach(() => {
    crudPropsMock.mockClear()
    apiCallOrThrowMock.mockReset()
    confirmMock.mockReset()
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

  it('keeps saving disabled when the authoritative catalog is unavailable', async () => {
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
    expect(crudPropsMock).toHaveBeenCalled()
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
