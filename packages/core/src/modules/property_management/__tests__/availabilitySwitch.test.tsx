/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { AvailabilityCell, AvailabilityStateProvider } from '../components/availability/AvailabilityCell'
import type { UnavailabilitiesState } from '../components/availability/useUnavailabilities'
import type { UnavailabilityRow } from '../components/availability/availabilityModel'

const mockGrantedFeatures: { current: string[] } = { current: ['property_management.availability.manage'] }
const mockApiCall = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/property_management/floors/floor-1',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures.current } }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(async (_headers: Record<string, string>, operation: () => Promise<unknown>) => operation()),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('../components/availability/AvailabilityDialog', () => ({
  AvailabilityDialog: ({ subject }: { subject: { name: string } | null }) =>
    subject ? <div data-testid="pm-availability-dialog">{subject.name}</div> : null,
}))

const SUBJECT = { type: 'space' as const, id: 'space-1', name: 'Atrium' }

type SpaceRow = { id: string; name: string }

function stateOf(patch: Partial<UnavailabilitiesState> = {}): UnavailabilitiesState {
  return { rows: [], loading: false, refreshing: false, error: false, reload: jest.fn(), ...patch }
}

function closure(subjectType: UnavailabilityRow['subjectType'], subjectId: string): UnavailabilityRow {
  return {
    id: `closure-${subjectId}`,
    buildingId: 'building-1',
    subjectType,
    subjectId,
    reasonLabel: null,
    reasonText: 'Renovation',
    startsAt: '2026-01-01T00:00',
    endsAt: null,
    effectiveEndsAt: null,
    inEffect: true,
    applyStatus: 'applied',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function renderCell(state: UnavailabilitiesState, props: { disabled?: boolean; ancestors?: { type: 'floor' | 'building'; id: string }[] } = {}) {
  const ui = (value: UnavailabilitiesState) => (
    <AvailabilityStateProvider value={value}>
      <AvailabilityCell subject={SUBJECT} ancestors={props.ancestors} disabled={props.disabled} />
    </AvailabilityStateProvider>
  )
  const view = renderWithProviders(ui(state))
  return { ...view, update: (next: UnavailabilitiesState) => view.rerender(ui(next)) }
}

function SpacesTable({ state, rows }: { state: UnavailabilitiesState; rows: SpaceRow[] }) {
  const t = useT()
  const columns = React.useMemo<ColumnDef<SpaceRow>[]>(() => [
    { accessorKey: 'name', header: t('property_management.spaces.columns.name', 'Space') },
    {
      id: 'available',
      header: t('property_management.availability.column', 'Available'),
      meta: { truncate: false },
      cell: ({ row }) => <AvailabilityCell subject={{ type: 'space', id: row.original.id, name: row.original.name }} />,
    },
  ], [t])
  return (
    <AvailabilityStateProvider value={state}>
      <DataTable<SpaceRow> title="Spaces" columns={columns} data={rows} />
    </AvailabilityStateProvider>
  )
}

function renderTable(state: UnavailabilitiesState, rows: SpaceRow[]) {
  const view = renderWithProviders(<SpacesTable state={state} rows={rows} />)
  return { ...view, update: (nextState: UnavailabilitiesState, nextRows: SpaceRow[]) => view.rerender(<SpacesTable state={nextState} rows={nextRows} />) }
}

const spaceRows = (): SpaceRow[] => [{ id: SUBJECT.id, name: SUBJECT.name }, { id: 'space-2', name: 'Loft' }]

const switchOf = () => screen.getByTestId(`pm-availability-switch-${SUBJECT.type}-${SUBJECT.id}`)

describe('AvailabilitySwitch', () => {
  beforeEach(() => {
    mockGrantedFeatures.current = ['property_management.availability.manage']
  })

  it('keeps an open closure dialog while the DataTable rows and availability state refresh', async () => {
    const reload = jest.fn()
    const view = renderTable(stateOf({ reload }), spaceRows())
    const control = await screen.findByTestId(`pm-availability-switch-${SUBJECT.type}-${SUBJECT.id}`)
    fireEvent.click(control)
    expect(screen.getByTestId('pm-availability-dialog')).toHaveTextContent('Atrium')
    view.update(stateOf({ reload, refreshing: true }), spaceRows())
    view.update(stateOf({ reload, rows: [closure('space', 'other-space')] }), spaceRows())
    expect(switchOf()).toBe(control)
    expect(screen.getByTestId('pm-availability-dialog')).toHaveTextContent('Atrium')
  })

  it('stays focusable but ignores toggles while it cannot be changed', () => {
    mockGrantedFeatures.current = []
    renderCell(stateOf())
    const control = switchOf()
    expect(control).not.toBeDisabled()
    expect(control).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(control)
    expect(screen.queryByTestId('pm-availability-dialog')).not.toBeInTheDocument()
  })

  it('moves focus from the switch to the retry button when loading fails', () => {
    const view = renderCell(stateOf())
    act(() => switchOf().focus())
    view.update(stateOf({ error: true }))
    expect(screen.getByTestId(`pm-availability-retry-${SUBJECT.id}`)).toHaveFocus()
  })

  it('returns focus to the switch after a successful retry, even for an archived subject', () => {
    const reload = jest.fn()
    const view = renderCell(stateOf({ reload, error: true }), { disabled: true })
    const retry = screen.getByTestId(`pm-availability-retry-${SUBJECT.id}`)
    act(() => retry.focus())
    fireEvent.click(retry)
    expect(reload).toHaveBeenCalled()
    view.update(stateOf({ reload, loading: true }))
    view.update(stateOf({ reload }))
    expect(switchOf()).toHaveFocus()
  })

  it('reads its own and its ancestors\' closures when the shared list was truncated', async () => {
    mockApiCall.mockReset().mockResolvedValue({ ok: true, result: { items: [closure('floor', 'floor-1')], truncated: false } })
    renderCell(stateOf({ rows: [], truncated: true }), { ancestors: [{ type: 'floor', id: 'floor-1' }] })
    await waitFor(() => expect(screen.getByTestId(`pm-availability-state-${SUBJECT.id}`)).toHaveTextContent('Unavailable — set on its floor'))
    const [url] = mockApiCall.mock.calls[0] as [string]
    const params = new URL(url, 'http://localhost').searchParams
    expect(params.get('subjectIds')).toBe(`${SUBJECT.id},floor-1`)
    expect(params.get('buildingIds')).toBeNull()
  })

  it('does not report a subject as available while the truncated list is being completed', () => {
    mockApiCall.mockReset().mockReturnValue(new Promise(() => undefined))
    renderCell(stateOf({ rows: [], truncated: true }))
    expect(screen.getByTestId(`pm-availability-state-${SUBJECT.id}`)).toHaveTextContent('Checking…')
    expect(switchOf()).toHaveAttribute('aria-disabled', 'true')
  })

  it('labels a switch closed through an ancestor as its own availability', () => {
    renderCell(stateOf({ rows: [closure('floor', 'floor-1')] }), { ancestors: [{ type: 'floor', id: 'floor-1' }] })
    expect(switchOf()).toHaveAttribute('aria-label', 'Atrium available on its own')
  })
})
