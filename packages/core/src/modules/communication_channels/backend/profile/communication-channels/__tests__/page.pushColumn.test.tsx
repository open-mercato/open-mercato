/**
 * @jest-environment jsdom
 */

// Regression for https://github.com/open-mercato/open-mercato/issues/4980 — the
// "Push" column read `providerKey === 'gmail'`, so every other provider rendered
// "Polling only" no matter what its adapter declared, and "Poll now" stayed
// clickable for channels the poll worker skips by definition.

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import ProfileCommunicationChannelsPage from '../page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type ChannelRow = {
  id: string
  providerKey: string
  channelType: string
  displayName: string
  externalIdentifier: string | null
  isPrimary: boolean
  visibility: 'private' | 'shared'
  updatedAt: string | null
  isActive: boolean
  status: string
  lastError: string | null
  pollIntervalSeconds: number | null
  lastPolledAt: string | null
  pushStatus: string | null
  lastPushError: { code: string | null; message: string | null; at: string | null } | null
  supportsRealtimePush: boolean
  supportsPushRegistration: boolean
  createdAt: string | null
}

let capturedColumns: ColumnDef<ChannelRow>[] = []
let capturedRowActions: ((row: ChannelRow) => React.ReactNode) | null = null

// Resolve against the real English dictionary rather than the inline fallbacks:
// production `t()` is `dict[key] ?? fallback`, so a fallback-first stub would
// assert copy no user ever sees and would hide a key that resolves to the wrong
// string. Stable identity matters too — the page's channel-loading effect
// depends on `t`, so a fresh function per render would re-fire it forever.
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const dict = require('../../../../i18n/en.json') as Record<string, string>
  const translate = (key: string, fallback?: string) => dict[key] ?? fallback ?? key
  return { useT: () => translate }
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: {
    columns: ColumnDef<ChannelRow>[]
    rowActions?: (row: ChannelRow) => React.ReactNode
  }) => {
    capturedColumns = props.columns
    // The per-row menu is passed as DataTable's `rowActions` prop, not as a
    // column, so that the real table can merge injected row actions into it.
    capturedRowActions = props.rowActions ?? null
    return <div data-testid="data-table-mock" />
  },
}))

// `ConnectChannelMenu` (the header's connect dropdown, #5595) reads the spot's
// widgets through `useInjectionWidgets`; with none injected it renders nothing,
// which is what this push-column suite assumes.
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

function buildRow(overrides: Partial<ChannelRow>): ChannelRow {
  return {
    id: 'channel-1',
    providerKey: 'discord',
    channelType: 'chat',
    displayName: 'OM QA Test (Discord)',
    externalIdentifier: null,
    isPrimary: false,
    visibility: 'private',
    updatedAt: null,
    isActive: true,
    status: 'connected',
    lastError: null,
    pollIntervalSeconds: null,
    lastPolledAt: null,
    pushStatus: null,
    lastPushError: null,
    supportsRealtimePush: true,
    supportsPushRegistration: false,
    createdAt: null,
    ...overrides,
  }
}

function findColumn(columnId: string) {
  return capturedColumns.find(
    (candidate) =>
      (candidate as { id?: string }).id === columnId ||
      (candidate as { accessorKey?: string }).accessorKey === columnId,
  )
}

function renderCell(columnId: string, row: ChannelRow) {
  const column = capturedColumns.find(
    (candidate) =>
      (candidate as { id?: string }).id === columnId ||
      (candidate as { accessorKey?: string }).accessorKey === columnId,
  )
  if (!column || typeof column.cell !== 'function') {
    throw new Error(`[internal] column "${columnId}" has no cell renderer`)
  }
  const cell = column.cell as (context: { row: { original: ChannelRow } }) => React.ReactNode
  return render(<>{cell({ row: { original: row } })}</>)
}

/**
 * Renders the `actions` cell and opens its menu. `RowActions` only mounts its
 * items once open, so every menu assertion has to go through the trigger.
 */
function openRowActions(row: ChannelRow) {
  if (!capturedRowActions) throw new Error('[internal] DataTable received no rowActions prop')
  render(<>{capturedRowActions(row)}</>)
  fireEvent.click(screen.getByRole('button', { name: 'Open actions' }))
}

function menuItemNames(): string[] {
  return screen.getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '')
}

async function mountPage() {
  capturedColumns = []
  capturedRowActions = null
  apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } } as never)
  await act(async () => {
    render(<ProfileCommunicationChannelsPage />)
  })
  await waitFor(() => expect(capturedColumns.length).toBeGreaterThan(0))
}

describe('profile communication channels — push column and poll action', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    await mountPage()
  })

  it('titles the column "Push", not the "Push active" status string', () => {
    // The header used to share `push.status.active` with the status tag, so it
    // rendered "Push active" above rows that said "Polling only".
    expect(findColumn('pushStatus')?.header).toBe('Push')
  })

  it('labels a push-driven channel as push-driven, not "Polling only"', () => {
    renderCell('pushStatus', buildRow({}))

    expect(screen.getByText('Push-driven')).toBeInTheDocument()
    expect(screen.queryByText('Polling only')).not.toBeInTheDocument()
  })

  it('surfaces a broken push connection without offering a registration it cannot do', () => {
    renderCell(
      'pushStatus',
      buildRow({ pushStatus: 'failed', lastPushError: { code: '4014', message: 'Disallowed intent', at: null } }),
    )

    expect(screen.getByText('Push connection failed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Re-register push' })).not.toBeInTheDocument()
  })

  it('keeps "Polling only" for a hub-polled provider without push registration', () => {
    renderCell(
      'pushStatus',
      buildRow({ providerKey: 'imap', supportsRealtimePush: false, supportsPushRegistration: false }),
    )

    expect(screen.getByText('Polling only')).toBeInTheDocument()
  })

  it('keeps the Gmail re-register affordance intact, now in the row actions menu', () => {
    const gmail = buildRow({
      providerKey: 'gmail',
      supportsRealtimePush: false,
      supportsPushRegistration: true,
    })
    renderCell('pushStatus', gmail)

    // Gmail is hub-polled, so "Polling only" is the truthful idle label there.
    // The Push column is status-only now, so the action is not beside it.
    expect(screen.getByText('Polling only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Re-register push' })).not.toBeInTheDocument()

    openRowActions(gmail)
    expect(screen.getByRole('menuitem', { name: 'Re-register push' })).toBeInTheDocument()
  })

  it('does not claim polling for a registerable push provider that the hub never polls', () => {
    // A provider that both declares realtimePush and can register push has no
    // polling fallback at all — the idle state must not say "Polling only".
    const webhook = buildRow({
      providerKey: 'future-webhook',
      supportsRealtimePush: true,
      supportsPushRegistration: true,
    })
    renderCell('pushStatus', webhook)

    expect(screen.getByText('Push not registered')).toBeInTheDocument()
    expect(screen.queryByText('Polling only')).not.toBeInTheDocument()

    openRowActions(webhook)
    expect(screen.getByRole('menuitem', { name: 'Re-register push' })).toBeInTheDocument()
  })

  it('omits "Poll now" for a push-driven channel and keeps the reason visible', () => {
    const pushDriven = buildRow({})
    openRowActions(pushDriven)

    // `RowActionItem` has no disabled state, so an impossible action is absent
    // rather than greyed out.
    expect(screen.queryByRole('menuitem', { name: /Poll now/ })).not.toBeInTheDocument()

    // The explanation the disabled button used to carry must not be lost — it
    // now rides on the Push column's status tag.
    renderCell('pushStatus', pushDriven)
    expect(screen.getByTitle(/polling does not apply/i)).toBeInTheDocument()
  })

  it('offers "Poll now" for a hub-polled channel', () => {
    openRowActions(
      buildRow({ providerKey: 'imap', supportsRealtimePush: false, pollIntervalSeconds: 300 }),
    )

    expect(screen.getByRole('menuitem', { name: 'Poll now' })).toBeInTheDocument()
  })

  it('labels the poll action "Retry" on a channel in error', () => {
    openRowActions(
      buildRow({ providerKey: 'imap', supportsRealtimePush: false, status: 'error' }),
    )

    expect(screen.getByRole('menuitem', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Poll now' })).not.toBeInTheDocument()
  })
})

describe('profile communication channels — row actions menu', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    await mountPage()
  })

  it('collapses every per-row action into DataTable’s own actions cell', () => {
    for (const removed of ['importHistory', 'pollNow', 'disconnect']) {
      expect(findColumn(removed)).toBeUndefined()
    }
    // Handed to DataTable as `rowActions`, never as a hand-rolled column — that
    // is what lets the table merge row actions injected by other modules into
    // this same menu instead of rendering a second one.
    expect(findColumn('actions')).toBeUndefined()
    expect(capturedRowActions).toBeInstanceOf(Function)
  })

  it('always offers Disconnect, and marks it destructive', () => {
    openRowActions(buildRow({}))

    const disconnect = screen.getByRole('menuitem', { name: 'Disconnect' })
    expect(disconnect).toBeInTheDocument()
    expect(disconnect.className).toMatch(/text-destructive/)
  })

  it('omits "Set as primary" on a channel that already is primary', () => {
    openRowActions(buildRow({ isPrimary: true }))

    expect(screen.queryByRole('menuitem', { name: 'Set as primary' })).not.toBeInTheDocument()
  })

  it('offers "Share with team" on a private email channel', () => {
    openRowActions(buildRow({ channelType: 'email', visibility: 'private' }))

    expect(screen.getByRole('menuitem', { name: 'Share with team' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Make private' })).not.toBeInTheDocument()
  })

  it('offers "Make private" on a shared email channel', () => {
    openRowActions(buildRow({ channelType: 'email', visibility: 'shared' }))

    expect(screen.getByRole('menuitem', { name: 'Make private' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Share with team' })).not.toBeInTheDocument()
  })

  it('omits the share flip on a non-email channel', () => {
    // Only email ingestion writes customer_interactions, so sharing a chat or
    // push channel would flash success while changing nothing observable.
    openRowActions(buildRow({ channelType: 'chat' }))

    expect(screen.queryByRole('menuitem', { name: 'Share with team' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Make private' })).not.toBeInTheDocument()
  })

  it('offers Import history only for a connected, active email channel', () => {
    openRowActions(buildRow({ channelType: 'email', isActive: true, status: 'connected' }))
    expect(screen.getByRole('menuitem', { name: 'Import history' })).toBeInTheDocument()
  })

  it('omits Import history on a channel that is not connected', () => {
    openRowActions(buildRow({ channelType: 'email', isActive: true, status: 'requires_reauth' }))

    expect(screen.queryByRole('menuitem', { name: 'Import history' })).not.toBeInTheDocument()
    // The row still explains itself through the Status column.
    expect(menuItemNames()).toContain('Disconnect')
  })
})
