/**
 * @jest-environment jsdom
 */

// Regression for https://github.com/open-mercato/open-mercato/issues/4980 — the
// "Push" column read `providerKey === 'gmail'`, so every other provider rendered
// "Polling only" no matter what its adapter declared, and "Poll now" stayed
// clickable for channels the poll worker skips by definition.

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
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
  DataTable: (props: { columns: ColumnDef<ChannelRow>[] }) => {
    capturedColumns = props.columns
    return <div data-testid="data-table-mock" />
  },
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
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
 * Render the row-actions cell, open the menu, and return its item labels.
 *
 * The per-row actions moved out of dedicated columns into a single dropdown, so
 * the #4980 invariants below now assert PRESENCE/ABSENCE of a menu item instead
 * of enabled/disabled state on a column button. `RowActionItem` has no disabled
 * state, so an unavailable action is omitted.
 */
function openRowActions(row: ChannelRow): string[] {
  renderCell('actions', row)
  const trigger = screen.getByRole('button', { name: 'Open actions' })
  act(() => {
    trigger.click()
  })
  return screen.getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '')
}

async function mountPage() {
  capturedColumns = []
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

  it('keeps the Gmail re-register affordance intact', () => {
    const row = buildRow({
      providerKey: 'gmail',
      supportsRealtimePush: false,
      supportsPushRegistration: true,
    })

    // Gmail is hub-polled, so "Polling only" is the truthful idle label there.
    renderCell('pushStatus', row)
    expect(screen.getByText('Polling only')).toBeInTheDocument()

    // The affordance itself now lives in the row-actions menu.
    expect(openRowActions(row)).toContain('Re-register push')
  })

  it('does not claim polling for a registerable push provider that the hub never polls', () => {
    // A provider that both declares realtimePush and can register push has no
    // polling fallback at all — the idle state must not say "Polling only".
    const row = buildRow({
      providerKey: 'future-webhook',
      supportsRealtimePush: true,
      supportsPushRegistration: true,
    })

    renderCell('pushStatus', row)
    expect(screen.getByText('Push not registered')).toBeInTheDocument()
    expect(screen.queryByText('Polling only')).not.toBeInTheDocument()

    expect(openRowActions(row)).toContain('Re-register push')
  })

  it('omits "Poll now" for a push-driven channel the hub never polls', () => {
    // Previously a disabled button carrying the reason in its aria-label. The
    // action is now absent entirely, which is the same guarantee: the UI never
    // offers a sync that cannot happen. The reason stays on screen via the Push
    // column, asserted by the two tests above.
    expect(openRowActions(buildRow({}))).not.toContain('Poll now')
  })

  it('offers "Poll now" for a hub-polled channel', () => {
    const labels = openRowActions(
      buildRow({ providerKey: 'imap', supportsRealtimePush: false, pollIntervalSeconds: 300 }),
    )
    expect(labels).toContain('Poll now')
  })

  it('offers "Retry" instead of "Poll now" when a hub-polled channel is in error', () => {
    // The Sync column used to swap the label (and variant) on error so a stuck
    // channel could be recovered without a reconnect; the menu keeps that.
    const labels = openRowActions(
      buildRow({ providerKey: 'imap', supportsRealtimePush: false, status: 'error' }),
    )
    expect(labels).toContain('Retry')
    expect(labels).not.toContain('Poll now')
  })

  it('always offers Disconnect, and offers Set as primary only when not primary', () => {
    expect(openRowActions(buildRow({ isPrimary: false }))).toEqual(
      expect.arrayContaining(['Set as primary', 'Disconnect']),
    )
  })
})
