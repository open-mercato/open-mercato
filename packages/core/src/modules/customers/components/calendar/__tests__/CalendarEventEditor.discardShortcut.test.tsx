/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders as renderWithI18n } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { calendarEventTypes } from '../../../calendar-event-types'
import { CalendarEventEditor } from '../CalendarEventEditor'
import customerTranslations from '../../../i18n/en.json'

function renderWithProviders(ui: React.ReactElement) {
  return renderWithI18n(ui, { dict: customerTranslations })
}

const catalog = calendarEventTypes.map((definition) => ({ ...definition, selectable: true, historical: false }))
jest.mock('../editor/useEventTypeCatalog', () => ({
  ...jest.requireActual('../editor/useEventTypeCatalog'),
  useEventTypeCatalog: () => ({ status: 'ready', items: catalog, retry: jest.fn() }),
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

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', '') },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open') },
  })
})

// The dismissal suite mocks the confirm hook. This one runs the real shared
// ConfirmDialog, because the guarantee under test depends on how that dialog
// listens for Cmd/Ctrl+Enter.
it('keeps the draft when the save shortcut is pressed at the real discard prompt', async () => {
  const onOpenChange = jest.fn()
  renderWithProviders(<CalendarEventEditor open mode="create" typeLabels={{}} onOpenChange={onOpenChange} onSaved={() => {}} />)
  fireEvent.change(screen.getByLabelText('Draft title'), { target: { value: 'Unsaved event' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Outside overlay' })) })
  const discard = await screen.findByRole('button', { name: 'Discard changes' })
  const keepEditing = screen.getByRole('button', { name: 'Keep editing' })
  expect(discard.compareDocumentPosition(keepEditing) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()

  await act(async () => { fireEvent.keyDown(discard, { key: 'Enter', metaKey: true }) })
  await act(async () => { fireEvent.keyDown(discard, { key: 'Enter', ctrlKey: true }) })
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument()

  await act(async () => { fireEvent.click(keepEditing) })
  expect(onOpenChange).not.toHaveBeenCalled()

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Outside overlay' })) })
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' })) })
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
})
