/**
 * @jest-environment jsdom
 */
// The candidate list is fetched behind a debounce and used to be the only thing
// the dialog could report on: a failed request was collapsed into an empty list,
// so a broken `/api/staff/team-members` looked exactly like a tenant with no
// team members, and the "no results" copy was shown for the whole debounce
// window before the first request had even left.
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { AssignMembersDialog, type AssignMembersDialogLabels } from '../AssignMembersDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({
    children,
    onKeyDown,
  }: {
    children?: React.ReactNode
    onKeyDown?: (event: React.KeyboardEvent) => void
  }) => <div onKeyDown={onKeyDown}>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}))

const readApiResultOrThrowMock = readApiResultOrThrow as unknown as jest.Mock

const labels: AssignMembersDialogLabels = {
  title: 'Assign members',
  description: 'Selected projects: 2.',
  searchPlaceholder: 'Search team members...',
  empty: 'No team members found',
  loadError: 'Could not load team members. Check your connection and try again.',
  loading: 'Loading employees...',
  role: 'Role on Project',
  rolePlaceholder: 'e.g. Developer, Designer...',
  startDate: 'Assignment Start Date',
  cancel: 'Cancel',
  confirm: 'Assign',
}

function renderDialog(overrides: { isSaving?: boolean } = {}) {
  return render(
    <AssignMembersDialog
      open
      onOpenChange={jest.fn()}
      labels={labels}
      isSaving={overrides.isSaving ?? false}
      onConfirm={jest.fn()}
    />,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  readApiResultOrThrowMock.mockResolvedValue({ items: [] })
})

afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

describe('AssignMembersDialog candidate loading', () => {
  it('shows the loading state instead of "no results" before the debounced request fires', () => {
    renderDialog()

    expect(screen.getByText(labels.loading)).toBeTruthy()
    expect(screen.queryByText(labels.empty)).toBeNull()
    expect(readApiResultOrThrowMock).not.toHaveBeenCalled()
  })

  it('surfaces a failed candidate fetch as an error instead of an empty roster', async () => {
    readApiResultOrThrowMock.mockRejectedValue(new Error('candidate lookup failed'))
    renderDialog()

    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByText(labels.loadError)).toBeTruthy()
    expect(screen.queryByText(labels.empty)).toBeNull()
  })

  it('shows the empty copy only when the request succeeded with no candidates', async () => {
    renderDialog()

    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    await waitFor(() => {
      expect(screen.getByText(labels.empty)).toBeTruthy()
    })
    expect(screen.queryByText(labels.loadError)).toBeNull()
  })
})

describe('AssignMembersDialog confirm button', () => {
  it('renders a pending indicator while the assignment is saving', () => {
    renderDialog({ isSaving: true })

    const confirmButton = screen.getByRole('button', { name: new RegExp(labels.confirm) })
    expect(within(confirmButton).getByRole('status')).toBeTruthy()
    expect(confirmButton.hasAttribute('disabled')).toBe(true)
  })

  it('renders no pending indicator when idle', () => {
    renderDialog()

    const confirmButton = screen.getByRole('button', { name: new RegExp(labels.confirm) })
    expect(within(confirmButton).queryByRole('status')).toBeNull()
  })
})
