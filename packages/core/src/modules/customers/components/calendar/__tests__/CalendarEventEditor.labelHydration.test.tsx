/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { calendarEventTypes } from '../../../calendar-event-types'
import translations from '../../../i18n/en.json'
import { CalendarEventEditor } from '../CalendarEventEditor'
import { buildCalendarItem } from './fixtures'

const confirmMock = jest.fn()
const resolveRelatedMock = jest.fn()
const triggerEventMock = jest.fn(async (_event: string, data: unknown) => ({ ok: true, data }))
const catalog = calendarEventTypes.map((definition) => ({ ...definition, selectable: true, historical: false }))
let activeOrgId = 'org-1'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/backend/calendar',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useCurrentOrganization: () => ({ id: activeOrgId }) }))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: triggerEventMock }),
}))
jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))
jest.mock('../editor/useEventTypeCatalog', () => ({
  ...jest.requireActual('../editor/useEventTypeCatalog'),
  useEventTypeCatalog: () => ({ status: 'ready', items: catalog, retry: jest.fn() }),
}))
jest.mock('../editor/useCalendarCustomFields', () => ({
  ...jest.requireActual('../editor/useCalendarCustomFields'),
  useCalendarCustomFields: () => ({ status: 'ready', fields: [], definitions: [] }),
}))
jest.mock('../editor/hooks', () => ({
  ...jest.requireActual('../editor/hooks'),
  useConflictProbe: () => null,
}))
jest.mock('../editor/lookups', () => ({
  fetchRelatedEntityById: (...args: unknown[]) => resolveRelatedMock(...args),
  fetchDealById: jest.fn(),
  findStaffMemberName: jest.fn(),
}))
jest.mock('../editor/EventTypePanel', () => ({ EventTypePanel: () => null }))
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <>{children}</> : null,
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown: React.KeyboardEventHandler }) =>
    <div role="dialog" onKeyDown={onKeyDown}>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

type ResolvedPerson = { id: string; kind: 'person'; label: string }

function pendingLookup() {
  let resolve: (person: ResolvedPerson) => void = () => {}
  const promise = new Promise<ResolvedPerson>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function editor(item = buildCalendarItem({ entityId: 'person-1' }), onOpenChange = jest.fn()) {
  return <CalendarEventEditor open mode="edit" item={item} onOpenChange={onOpenChange} onSaved={() => {}} />
}

beforeEach(() => {
  confirmMock.mockReset().mockResolvedValue(false)
  resolveRelatedMock.mockReset()
  triggerEventMock.mockClear()
  activeOrgId = 'org-1'
})

it('keeps an untouched edit pristine when its related record label resolves late, so Escape closes it', async () => {
  const lookup = pendingLookup()
  resolveRelatedMock.mockReturnValue(lookup.promise)
  const onOpenChange = jest.fn()
  renderWithProviders(editor(undefined, onOpenChange), { dict: translations })
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Quarterly review'))
  await act(async () => { lookup.resolve({ id: 'person-1', kind: 'person', label: 'Alice Customer' }) })
  await screen.findByText('Alice Customer')
  await act(async () => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }) })
  expect(confirmMock).not.toHaveBeenCalled()
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('preserves an actual title edit while the lookup resolves and still asks before discarding it', async () => {
  const lookup = pendingLookup()
  resolveRelatedMock.mockReturnValue(lookup.promise)
  const onOpenChange = jest.fn()
  renderWithProviders(editor(undefined, onOpenChange), { dict: translations })
  const title = screen.getByRole('textbox', { name: 'Title', exact: true })
  await act(async () => { fireEvent.change(title, { target: { value: 'My unsaved draft' } }) })
  await act(async () => { lookup.resolve({ id: 'person-1', kind: 'person', label: 'Alice Customer' }) })
  await screen.findByText('Alice Customer')
  expect(title).toHaveValue('My unsaved draft')
  await act(async () => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }) })
  expect(confirmMock).toHaveBeenCalledTimes(1)
  expect(onOpenChange).not.toHaveBeenCalled()
})

it('keeps a user-cleared related record cleared when the original label lookup resolves', async () => {
  const lookup = pendingLookup()
  resolveRelatedMock.mockReturnValue(lookup.promise)
  const onOpenChange = jest.fn()
  renderWithProviders(editor(undefined, onOpenChange), { dict: translations })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear related record' })) })
  await act(async () => { lookup.resolve({ id: 'person-1', kind: 'person', label: 'Alice Customer' }) })
  expect(screen.queryByText('Alice Customer')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Clear related record' })).not.toBeInTheDocument()
  await act(async () => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }) })
  expect(confirmMock).toHaveBeenCalledTimes(1)
  expect(onOpenChange).not.toHaveBeenCalled()
})

it('does not apply a stale label response after switching the edited record', async () => {
  const firstLookup = pendingLookup()
  const secondLookup = pendingLookup()
  resolveRelatedMock.mockImplementation((id: string) => id === 'person-1' ? firstLookup.promise : secondLookup.promise)
  const onOpenChange = jest.fn()
  const rendered = renderWithProviders(editor(undefined, onOpenChange), { dict: translations })
  rendered.rerender(editor(buildCalendarItem({ id: 'item-2', title: 'Second record', entityId: 'person-2' }), onOpenChange))
  await act(async () => { firstLookup.resolve({ id: 'person-1', kind: 'person', label: 'First Customer' }) })
  await act(async () => { secondLookup.resolve({ id: 'person-2', kind: 'person', label: 'Second Customer' }) })
  await screen.findByText('Second Customer')
  expect(screen.queryByText('First Customer')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Second record')
  await act(async () => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }) })
  expect(confirmMock).not.toHaveBeenCalled()
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('resolves a changed related identity on the same record without reusing the previous label', async () => {
  const firstLookup = pendingLookup()
  const secondLookup = pendingLookup()
  resolveRelatedMock.mockImplementation((id: string) => id === 'person-1' ? firstLookup.promise : secondLookup.promise)
  const onOpenChange = jest.fn()
  const rendered = renderWithProviders(editor(undefined, onOpenChange), { dict: translations })
  await act(async () => { firstLookup.resolve({ id: 'person-1', kind: 'person', label: 'Previous Customer' }) })
  await screen.findByText('Previous Customer')
  rendered.rerender(editor(buildCalendarItem({ entityId: 'person-2' }), onOpenChange))
  expect(screen.queryByText('Previous Customer')).not.toBeInTheDocument()
  await act(async () => { secondLookup.resolve({ id: 'person-2', kind: 'person', label: 'Current Customer' }) })
  await screen.findByText('Current Customer')
  await act(async () => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }) })
  expect(confirmMock).not.toHaveBeenCalled()
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('drops resolved labels and rejects a stale lookup when the organization changes', async () => {
  const firstLookup = pendingLookup()
  const secondLookup = pendingLookup()
  const thirdLookup = pendingLookup()
  resolveRelatedMock.mockImplementation(() => activeOrgId === 'org-1'
    ? firstLookup.promise
    : activeOrgId === 'org-2' ? secondLookup.promise : thirdLookup.promise)
  const onOpenChange = jest.fn()
  const item = buildCalendarItem({ entityId: 'person-1' })
  const rendered = renderWithProviders(editor(item, onOpenChange), { dict: translations })
  await act(async () => { firstLookup.resolve({ id: 'person-1', kind: 'person', label: 'First organization label' }) })
  await screen.findByText('First organization label')
  activeOrgId = 'org-2'
  rendered.rerender(editor(item, onOpenChange))
  expect(screen.queryByText('First organization label')).not.toBeInTheDocument()
  activeOrgId = 'org-3'
  rendered.rerender(editor(item, onOpenChange))
  await act(async () => { secondLookup.resolve({ id: 'person-1', kind: 'person', label: 'Stale organization label' }) })
  await act(async () => { thirdLookup.resolve({ id: 'person-1', kind: 'person', label: 'Current organization label' }) })
  await screen.findByText('Current organization label')
  expect(screen.queryByText('Stale organization label')).not.toBeInTheDocument()
  await act(async () => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }) })
  expect(confirmMock).not.toHaveBeenCalled()
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
