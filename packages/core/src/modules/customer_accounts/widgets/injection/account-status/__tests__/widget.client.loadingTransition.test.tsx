/**
 * @jest-environment jsdom
 *
 * #5499 acceptance criterion, asserted across the render transition rather than
 * on a settled state: while the widget resolves the CRM person the recipient-email
 * fallback needs, it must never show "No portal account linked" with a live
 * invite button. The sibling widget.client.test.tsx mocks useQuery and so cannot
 * observe loading transitions at all — this suite renders through a real
 * QueryClientProvider so the `enabled` chain and every intermediate commit are
 * exercised for real.
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AccountStatusWidget from '../widget.client'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback || _key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: jest.fn(() => ({
    runMutation: jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation()),
  })),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

const PERSON_ENTITY_ID = 'person-entity-1'
const ORPHAN_EMAIL = 'orphan@example.test'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function renderWidget() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountStatusWidget context={{ recordId: PERSON_ENTITY_ID }} />
    </QueryClientProvider>,
  )
}

describe('customer_accounts AccountStatusWidget loading transition (#5499)', () => {
  let emptyStateEverRendered: boolean
  let inviteButtonEverRendered: boolean
  let observer: MutationObserver

  beforeEach(() => {
    mockApiCall.mockReset()
    emptyStateEverRendered = false
    inviteButtonEverRendered = false
    observer = new MutationObserver(() => {
      const text = document.body.textContent ?? ''
      if (text.includes('No portal account linked')) emptyStateEverRendered = true
      if (text.includes('Invite to Portal')) inviteButtonEverRendered = true
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  })

  afterEach(() => {
    observer.disconnect()
  })

  // The window the Major review finding measured: the person fetch is the only
  // thing in flight, the invitation query is disabled (and a disabled query
  // reports isLoading === false), and the card used to fall through to the empty
  // state with a clickable Invite to Portal button for its whole duration.
  it('never renders the empty state or a live invite button while the person record is in flight', async () => {
    const person = createDeferred<unknown>()

    mockApiCall.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/customer_accounts/admin/users?')) {
        return { ok: true, status: 200, result: { items: [], total: 0 } } as never
      }
      if (typeof url === 'string' && url.includes('/api/customers/people/')) {
        return (await person.promise) as never
      }
      if (typeof url === 'string' && url.includes(`personEntityId=${PERSON_ENTITY_ID}`)) {
        return { ok: true, status: 200, result: { items: [], total: 0 } } as never
      }
      if (typeof url === 'string' && url.includes(`email=${encodeURIComponent(ORPHAN_EMAIL)}`)) {
        return {
          ok: true,
          status: 200,
          result: {
            items: [{
              id: 'invitation-orphan',
              email: ORPHAN_EMAIL,
              expiresAt: '2026-06-18T12:00:00.000Z',
            }],
            total: 1,
          },
        } as never
      }
      return { ok: false, status: 500, result: { error: 'unexpected call' } } as never
    })

    renderWidget()

    // Hold the card in the person-fetch window long enough for any intermediate
    // commit to land, then release the person record.
    await waitFor(() => {
      expect(
        mockApiCall.mock.calls.some(
          ([url]) => typeof url === 'string' && url.includes('/api/customers/people/'),
        ),
      ).toBe(true)
    })
    expect(screen.queryByText('No portal account linked')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /invite to portal/i })).not.toBeInTheDocument()

    person.resolve({
      ok: true,
      status: 200,
      result: { person: { primaryEmail: ORPHAN_EMAIL, displayName: 'Orphan Buyer' }, profile: null },
    })

    expect(await screen.findByText('Invitation pending')).toBeInTheDocument()
    expect(screen.getByText(ORPHAN_EMAIL)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resend invitation/i })).toBeInTheDocument()
    expect(emptyStateEverRendered).toBe(false)
    expect(inviteButtonEverRendered).toBe(false)
  })

  // The same guard must not hide the genuine empty state: a person with neither an
  // account nor an invitation still has to reach "No portal account linked" and an
  // enabled Invite to Portal button once both queries settle.
  it('still reaches the empty state once the person resolves with no invitation', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/customer_accounts/admin/users?')) {
        return { ok: true, status: 200, result: { items: [], total: 0 } } as never
      }
      if (typeof url === 'string' && url.includes('/api/customers/people/')) {
        return {
          ok: true,
          status: 200,
          result: { person: { primaryEmail: ORPHAN_EMAIL, displayName: 'Orphan Buyer' }, profile: null },
        } as never
      }
      if (typeof url === 'string' && url.includes('/api/customer_accounts/admin/users-invite')) {
        return { ok: true, status: 200, result: { items: [], total: 0 } } as never
      }
      return { ok: false, status: 500, result: { error: 'unexpected call' } } as never
    })

    renderWidget()

    expect(await screen.findByText('No portal account linked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /invite to portal/i })).toBeEnabled()
    expect(screen.queryByText('Invitation pending')).not.toBeInTheDocument()
  })
})
