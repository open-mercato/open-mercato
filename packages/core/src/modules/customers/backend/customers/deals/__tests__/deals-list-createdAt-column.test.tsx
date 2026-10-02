/**
 * @jest-environment jsdom
 *
 * Regression coverage for the Deals list "Created" column (PR review on #6295):
 * `created_at` is stored and returned by the API, and `sortFieldMap.createdAt`
 * already maps it to `created_at` server-side, but nothing exercised the list
 * page's own wiring — the column header, the `created_at` -> `createdAt`
 * mapping in `mapDeal()`, and the click-to-sort affordance. If any of those
 * regress (column removed, mapping broken, sorting unwired), this test fails.
 */

import * as React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import en from '../../../../i18n/en.json'
import CustomersDealsPage from '../page'

let searchParams = new URLSearchParams('')

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/customers/deals',
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => searchParams,
}))

// `useVirtualizer` sizes its window off the scroll container's measured
// height, which is always 0 in jsdom — so the real virtualizer renders zero
// rows here regardless of data. Replace it with an identity implementation
// (every row is "virtual item" `index`) so the page's actual column/sort
// logic is what this test exercises, not an unrelated jsdom layout gap.
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => {
    const size = 48
    const items = Array.from({ length: opts.count }, (_, index) => ({
      index,
      key: index,
      start: index * size,
      end: (index + 1) * size,
      size,
    }))
    return {
      getVirtualItems: () => items,
      getTotalSize: () => opts.count * size,
    }
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const apiCallMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    result: { items: [] },
    response: {},
    cacheStatus: null,
  }))
  return {
    apiCall: apiCallMock,
    apiCallOrThrow: jest.fn(async (...args: unknown[]) => (apiCallMock as any)(...args)),
    readApiResultOrThrow: jest.fn(async (...args: unknown[]) => {
      const call = await (apiCallMock as any)(...args)
      return call.result
    }),
    withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
  }
})

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  useCustomFieldDefs: () => ({ data: [] }),
}))

// Not under test here — stubbed out so this suite stays focused on the
// list's own columns instead of the KPI strip's `/summary` contract.
jest.mock('../../../../components/DealsKpiStrip', () => ({
  DealsKpiStrip: () => null,
}))

jest.mock('../../../../components/detail/hooks/useCustomerDictionary', () => ({
  ensureCustomerDictionary: jest.fn(async () => ({ map: {} })),
  invalidateCustomerDictionary: jest.fn(async () => {}),
}))

jest.mock('../../../../components/detail/assignableStaff', () => ({
  fetchAssignableStaffMembers: jest.fn(async () => []),
  mapAssignableStaffToFilterOptions: jest.fn(() => []),
  ensureCurrentUserFilterOption: jest.fn((options: unknown[]) => options),
}))

const dict = en as Record<string, string>

const DEAL_ID = '11111111-1111-4111-8111-111111111111'
const CREATED_AT = '2026-01-05T10:00:00.000Z'
const UPDATED_AT = '2026-02-10T10:00:00.000Z'
const EXPECTED_CLOSE_AT = '2026-03-20T10:00:00.000Z'

function mockDealsRoutes() {
  ;(apiCall as jest.Mock).mockImplementation(async (input: unknown) => {
    const url = typeof input === 'string' ? input : String(input)
    if (url.startsWith('/api/customers/deals?') || url === '/api/customers/deals') {
      return {
        ok: true,
        status: 200,
        result: {
          items: [
            {
              id: DEAL_ID,
              title: 'Acme renewal',
              status: 'open',
              created_at: CREATED_AT,
              updated_at: UPDATED_AT,
              expected_close_at: EXPECTED_CLOSE_AT,
            },
          ],
          total: 1,
          totalPages: 1,
        },
        response: {},
        cacheStatus: null,
      }
    }
    // The DataTable perspectives lookup treats 404 as "no saved perspective" and
    // fills in an empty, well-formed shape itself — the safest generic stand-in.
    if (url.startsWith('/api/perspectives/')) {
      return { ok: false, status: 404, result: null, response: {}, cacheStatus: null }
    }
    return { ok: true, status: 200, result: { items: [] }, response: {}, cacheStatus: null }
  })
}

function findCreatedHeaderButton() {
  return screen.getByRole('button', { name: /^created$/i })
}

beforeEach(() => {
  jest.clearAllMocks()
  searchParams = new URLSearchParams('')
  mockDealsRoutes()
})

describe('Deals list — the Created column', () => {
  it('renders the localized header and the formatted creation date', async () => {
    renderWithProviders(<CustomersDealsPage />, { dict })

    await screen.findByText('Acme renewal')

    expect(findCreatedHeaderButton()).toBeInTheDocument()

    const expectedCreatedLabel = new Date(CREATED_AT).toLocaleDateString()
    const cell = screen.getByText(expectedCreatedLabel)
    expect(cell.closest('td')).toBeTruthy()
  })

  it('is wired into sorting: clicking the header re-fetches the list sorted by createdAt', async () => {
    renderWithProviders(<CustomersDealsPage />, { dict })

    await screen.findByText('Acme renewal')
    const callsBefore = (apiCall as jest.Mock).mock.calls.length

    fireEvent.click(findCreatedHeaderButton())

    await waitFor(() => {
      expect((apiCall as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore)
    })

    const sortedCall = (apiCall as jest.Mock).mock.calls
      .map(([url]) => String(url))
      .reverse()
      .find((url) => url.startsWith('/api/customers/deals?'))
    expect(sortedCall).toBeTruthy()

    const params = new URLSearchParams(sortedCall!.split('?')[1])
    expect(params.get('sort')).toBe('createdAt')
    expect(params.get('order')).toBe('asc')
  })
})
