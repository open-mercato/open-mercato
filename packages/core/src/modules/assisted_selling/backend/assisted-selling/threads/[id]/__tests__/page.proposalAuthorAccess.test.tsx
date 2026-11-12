/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import AssistedSellingThreadPage from '../page'

/**
 * #8268 Medium/INHERITED finding: a thread viewer with only `assisted_selling.threads.view` +
 * `cart.proposals.view` (the route guard) was offered "New proposal"/"Withdraw"/"Re-propose",
 * whose handlers 403 without `assisted_selling.proposals.author` (+ `cart.proposals.author` for
 * create/re-author). Proves the client-side gate added in `useProposalAuthorAccess` hides those
 * controls for an unauthorized viewer and shows them for an authorized author.
 */

let grantedFeatures: string[] = []

const threadDetailFixture = {
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
    { id: 'message-1', participantId: 'participant-1', body: 'Hello', bodyFormat: 'text', proposalId: 'proposal-1', sentAt: null },
  ],
  proposals: [
    {
      id: 'proposal-1',
      status: 'published',
      authoredByActorType: 'rep',
      authoredByActorId: 'rep-1',
      publishedAt: null,
      expiresAt: null,
      resolvedAt: null,
      supersededByProposalId: null,
      currencyCode: 'USD',
      lines: [],
    },
  ],
}

const apiCallMock = jest.fn(async (url: string) => {
  if (url === '/api/auth/feature-check') {
    return { ok: grantedFeatures.length === 2, result: { ok: grantedFeatures.length === 2, granted: grantedFeatures, userId: 'u1' } }
  }
  if (url.startsWith('/api/assisted_selling/threads/')) {
    return { ok: true, result: threadDetailFixture }
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
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/status-badge', () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: [string, ...unknown[]]) => apiCallMock(...args),
  withScopedApiRequestHeaders: <T,>(_headers: Record<string, string>, run: () => Promise<T>) => run(),
  readApiResultOrThrow: (...args: [string, ...unknown[]]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: () => false,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEventCoalesced', () => ({
  useAppEventCoalesced: () => undefined,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../ProposalBuilderDialog', () => ({
  ProposalBuilderDialog: () => null,
}))

describe('AssistedSellingThreadPage proposal-author gating (#8268)', () => {
  beforeEach(() => {
    apiCallMock.mockClear()
  })

  test('a viewer without assisted_selling.proposals.author / cart.proposals.author sees no author controls', async () => {
    grantedFeatures = []

    renderWithProviders(<AssistedSellingThreadPage params={{ id: 'thread-1' }} />)

    await waitFor(() => expect(screen.getByText('Selling conversation')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'New proposal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument()
  })

  test('an authorized author sees the author controls', async () => {
    grantedFeatures = ['assisted_selling.proposals.author', 'cart.proposals.author']

    renderWithProviders(<AssistedSellingThreadPage params={{ id: 'thread-1' }} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'New proposal' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
  })
})
