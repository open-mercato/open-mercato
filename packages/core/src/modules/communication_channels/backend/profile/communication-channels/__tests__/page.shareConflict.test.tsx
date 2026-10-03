/**
 * @jest-environment jsdom
 */

// Regression for https://github.com/open-mercato/open-mercato/issues/6720 — the
// share toggle's `apiCall` does not throw on a 409, so a stale "Share with team"
// click toasted the raw `record_modified` code instead of raising the conflict bar.

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { dismissRecordConflict, getRecordConflictForTest } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import ProfileCommunicationChannelsPage from '../page'

type ChannelRow = {
  id: string
  channelType: string
  visibility: 'private' | 'shared'
  updatedAt: string | null
}

let capturedRowActions: ((row: ChannelRow) => React.ReactNode) | null = null
const runMutationMock = jest.fn()

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
  DataTable: (props: { rowActions?: (row: ChannelRow) => React.ReactNode }) => {
    capturedRowActions = props.rowActions ?? null
    return <div data-testid="data-table-mock" />
  },
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>
const flashMock = flash as jest.MockedFunction<typeof flash>

const privateMailbox: ChannelRow = {
  id: 'channel-1',
  channelType: 'email',
  visibility: 'private',
  updatedAt: '2026-09-30T10:00:00.000Z',
}

async function clickShareWithTeam() {
  if (!capturedRowActions) throw new Error('[internal] DataTable received no rowActions prop')
  render(<>{capturedRowActions(privateMailbox)}</>)
  fireEvent.click(screen.getByRole('button', { name: 'Open actions' }))
  const shareAction = await screen.findByRole('menuitem', { name: 'Share with team' })
  await act(async () => {
    fireEvent.click(shareAction)
  })
}

describe('profile communication channels — share toggle conflict', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    dismissRecordConflict()
    capturedRowActions = null
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } } as never)
    await act(async () => {
      render(<ProfileCommunicationChannelsPage />)
    })
    await waitFor(() => expect(capturedRowActions).not.toBeNull())
  })

  it('raises the conflict bar instead of toasting the raw record_modified code on a 409', async () => {
    runMutationMock.mockResolvedValue({
      ok: false,
      status: 409,
      result: {
        error: 'record_modified',
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        currentUpdatedAt: '2026-09-30T10:05:00.000Z',
        expectedUpdatedAt: '2026-09-30T10:00:00.000Z',
      },
    })

    await clickShareWithTeam()

    await waitFor(() => expect(getRecordConflictForTest()).not.toBeNull())
    expect(getRecordConflictForTest()?.message).toBe(
      'This record was modified by someone else. Refresh and try again.',
    )
    expect(getRecordConflictForTest()?.currentUpdatedAt).toBe('2026-09-30T10:05:00.000Z')
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('still toasts a non-conflict failure', async () => {
    runMutationMock.mockResolvedValue({ ok: false, status: 500, result: { error: 'Boom' } })

    await clickShareWithTeam()

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Boom', 'error'))
    expect(getRecordConflictForTest()).toBeNull()
  })
})
