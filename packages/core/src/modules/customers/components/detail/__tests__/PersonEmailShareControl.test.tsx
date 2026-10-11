/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PersonEmailShareControl } from '../PersonEmailShareControl'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: Record<string, string>, run: () => unknown) => run()),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation()),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

const SWITCH_LABEL = /share this conversation with my team/i

function shareState(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    result: { sharedByMe: false, canShare: false, updatedAt: null, sharedBy: [], ...overrides },
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
})

/**
 * #6455 — the switch did not appear after sending the first email.
 *
 * `canShare` only turns true once the caller owns a private email interaction
 * with this Person, and that row is written by a queue worker AFTER the send
 * completes. The control read the endpoint once on mount, so on a first send the
 * read was always too early and the switch stayed hidden until a manual refresh.
 * It now re-reads whenever the host re-reads the thread list.
 */
describe('PersonEmailShareControl reload cadence (#6455)', () => {
  it('renders nothing while the caller has no conversation to share', async () => {
    mockApiCall.mockResolvedValue(shareState())
    renderWithProviders(<PersonEmailShareControl personId="p1" />)

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('switch', { name: SWITCH_LABEL })).not.toBeInTheDocument()
  })

  it('reveals the switch when a later reload reports canShare, with no remount', async () => {
    // First read: the interaction row does not exist yet (worker still running).
    mockApiCall.mockResolvedValueOnce(shareState({ canShare: false }))
    // The host's post-send poll fires; by now the email has been linked.
    mockApiCall.mockResolvedValue(shareState({ canShare: true }))

    const { rerender } = renderWithProviders(
      <PersonEmailShareControl personId="p1" reloadToken={0} />,
    )
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('switch', { name: SWITCH_LABEL })).not.toBeInTheDocument()

    rerender(<PersonEmailShareControl personId="p1" reloadToken={1} />)

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: SWITCH_LABEL })).toBeInTheDocument(),
    )
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })

  it('re-reads on every bump so a teammate\'s share surfaces too', async () => {
    mockApiCall.mockResolvedValue(shareState())
    const { rerender } = renderWithProviders(
      <PersonEmailShareControl personId="p1" reloadToken={0} />,
    )
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))

    rerender(<PersonEmailShareControl personId="p1" reloadToken={1} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))

    rerender(<PersonEmailShareControl personId="p1" reloadToken={2} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(3))
  })

  it('does not re-read when the token is unchanged', async () => {
    mockApiCall.mockResolvedValue(shareState({ canShare: true }))
    const { rerender } = renderWithProviders(
      <PersonEmailShareControl personId="p1" reloadToken={3} />,
    )
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))

    // An unrelated parent re-render must not multiply the polling.
    rerender(<PersonEmailShareControl personId="p1" reloadToken={3} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
  })

  it('shows the teammate badge once a share appears on a later reload', async () => {
    mockApiCall.mockResolvedValueOnce(shareState())
    mockApiCall.mockResolvedValue(
      shareState({ sharedBy: [{ userId: 'u1', userName: 'Ada Owner', sharedAt: null }] }),
    )

    const { rerender } = renderWithProviders(
      <PersonEmailShareControl personId="p1" reloadToken={0} />,
    )
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/shared by/i)).not.toBeInTheDocument()

    rerender(<PersonEmailShareControl personId="p1" reloadToken={1} />)
    await waitFor(() => expect(screen.getByText(/Shared by Ada Owner/i)).toBeInTheDocument())
  })

  it('keeps the control hidden when the read fails', async () => {
    mockApiCall.mockRejectedValue(new Error('network down'))
    renderWithProviders(<PersonEmailShareControl personId="p1" reloadToken={0} />)

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('switch', { name: SWITCH_LABEL })).not.toBeInTheDocument()
  })
})
