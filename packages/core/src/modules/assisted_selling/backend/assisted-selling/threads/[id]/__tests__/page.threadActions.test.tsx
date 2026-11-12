/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import AssistedSellingThreadPage from '../page'

/**
 * #8268 QA on `0a4db5f64d` (S05c, S06c, E02, E03): the thread page's own write controls.
 * - Join/Leave/Assign need `assisted_selling.threads.participate` and the composer needs
 *   `assisted_selling.messages.post`; a principal without them must not be offered controls
 *   whose endpoints always 403.
 * - A double click (or a double Ctrl+Enter) must send ONE request, and re-proposing the same
 *   proposal again reuses its idempotency key, so the server can answer a retry as a replay.
 * - Re-propose is not offered on a proposal that already has a successor (the server refuses it).
 * - A failed join is reported as a failure — `apiCall` does not throw on a non-2xx answer.
 */

const AUTHOR_FEATURES = ['assisted_selling.proposals.author', 'cart.proposals.author']

let mockGrantedFeatures: string[] = []
const mockWrite = jest.fn<Promise<unknown>, [string, RequestInit | undefined]>()
const mockFlash = jest.fn()

function proposalRow(id: string, status: string, supersededByProposalId: string | null = null) {
  return {
    id,
    status,
    authoredByActorType: 'rep',
    authoredByActorId: 'rep-1',
    publishedAt: null,
    expiresAt: null,
    resolvedAt: null,
    supersededByProposalId,
    currencyCode: 'USD',
    lines: [],
  }
}

const mockThreadDetail = {
  thread: {
    id: 'thread-1',
    storeId: 'store-1',
    buyerCartId: 'cart-1',
    customerId: null,
    customerUserId: null,
    status: 'open',
    assignedActorId: null,
    liveProposalCount: 1,
    updatedAt: null,
  },
  participants: [
    { id: 'participant-1', actorType: 'buyer' as const, actorId: null, displayName: 'Buyer', joinedAt: null, leftAt: null },
  ],
  messages: [
    { id: 'message-1', participantId: 'participant-1', body: 'Live', bodyFormat: 'text', proposalId: 'proposal-live', sentAt: null },
    { id: 'message-2', participantId: 'participant-1', body: 'Withdrawn', bodyFormat: 'text', proposalId: 'proposal-withdrawn', sentAt: null },
    { id: 'message-3', participantId: 'participant-1', body: 'Replaced', bodyFormat: 'text', proposalId: 'proposal-replaced', sentAt: null },
    { id: 'message-4', participantId: 'participant-1', body: 'Superseded', bodyFormat: 'text', proposalId: 'proposal-superseded', sentAt: null },
  ],
  proposals: [
    proposalRow('proposal-live', 'published'),
    proposalRow('proposal-withdrawn', 'withdrawn'),
    proposalRow('proposal-replaced', 'withdrawn', 'proposal-live'),
    proposalRow('proposal-superseded', 'superseded', 'proposal-live'),
  ],
}

const mockApiCall = jest.fn(async (url: string) => {
  if (url === '/api/auth/feature-check') {
    return { ok: true, result: { ok: true, granted: mockGrantedFeatures, userId: 'u1' } }
  }
  if (url.startsWith('/api/assisted_selling/threads/')) {
    return { ok: true, result: mockThreadDetail }
  }
  throw new Error(`unexpected apiCall ${url}`)
})

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: ({ showCount, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { showCount?: boolean }) => (
    <textarea data-show-count={showCount ? 'true' : undefined} {...props} />
  ),
}))

jest.mock('@open-mercato/ui/primitives/status-badge', () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string) => mockApiCall(url),
  withScopedApiRequestHeaders: <T,>(_headers: Record<string, string>, run: () => Promise<T>) => run(),
  readApiResultOrThrow: (url: string, init?: RequestInit) => mockWrite(url, init),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: () => false,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEventCoalesced', () => ({
  useAppEventCoalesced: () => undefined,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('../ProposalBuilderDialog', () => ({
  ProposalBuilderDialog: () => null,
}))

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function writesTo(suffix: string) {
  return mockWrite.mock.calls.filter(([url]) => url.endsWith(suffix))
}

async function renderPage(granted: string[]) {
  mockGrantedFeatures = granted
  renderWithProviders(<AssistedSellingThreadPage params={{ id: 'thread-1' }} />)
  await waitFor(() => expect(screen.getByText('Selling conversation')).toBeInTheDocument())
  await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith('/api/auth/feature-check'))
}

describe('AssistedSellingThreadPage thread actions (#8268 QA)', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
    mockWrite.mockReset()
    mockFlash.mockReset()
  })

  test('a thread viewer is offered no join/leave/assign controls and no composer', async () => {
    await renderPage([])

    expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Write a message...' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  test('threads.participate alone shows join/leave/assign but no composer', async () => {
    await renderPage(['assisted_selling.threads.participate'])

    await waitFor(() => expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign to me' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Write a message...' })).not.toBeInTheDocument()
  })

  test('messages.post shows the composer, capped at the server limit with a counter', async () => {
    await renderPage(['assisted_selling.messages.post'])

    const composer = await screen.findByRole('textbox', { name: 'Write a message...' })
    expect(composer).toHaveAttribute('maxLength', '2000')
    expect(composer).toHaveAttribute('data-show-count', 'true')
    expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument()
  })

  test('a double click on Withdraw sends one withdraw request and reports one success', async () => {
    const pending = deferred<unknown>()
    mockWrite.mockImplementation((url) => (url.endsWith('/withdraw') ? pending.promise : Promise.resolve({ ok: true })))
    await renderPage(AUTHOR_FEATURES)

    const withdraw = await screen.findByRole('button', { name: 'Withdraw' })
    fireEvent.click(withdraw)
    fireEvent.click(withdraw)
    expect(writesTo('/proposals/proposal-live/withdraw')).toHaveLength(1)

    pending.resolve({ ok: true })
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Proposal withdrawn.', 'success'))
    expect(writesTo('/withdraw')).toHaveLength(1)
    expect(mockFlash).not.toHaveBeenCalledWith('Failed to withdraw this proposal.', 'error')
  })

  test('a double click on Re-propose sends one re-author request', async () => {
    const pending = deferred<unknown>()
    mockWrite.mockImplementation((url) => (url.endsWith('/reauthor') ? pending.promise : Promise.resolve({ ok: true })))
    await renderPage(AUTHOR_FEATURES)

    const repropose = await screen.findByRole('button', { name: 'Re-propose' })
    fireEvent.click(repropose)
    fireEvent.click(repropose)
    pending.resolve({ proposalId: 'proposal-next', replayed: false })

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('New proposal authored.', 'success'))
    expect(writesTo('/reauthor')).toHaveLength(1)
    expect(mockFlash).not.toHaveBeenCalledWith('Failed to re-propose.', 'error')
  })

  test('retrying a failed Re-propose reuses the same idempotency key', async () => {
    mockWrite.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Unexpected error'), { status: 500 })
    })
    mockWrite.mockImplementationOnce(async () => ({ proposalId: 'proposal-next', replayed: true }))
    await renderPage(AUTHOR_FEATURES)

    const repropose = await screen.findByRole('button', { name: 'Re-propose' })
    fireEvent.click(repropose)
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Failed to re-propose.', 'error'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Re-propose' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Re-propose' }))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('New proposal authored.', 'success'))

    const keys = writesTo('/proposals/proposal-withdrawn/reauthor').map(([, init]) => JSON.parse(String(init?.body)).idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(typeof keys[0]).toBe('string')
    expect(keys[1]).toBe(keys[0])
  })

  test('Re-propose is offered only on an ended proposal without a successor', async () => {
    await renderPage(AUTHOR_FEATURES)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Re-propose' })).toHaveLength(1))
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1)
  })

  test('two Ctrl+Enter presses in the composer post one message', async () => {
    const pending = deferred<unknown>()
    mockWrite.mockImplementation((url) => (url.endsWith('/messages') ? pending.promise : Promise.resolve({ ok: true })))
    await renderPage(['assisted_selling.messages.post'])

    const composer = await screen.findByRole('textbox', { name: 'Write a message...' })
    fireEvent.change(composer, { target: { value: 'Hello there' } })
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(writesTo('/threads/thread-1/messages')).toHaveLength(1)

    pending.resolve({ ok: true })
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Message sent.', 'success'))
    expect(writesTo('/messages')).toHaveLength(1)
    await waitFor(() => expect(composer).toHaveValue(''))
  })

  test('a failed join is reported as a failure, never as "You joined"', async () => {
    mockWrite.mockImplementation(async () => {
      throw Object.assign(new Error('Unexpected error'), { status: 500 })
    })
    await renderPage(['assisted_selling.threads.participate'])

    fireEvent.click(await screen.findByRole('button', { name: 'Join' }))

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Failed to join this conversation.', 'error'))
    expect(mockFlash).not.toHaveBeenCalledWith('You joined this conversation.', 'success')
  })
})
