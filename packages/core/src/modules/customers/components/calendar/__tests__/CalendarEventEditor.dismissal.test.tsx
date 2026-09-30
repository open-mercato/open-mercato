/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders as renderWithI18n } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { calendarEventTypes } from '../../../calendar-event-types'
import { CalendarEventEditor } from '../CalendarEventEditor'
import customerTranslations from '../../../i18n/en.json'

function renderWithProviders(ui: React.ReactElement) {
  return renderWithI18n(ui, { dict: customerTranslations })
}

const confirmMock = jest.fn()
const catalog = calendarEventTypes.map((definition) => ({ ...definition, selectable: true, historical: false }))
jest.mock('../editor/useEventTypeCatalog', () => ({
  ...jest.requireActual('../editor/useEventTypeCatalog'),
  useEventTypeCatalog: () => ({ status: 'ready', items: catalog, retry: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
}))
jest.mock('../editor/useCalendarCustomFields', () => ({
  useCalendarCustomFields: () => ({ status: 'ready', fields: [], definitions: [] }),
}))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ onDirtyChange, trackDirtyWhenEmbedded }: { onDirtyChange(dirty: boolean): void; trackDirtyWhenEmbedded: boolean }) =>
    <input aria-label="Draft title" onChange={() => { if (trackDirtyWhenEmbedded) onDirtyChange(true) }} />,
}))
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: { open: boolean; onOpenChange(open: boolean): void; children: React.ReactNode }) =>
    open ? <div><button onClick={() => onOpenChange(false)}>Outside overlay</button>{children}</div> : null,
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown: React.KeyboardEventHandler }) =>
    <div role="dialog" onKeyDown={onKeyDown}>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

beforeEach(() => confirmMock.mockReset())

it.each(['Outside overlay', 'Close', 'Escape'])('protects a changed draft when dismissed through %s', async (action) => {
  const onOpenChange = jest.fn()
  renderWithProviders(<CalendarEventEditor open mode="create" typeLabels={{}} onOpenChange={onOpenChange} onSaved={() => {}} />)
  fireEvent.change(screen.getByLabelText('Draft title'), { target: { value: 'Unsaved event' } })
  const dismiss = () => action === 'Escape'
    ? fireEvent.keyDown(screen.getAllByRole('dialog')[0]!, { key: 'Escape' })
    : fireEvent.click(screen.getByRole('button', { name: action, exact: true }))
  await act(async () => { dismiss() })
  const keepEditing = screen.getByRole('button', { name: 'Keep editing', exact: true })
  const discard = screen.getByRole('button', { name: 'Discard changes', exact: true })
  expect(discard.compareDocumentPosition(keepEditing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(keepEditing).toHaveClass('bg-primary')
  expect(keepEditing).toHaveFocus()
  expect(onOpenChange).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(keepEditing) })
  expect(screen.queryByRole('button', { name: 'Discard changes', exact: true })).not.toBeInTheDocument()
  expect(onOpenChange).not.toHaveBeenCalled()
  await act(async () => { dismiss() })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard changes', exact: true })) })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('closes an unchanged draft without a confirmation', async () => {
  const onOpenChange = jest.fn()
  renderWithProviders(<CalendarEventEditor open mode="create" typeLabels={{}} onOpenChange={onOpenChange} onSaved={() => {}} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Outside overlay' })) })
  expect(confirmMock).not.toHaveBeenCalled()
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('discards a changed draft directly when Cancel is clicked', async () => {
  const onOpenChange = jest.fn()
  renderWithProviders(<CalendarEventEditor open mode="create" typeLabels={{}} onOpenChange={onOpenChange} onSaved={() => {}} />)
  fireEvent.change(screen.getByLabelText('Draft title'), { target: { value: 'Unsaved event' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true })) })
  expect(confirmMock).not.toHaveBeenCalled()
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
