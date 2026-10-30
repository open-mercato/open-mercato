/**
 * @jest-environment jsdom
 *
 * Guards issue #5632: the activity timeline resolves author ids through
 * `GET /api/auth/users?ids=`, which slices silently at `MAX_USER_LOOKUP_IDS`. The lookup must
 * therefore chunk at that cap, and it must remember only the ids the server actually answered for
 * — otherwise ids the server dropped, and ids whose request failed outright, render blank for the
 * life of the component. Sibling coverage:
 * `packages/core/src/modules/devices/__tests__/use-device-user-labels.test.tsx`.
 */
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { MAX_USER_LOOKUP_IDS } from '@open-mercato/core/modules/auth/lib/userIdFilter'
import { ActivitiesSection } from '../ActivitiesSection'

const readApiResultOrThrowMock = jest.fn()
const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 'scope-v1',
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  renderDictionaryColor: jest.fn(),
  renderDictionaryIcon: jest.fn(),
}))

jest.mock('../hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: () => ({ data: { map: {} } }),
  ensureCustomerDictionary: jest.fn(async () => ({ entries: [], map: {} })),
  invalidateCustomerDictionary: jest.fn(async () => undefined),
}))

jest.mock('../hooks/useCustomFieldDisplay', () => ({
  useCustomFieldDisplay: () => ({
    definitions: [],
    dictionaryMapsByKey: {},
    isLoading: false,
    error: null,
  }),
}))

jest.mock('../CustomFieldValuesList', () => ({
  CustomFieldValuesList: () => null,
}))

jest.mock('../ActivityTimelineFilters', () => ({
  ActivityTimelineFilters: () => null,
}))

const activityTimelineMock = jest.fn(() => null)
jest.mock('../ActivityTimeline', () => ({
  ActivityTimeline: (props: unknown) => {
    activityTimelineMock(props)
    return null
  },
}))

// Derived from the cap rather than hard-coded, so raising `MAX_USER_LOOKUP_IDS` keeps this suite
// asserting "one full batch plus a partial one" instead of silently collapsing to a single request.
const AUTHOR_COUNT = MAX_USER_LOOKUP_IDS + 50

/** Real UUIDs — the route validates `?ids=` entries as UUIDs, so placeholder ids would not be representative. */
function authorId(index: number): string {
  const suffix = String(index).padStart(12, '0')
  return `00000000-0000-4000-8000-${suffix}`
}

const AUTHOR_IDS = Array.from({ length: AUTHOR_COUNT }, (_, index) => authorId(index))

function interactionsFor(ids: readonly string[]) {
  return {
    items: ids.map((id, index) => ({
      id: `interaction-${index}`,
      interactionType: 'note',
      status: 'done',
      occurredAt: '2026-03-29T09:00:00.000Z',
      scheduledAt: null,
      createdAt: '2026-03-29T09:00:00.000Z',
      updatedAt: '2026-03-29T09:00:00.000Z',
      authorUserId: id,
      authorName: null,
    })),
  }
}

function renderSection() {
  return renderWithProviders(
    <ActivitiesSection
      entityId="company-5632"
      useCanonicalInteractions
      addActionLabel="Log activity"
      emptyState={{ title: 'No activities logged yet', actionLabel: 'Log activity' }}
    />,
  )
}

function idsOf(url: string): string[] {
  return (new URLSearchParams(String(url).split('?')[1]).get('ids') ?? '').split(',').filter(Boolean)
}

/** The `?ids=` values of every `/api/auth/users` request issued so far, in call order. */
function userLookupBatches(): string[][] {
  return apiCallMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/api/auth/users?'))
    .map(idsOf)
}

function okResponse(items: Array<Record<string, unknown>>) {
  return { ok: true, status: 200, result: { items }, response: {} as Response, cacheStatus: null }
}

function failedResponse() {
  return { ok: false, status: 403, result: null, response: {} as Response, cacheStatus: null }
}

function authorNamesFromTimeline(): Record<string, string | null> {
  const calls = activityTimelineMock.mock.calls
  const lastProps = calls[calls.length - 1]?.[0] as { activities?: Array<Record<string, unknown>> } | undefined
  const entries: Record<string, string | null> = {}
  for (const activity of lastProps?.activities ?? []) {
    entries[String(activity.authorUserId)] = (activity.authorName as string | null) ?? null
  }
  return entries
}

beforeEach(() => {
  readApiResultOrThrowMock.mockReset()
  apiCallMock.mockReset()
  activityTimelineMock.mockClear()
  readApiResultOrThrowMock.mockResolvedValue(interactionsFor(AUTHOR_IDS))
})

describe('ActivitiesSection author lookup', () => {
  it('chunks the lookup at the route cap instead of dropping the overflow ids', async () => {
    apiCallMock.mockResolvedValue(okResponse([]))

    renderSection()

    await waitFor(() => expect(userLookupBatches().length).toBe(2))
    const [first, second] = userLookupBatches()
    // 150 unresolved authors, a server that slices silently at 100: one request would lose 50 ids.
    expect(first).toHaveLength(MAX_USER_LOOKUP_IDS)
    expect(second).toHaveLength(AUTHOR_COUNT - MAX_USER_LOOKUP_IDS)
    // The timeline sort decides the id order, so assert coverage rather than sequence: every
    // author is asked for exactly once across the batches.
    expect([...first, ...second].sort()).toEqual([...AUTHOR_IDS].sort())
  })

  it('asks for as many rows as the batch holds, so pagination cannot truncate the answer', async () => {
    apiCallMock.mockResolvedValue(okResponse([]))

    renderSection()

    await waitFor(() => expect(userLookupBatches().length).toBe(2))
    // The route's pageSize defaults to 50 — a 100-id batch would come back half-answered. Assert
    // the relationship (page size equals this batch's own id count) rather than a literal, so the
    // check still means something if the cap moves.
    for (const [url] of apiCallMock.mock.calls) {
      const params = new URLSearchParams(String(url).split('?')[1])
      expect(params.get('page')).toBe('1')
      expect(params.get('pageSize')).toBe(String(idsOf(String(url)).length))
    }
  })

  it('does not let a 403 on the lookup redirect the whole detail page', async () => {
    apiCallMock.mockResolvedValue(okResponse([]))

    renderSection()

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const [, init] = apiCallMock.mock.calls[0]
    expect((init as RequestInit & { headers: Record<string, string> }).headers['x-om-forbidden-redirect']).toBe('0')
  })

  it('retries a failed batch and stops asking for ids the server answered for', async () => {
    // Batch 1 succeeds but matches rows for only half of the ids it was given; batch 2 fails
    // outright. Both halves are derived from the ids actually requested, because the timeline sort
    // — not this file — decides which author lands in which batch.
    const answeredWithoutRow: string[] = []
    let failedBatch: string[] = []
    let callIndex = 0
    apiCallMock.mockImplementation(async (url: string) => {
      const ids = idsOf(url)
      callIndex += 1
      if (callIndex === 1) {
        answeredWithoutRow.push(...ids.slice(50))
        return okResponse(ids.slice(0, 50).map((id, index) => ({ id, name: `Author ${index}` })))
      }
      if (callIndex === 2) {
        failedBatch = ids
        return failedResponse()
      }
      return okResponse(ids.map((id, index) => ({ id, name: `Late ${index}` })))
    })

    renderSection()

    // The names resolved by batch 1 re-render the timeline, which re-runs the lookup effect.
    await waitFor(() => expect(userLookupBatches().length).toBe(3))

    const retried = userLookupBatches()[2]
    // The failed batch is retried in full...
    expect([...retried].sort()).toEqual([...failedBatch].sort())
    // ...while the ids batch 1 answered for but matched no row are never asked for again.
    expect(answeredWithoutRow).toHaveLength(MAX_USER_LOOKUP_IDS - 50)
    for (const id of answeredWithoutRow) {
      expect(retried).not.toContain(id)
    }

    await waitFor(() => expect(authorNamesFromTimeline()[failedBatch[0]]).toBe('Late 0'))
    expect(userLookupBatches()).toHaveLength(3)
  })

  it('labels an author with the display name the route returns', async () => {
    readApiResultOrThrowMock.mockResolvedValue(interactionsFor([AUTHOR_IDS[0]]))
    apiCallMock.mockResolvedValue(okResponse([
      { id: AUTHOR_IDS[0], name: 'Ada Lovelace', email: 'ada@example.com' },
    ]))

    renderSection()

    // `name` is what `/api/auth/users` emits; the email is only the fallback.
    await waitFor(() => expect(authorNamesFromTimeline()[AUTHOR_IDS[0]]).toBe('Ada Lovelace'))
  })
})
