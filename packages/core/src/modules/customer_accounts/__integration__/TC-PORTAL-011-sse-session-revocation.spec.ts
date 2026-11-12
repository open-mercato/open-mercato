import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
  type PortalSession,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-011 [P1]: a revoked portal session stops receiving Portal Event Bridge events.
 *
 * Two sessions of the same customer each hold an open portal SSE stream. Session A logs out
 * (its session row is revoked); session B stays signed in. The server must end A's stream within
 * its periodic revalidation interval (30s by default) and must never deliver a later
 * `portalBroadcast` event to A, while B — the control — keeps receiving.
 *
 * Surfaces:
 *   - GET  /api/customer_accounts/portal/events/stream
 *   - POST /api/customer_accounts/portal/logout
 *   - PUT  /api/customer_accounts/admin/users/[id] (emits `customer_accounts.user.updated`,
 *     `portalBroadcast: true`, `recipientUserId` = the customer)
 * Source: issue #7217.
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const STREAM_PATH = '/api/customer_accounts/portal/events/stream'
const PORTAL_EVENT = 'customer_accounts.user.updated'
const REVOCATION_DEADLINE_MS = 45_000

type PortalFrame = { id?: string; payload?: Record<string, unknown> }

type PortalStream = {
  events: PortalFrame[]
  isConnected: () => boolean
  isClosed: () => boolean
  close: () => void
}

function parseFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  return { frames: parts, rest }
}

async function openPortalStream(session: PortalSession): Promise<PortalStream> {
  const controller = new AbortController()
  const response = await fetch(`${BASE_URL}${STREAM_PATH}`, {
    headers: { ...portalCookieHeaders(session), Accept: 'text/event-stream' },
    signal: controller.signal,
  })
  expect(response.status, 'an active portal session can open the stream').toBe(200)
  expect(response.headers.get('content-type') ?? '').toContain('text/event-stream')

  const events: PortalFrame[] = []
  let connected = false
  let closed = false
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  const pump = async () => {
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      const parsed = parseFrames(buffer)
      buffer = parsed.rest
      for (const frame of parsed.frames) {
        if (frame.startsWith(': connected')) connected = true
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n')
        if (!data || data === ':heartbeat') continue
        try {
          events.push(JSON.parse(data) as PortalFrame)
        } catch {
          continue
        }
      }
    }
  }
  void pump()
    .catch(() => undefined)
    .finally(() => {
      closed = true
    })

  await expect.poll(() => connected, { timeout: 15_000, message: 'stream flushes its connected comment' }).toBe(true)

  return {
    events,
    isConnected: () => connected,
    isClosed: () => closed,
    close: () => controller.abort(),
  }
}

async function emitUserUpdated(
  request: APIRequestContext,
  adminToken: string,
  userId: string,
  displayName: string,
): Promise<void> {
  const res = await apiRequest(request, 'PUT', `/api/customer_accounts/admin/users/${userId}`, {
    token: adminToken,
    data: { displayName },
  })
  expect(res.status(), 'staff update of the customer user succeeds').toBe(200)
}

function countUpdatesFor(stream: PortalStream, userId: string): number {
  return stream.events.filter((event) => event.id === PORTAL_EVENT && event.payload?.id === userId).length
}

test.describe('TC-PORTAL-011: revoked portal session stops receiving SSE events', () => {
  test('logout ends the session stream and later broadcasts reach only the still-active session', async ({ request }) => {
    test.setTimeout(150_000)

    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let userId: string | null = null
    const streams: PortalStream[] = []

    try {
      const user = await createCustomerUserFixture(request, adminToken, {})
      userId = user.id

      const sessionA = await portalLogin(request, { email: user.email, password: user.password, tenantId })
      const sessionB = await portalLogin(request, { email: user.email, password: user.password, tenantId })

      const streamA = await openPortalStream(sessionA)
      const streamB = await openPortalStream(sessionB)
      streams.push(streamA, streamB)

      await emitUserUpdated(request, adminToken, user.id, `TC-PORTAL-011 baseline ${Date.now()}`)
      await expect
        .poll(() => [countUpdatesFor(streamA, user.id), countUpdatesFor(streamB, user.id)], {
          timeout: 20_000,
          message: 'both live sessions receive the baseline portal event',
        })
        .toEqual([1, 1])

      const logout = await request.post('/api/customer_accounts/portal/logout', {
        headers: portalCookieHeaders(sessionA),
      })
      expect(logout.status(), 'logout of session A succeeds').toBe(200)

      const profileA = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(sessionA),
      })
      expect(profileA.status(), 'session A no longer authenticates HTTP requests').toBe(401)

      await expect
        .poll(() => streamA.isClosed(), {
          timeout: REVOCATION_DEADLINE_MS,
          intervals: [500, 1_000, 2_000],
          message: 'the server ends the revoked session stream within the revalidation interval',
        })
        .toBe(true)
      expect(streamB.isClosed(), 'the still-active session stream stays open').toBe(false)

      await emitUserUpdated(request, adminToken, user.id, `TC-PORTAL-011 after-revoke ${Date.now()}`)
      await expect
        .poll(() => countUpdatesFor(streamB, user.id), {
          timeout: 20_000,
          message: 'the still-active session keeps receiving portal events',
        })
        .toBe(2)
      expect(countUpdatesFor(streamA, user.id), 'the revoked session never receives the post-revocation event').toBe(1)
    } finally {
      for (const stream of streams) stream.close()
      await deleteCustomerUserFixture(request, adminToken, userId)
    }
  })
})
