/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const MEMBER_ORG_A = '11111111-1111-1111-1111-111111111111'
const MEMBER_ORG_B = '22222222-2222-2222-2222-222222222222'
const PROJECT_ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// The endpoint is self-scoped and carries no member parameter: the server
// re-resolves tenant + organization from the request context on every call, so
// the *same* URL returns different data after an organization switch. That is
// precisely why a scope-blind client cache key would be unsafe.
let currentOrganization: 'A' | 'B' = 'A'
const requestedUrls: string[] = []

const mockApiCall = jest.fn(async (url: string) => {
  requestedUrls.push(url)
  return {
    ok: true,
    status: 200,
    result:
      currentOrganization === 'A'
        ? { lastProjectId: PROJECT_ORG_A, updatedAt: '2026-08-09T10:00:00.000Z' }
        : { lastProjectId: PROJECT_ORG_B, updatedAt: '2026-08-09T11:00:00.000Z' },
  }
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: [string]) => mockApiCall(...args),
}))

import { timesheetPreferenceQueryKey, useTimesheetPreference } from '../useTimesheetPreference'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

/**
 * TC-STAFF-041 (client-side): an organization switch must not serve org A's
 * preference in org B.
 *
 * `StaffTeamMember` is itself organization-scoped, so a user acting in two
 * organizations has two member rows and therefore two distinct ids. Keying the
 * query by `staffMemberId` makes the key inherently organization-discriminating
 * — a switch changes the id, hence the key, hence the cache entry.
 *
 * This is asserted at the hook level rather than by driving a browser through
 * the organization switcher: the risk the spec records is a *cached React Query
 * entry* being served across scopes, which is exactly what these assertions
 * pin. The server-side half — the route re-resolving scope from the request
 * context and filtering the staff member by `organizationId` — is covered by
 * `api/timesheets/my-preferences/__tests__/route.test.ts`.
 */
describe('useTimesheetPreference organization scoping', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
    requestedUrls.length = 0
    currentOrganization = 'A'
  })

  it('derives a distinct cache key per staff member', () => {
    expect(timesheetPreferenceQueryKey(MEMBER_ORG_A)).not.toEqual(timesheetPreferenceQueryKey(MEMBER_ORG_B))
    expect(timesheetPreferenceQueryKey(MEMBER_ORG_A)).toEqual([
      'staff',
      'timesheets',
      'preference',
      MEMBER_ORG_A,
    ])
  })

  it('does not serve one organization preference under another organization member id', async () => {
    const { wrapper } = createWrapper()

    const orgA = renderHook(() => useTimesheetPreference(MEMBER_ORG_A), { wrapper })
    await waitFor(() => expect(orgA.result.current.isLoading).toBe(false))
    expect(orgA.result.current.lastProjectId).toBe(PROJECT_ORG_A)

    // The switch: a different organization means a different staff member row.
    currentOrganization = 'B'
    const orgB = renderHook(() => useTimesheetPreference(MEMBER_ORG_B), { wrapper })

    await waitFor(() => expect(orgB.result.current.isLoading).toBe(false))
    // The regression gate: a scope-blind key would have replayed org A's cached
    // value here without ever hitting the network.
    expect(orgB.result.current.lastProjectId).toBe(PROJECT_ORG_B)
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })

  it('reuses the cache entry for the same member instead of refetching', async () => {
    const { wrapper } = createWrapper()

    const first = renderHook(() => useTimesheetPreference(MEMBER_ORG_A), { wrapper })
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))

    const second = renderHook(() => useTimesheetPreference(MEMBER_ORG_A), { wrapper })
    await waitFor(() => expect(second.result.current.isLoading).toBe(false))

    expect(mockApiCall).toHaveBeenCalledTimes(1)
    expect(second.result.current.lastProjectId).toBe(PROJECT_ORG_A)
  })

  it('never fetches before a staff member id is known', async () => {
    const { wrapper } = createWrapper()

    const { result } = renderHook(() => useTimesheetPreference(null), { wrapper })

    // No unkeyed or placeholder-keyed fetch: there would be no scope to key it by.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockApiCall).not.toHaveBeenCalled()
    // A disabled query never resolves, so "no member yet" must read as still
    // loading rather than as a settled empty preference a seed effect could act on.
    expect(result.current.isLoading).toBe(true)
    expect(result.current.lastProjectId).toBeNull()
  })

  it('does not write a preference without a staff member id', async () => {
    const { wrapper } = createWrapper()

    const { result } = renderHook(() => useTimesheetPreference(null), { wrapper })
    await result.current.save(PROJECT_ORG_A)

    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('sends no member parameter, leaving scope resolution to the server', async () => {
    const { wrapper } = createWrapper()

    const { result } = renderHook(() => useTimesheetPreference(MEMBER_ORG_A), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(requestedUrls).toEqual(['/api/staff/timesheets/my-preferences'])
    expect(requestedUrls[0]).not.toContain(MEMBER_ORG_A)
  })
})
