/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'

const mockApiFetch = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/insights/process-xray/customers.deal',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/charts', () => ({
  BarChart: () => null,
  KpiCard: () => null,
}))

import { XrayBreakdownTab } from '../tabs/XrayBreakdownTab'
import { EMPTY_XRAY_FILTERS } from '../../../lib/client/xray/api'
import { ORG_ID, causes, envelope, fakeResponse, recordRequest, renderXray } from './xrayTestSupport'

function breakdown(groupBy: string) {
  return {
    ...envelope,
    groupBy,
    perPerson: groupBy === 'user',
    overlapping: false,
    includeSyncRun: false,
    items: [{
      organizationId: ORG_ID,
      group: ORG_ID,
      raw: 30,
      collapsed: 26,
      cases: 42,
      actors: 5,
      causes: causes(20, 6),
      stepWait: { n: 12, medianMs: 3_600_000, p90Ms: null, lowConfidence: true },
    }],
  }
}

function routeRequests(handler: (url: URL) => { status: number; body: unknown }) {
  mockApiFetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const request = recordRequest(input, init)
    const { status, body } = handler(request.url)
    return fakeResponse(status, body)
  })
}

function renderTab(canViewIndividuals: boolean) {
  return renderXray(
    <XrayBreakdownTab
      processKey="customers.deal"
      window={{ kind: 'preset', key: '30d' }}
      filters={EMPTY_XRAY_FILTERS}
      onClearActorFilters={jest.fn()}
      canViewIndividuals={canViewIndividuals}
    />,
  )
}

describe('XrayBreakdownTab', () => {
  beforeEach(() => mockApiFetch.mockReset())

  it('groups by organization by default and names the organization', async () => {
    routeRequests((url) => {
      if (url.pathname === '/api/directory/organizations') return { status: 200, body: { items: [{ id: ORG_ID, name: 'Main office' }] } }
      return { status: 200, body: breakdown(url.searchParams.get('groupBy') ?? 'org') }
    })
    renderTab(true)
    expect(await screen.findByText('Main office')).toBeInTheDocument()
    const breakdownCall = mockApiFetch.mock.calls.map(([input, init]) => recordRequest(input, init)).find((request) => request.url.pathname.endsWith('/breakdown'))
    expect(breakdownCall?.url.searchParams.get('groupBy')).toBe('org')
    expect(screen.getByText('1 h')).toBeInTheDocument()
    const nameLookup = mockApiFetch.mock.calls.map(([input, init]) => recordRequest(input, init)).find((request) => request.url.pathname === '/api/directory/organizations')
    expect(nameLookup?.headers['x-om-forbidden-redirect']).toBe('0')
  })

  it('offers the per-person view only with the permission and explains why otherwise', async () => {
    routeRequests(() => ({ status: 200, body: breakdown('org') }))
    renderTab(false)
    expect(await screen.findByTestId('xray-breakdown-user-unavailable')).toHaveTextContent('needs the "View individuals" permission')
    expect(screen.getByRole('radio', { name: 'Person' })).toBeDisabled()
  })

  it('shows the reason when a per-person read is refused (403 individuals_denied)', async () => {
    routeRequests((url) => {
      if (url.searchParams.get('groupBy') === 'user') {
        return { status: 403, body: { error: 'translated', code: 'individuals_denied', hint: null } }
      }
      return { status: 200, body: breakdown('org') }
    })
    renderTab(true)
    await screen.findByTestId('xray-result-meta')
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Person' }))
    })
    const notice = await screen.findByTestId('xray-individuals-denied')
    expect(notice).toHaveTextContent('Per-person analytics are not available to you here.')
    expect(notice).toHaveTextContent('organization and its Process X-Ray setting')
    expect(screen.queryByTestId('xray-breakdown-per-person')).toBeNull()
  })

  it('never shows the previous grouping\'s rows (or pseudonyms) while another grouping loads', async () => {
    let releaseOrg: (() => void) | null = null
    mockApiFetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const request = recordRequest(input, init)
      const groupBy = request.url.searchParams.get('groupBy') ?? 'org'
      if (request.url.pathname === '/api/directory/organizations') return fakeResponse(200, { items: [] })
      if (groupBy === 'org' && releaseOrg === null && mockApiFetch.mock.calls.length > 2) {
        await new Promise<void>((resolve) => { releaseOrg = resolve })
      }
      const body = breakdown(groupBy)
      if (groupBy === 'user') body.items[0].group = 'pseudonym-0123456789abcdef'
      return fakeResponse(200, body)
    })
    renderTab(true)
    await screen.findByTestId('xray-result-meta')
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Person' }))
    })
    expect(await screen.findByText('Person 1')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('pseudonym-0123456789abcdef')
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Organization' }))
    })
    expect(screen.queryByText('Person 1')).toBeNull()
    expect(screen.getByText('Loading Process X-Ray…')).toBeInTheDocument()
    await act(async () => {
      releaseOrg?.()
    })
    expect(await screen.findByTestId('xray-result-meta')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('pseudonym-0123456789abcdef')
  })

  it('labels a per-person result with the access-log notice', async () => {
    routeRequests((url) => ({ status: 200, body: breakdown(url.searchParams.get('groupBy') ?? 'org') }))
    renderTab(true)
    await screen.findByTestId('xray-result-meta')
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Person' }))
    })
    expect(await screen.findByTestId('xray-breakdown-per-person')).toHaveTextContent('recorded in the access log')
    expect(screen.getByText('Person 1')).toBeInTheDocument()
  })
})
