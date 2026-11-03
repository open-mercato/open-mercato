import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deletePhoneCallsIfExist, seedPhoneCalls } from './helpers/phoneCallsFixtures'

type CallRow = {
  external_call_id?: string | null
  external_conversation_id?: string | null
  provider_key?: string | null
  direction?: string | null
  status?: string | null
}
type ListBody = { items?: CallRow[] }

/**
 * TC-PHONE-HUB-004 — the list applies the module's own `buildFilters` and `sortFieldMap`.
 *
 * Targets what this module wrote: the `$or` ILIKE spanning external_call_id,
 * external_conversation_id and provider_key, the `started_at` range, and the camelCase
 * sort field mapping. Paging and sorting plumbing belongs to `makeCrudRoute` and has its
 * own unit tests, so it is not re-asserted here.
 *
 * Every query is scoped by a run-unique marker so assertions hold whatever else is in the
 * database.
 */
test.describe('TC-PHONE-HUB-004: phone calls list filters', () => {
  // The three markers must not contain one another: `q` searches call id, conversation id
  // and provider key with a single $or, so an overlapping marker would make one query
  // match another fixture's row.
  const stamp = Date.now()
  const marker = `qa-phone-hub-004-call-${stamp}`
  const conversationMarker = `qa-phone-hub-004-conv-${stamp}`
  const providerMarker = `qa-phone-hub-004-prov-${stamp}`
  // The day-boundary rows carry their own marker: the range assertions below need exactly
  // two rows, and folding them into `marker` would change what every other query returns.
  const edgeMarker = `qa-phone-hub-004-edge-${stamp}`
  let seeded: string[] = []
  let token = ''

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request)
    const scope = getTokenScope(token)
    const base = { organizationId: scope.organizationId, tenantId: scope.tenantId }

    seeded = await seedPhoneCalls([
      {
        ...base,
        externalCallId: `${marker}-inbound-completed`,
        direction: 'inbound',
        status: 'completed',
        startedAt: new Date('2026-03-10T09:00:00Z'),
      },
      {
        ...base,
        externalCallId: `${marker}-outbound-missed`,
        direction: 'outbound',
        status: 'missed',
        startedAt: new Date('2026-03-20T09:00:00Z'),
      },
      {
        ...base,
        externalCallId: `${marker}-inbound-old`,
        direction: 'inbound',
        status: 'completed',
        startedAt: new Date('2025-01-05T09:00:00Z'),
      },
      // Reached only through the other two branches of the `$or`: its own call id
      // deliberately does not carry the marker.
      {
        ...base,
        externalCallId: `qa-phone-hub-004-side-${stamp}`,
        externalConversationId: conversationMarker,
        providerKey: providerMarker,
        direction: 'inbound',
        status: 'answered',
        startedAt: new Date('2026-03-11T09:00:00Z'),
      },
      // Both sit on a boundary day, at the hours a bare `yyyy-MM-dd` bound has to reach:
      // just after midnight on the first day, and late in the evening on the last one.
      {
        ...base,
        externalCallId: `${edgeMarker}-first-day`,
        direction: 'inbound',
        status: 'completed',
        startedAt: new Date('2026-03-01T00:30:00Z'),
      },
      {
        ...base,
        externalCallId: `${edgeMarker}-last-day`,
        direction: 'outbound',
        status: 'completed',
        startedAt: new Date('2026-03-15T23:00:00Z'),
      },
    ])
  })

  test.afterAll(async () => {
    await deletePhoneCallsIfExist(seeded)
  })

  async function listRows(request: APIRequestContext, query: string): Promise<CallRow[]> {
    const response = await apiRequest(request, 'GET', `/api/phone_calls/calls?${query}&pageSize=100`, { token })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<ListBody>(response)
    return body?.items ?? []
  }

  test('q matches the external call id via ILIKE', async ({ request }) => {
    const rows = await listRows(request, `q=${encodeURIComponent(`${marker}-outbound`)}`)
    expect(rows.map((row) => row.external_call_id)).toEqual([`${marker}-outbound-missed`])
  })

  test('q also matches the conversation id branch of the $or', async ({ request }) => {
    const rows = await listRows(request, `q=${encodeURIComponent(conversationMarker)}`)
    expect(rows.map((row) => row.external_conversation_id)).toEqual([conversationMarker])
  })

  test('q also matches the provider key branch of the $or', async ({ request }) => {
    const rows = await listRows(request, `q=${encodeURIComponent(providerMarker)}`)
    expect(rows.map((row) => row.provider_key)).toEqual([providerMarker])
  })

  test('providerKey filters on an exact match', async ({ request }) => {
    const rows = await listRows(request, `providerKey=${encodeURIComponent(providerMarker)}`)
    expect(rows.map((row) => row.external_conversation_id)).toEqual([conversationMarker])
  })

  test('direction narrows the list', async ({ request }) => {
    const rows = await listRows(request, `q=${encodeURIComponent(marker)}&direction=inbound`)
    expect(rows.every((row) => row.direction === 'inbound'), 'no outbound row may leak').toBe(true)
    expect(rows.map((row) => row.external_call_id).sort()).toEqual([
      `${marker}-inbound-completed`,
      `${marker}-inbound-old`,
    ])
  })

  test('status narrows the list', async ({ request }) => {
    const rows = await listRows(request, `q=${encodeURIComponent(marker)}&status=missed`)
    expect(rows.map((row) => row.external_call_id)).toEqual([`${marker}-outbound-missed`])
  })

  test('startedFrom and startedTo bound the range', async ({ request }) => {
    const rows = await listRows(
      request,
      `q=${encodeURIComponent(marker)}&startedFrom=2026-03-01&startedTo=2026-03-15`,
    )
    expect(rows.map((row) => row.external_call_id)).toEqual([`${marker}-inbound-completed`])
  })

  // The bound that used to be wrong: `startedTo=2026-03-15` parsed to midnight, so every call
  // later that day fell outside the range the user picked. The row at 23:00 is the whole point.
  test('a bare day bound covers the whole day at both ends of the range', async ({ request }) => {
    const rows = await listRows(
      request,
      `q=${encodeURIComponent(edgeMarker)}&startedFrom=2026-03-01&startedTo=2026-03-15&sortField=startedAt&sortDir=asc`,
    )
    expect(rows.map((row) => row.external_call_id)).toEqual([
      `${edgeMarker}-first-day`,
      `${edgeMarker}-last-day`,
    ])
  })

  test('a full timestamp bound keeps the instant it names instead of the day', async ({ request }) => {
    const rows = await listRows(
      request,
      `q=${encodeURIComponent(edgeMarker)}&startedTo=${encodeURIComponent('2026-03-15T12:00:00.000Z')}`,
    )
    expect(rows.map((row) => row.external_call_id)).toEqual([`${edgeMarker}-first-day`])
  })

  test('an unparsable date is rejected rather than dropped', async ({ request }) => {
    const response = await apiRequest(request, 'GET', '/api/phone_calls/calls?startedTo=not-a-date', { token })
    expect(response.status()).toBe(400)
  })

  test('id narrows the list to a single call', async ({ request }) => {
    const rows = await listRows(request, `id=${encodeURIComponent(seeded[0])}`)
    expect(rows.map((row) => row.external_call_id)).toEqual([`${marker}-inbound-completed`])
  })

  test('sortField maps camelCase startedAt onto the started_at column', async ({ request }) => {
    const rows = await listRows(request, `q=${encodeURIComponent(marker)}&sortField=startedAt&sortDir=asc`)
    expect(rows.map((row) => row.external_call_id)).toEqual([
      `${marker}-inbound-old`,
      `${marker}-inbound-completed`,
      `${marker}-outbound-missed`,
    ])
  })
})
