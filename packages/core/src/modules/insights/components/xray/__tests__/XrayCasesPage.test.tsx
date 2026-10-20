/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, within } from '@testing-library/react'

const mockApiFetch = jest.fn()
const mockSearch: { params: URLSearchParams } = { params: new URLSearchParams() }

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/insights/process-xray/customers.deal/cases',
  useSearchParams: () => mockSearch.params,
}))

import { XrayCasesPageClient } from '../XrayCasesPage.client'
import { ORG_ID, envelope, fakeResponse, recordRequest, renderXray, type RecordedRequest } from './xrayTestSupport'

const CASE_ID = '77777777-0000-4000-8000-000000000001'
const requests: RecordedRequest[] = []

const PROCESSES = {
  items: [{ processKey: 'customers.deal', labelKey: 'customers.insights.process.deal', moduleId: 'customers', resourceKind: 'customers.deal', organizationIds: [ORG_ID], window: envelope.window, n: 42, lowConfidence: false, computedThrough: envelope.computedThrough, incomplete: false, kAnonymity: 5, openCases: 3, openCasesAsOf: envelope.window.to }],
  n: 42,
  computedThrough: envelope.computedThrough,
  incomplete: false,
}

function casesPage(overrides: Record<string, unknown>) {
  return {
    processKey: 'customers.deal',
    organizationIds: [ORG_ID],
    window: envelope.window,
    n: 6,
    computedThrough: envelope.computedThrough,
    incomplete: false,
    suppressed: false,
    items: [{ caseId: CASE_ID, organizationId: ORG_ID }],
    nextCursor: null,
    activityLabels: {},
    ...overrides,
  }
}

function respondWith(cases: Record<string, unknown>) {
  mockApiFetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const request = recordRequest(input, init)
    requests.push(request)
    if (request.url.pathname === '/api/insights/xray/processes') return fakeResponse(200, PROCESSES)
    if (request.url.pathname === '/api/insights/xray/customers.deal/cases') return fakeResponse(200, cases)
    return fakeResponse(200, { items: [] })
  })
}

beforeEach(() => {
  requests.length = 0
  mockApiFetch.mockReset()
  mockSearch.params = new URLSearchParams('w=30d&activity=status:won')
})

describe('XrayCasesPageClient', () => {
  it('shows the drilled step by its server label and lists the cases of a visible cell', async () => {
    respondWith(casesPage({ activityLabels: { 'status:won': 'Status: Won' } }))
    renderXray(<XrayCasesPageClient processKey="customers.deal" />)
    expect(await screen.findByText(CASE_ID)).toBeInTheDocument()
    expect(within(screen.getByTestId('xray-cases-drilldown')).getByRole('button', { name: 'Remove the step filter' })).toHaveTextContent('Step: Status: Won')
    expect(screen.getByTestId('xray-result-n')).toHaveTextContent('6 cases')
    expect(screen.queryByTestId('xray-cases-suppressed')).toBeNull()
    const listing = requests.find((request) => request.url.pathname.endsWith('/cases'))
    expect(listing?.url.searchParams.get('activityKey')).toBe('status:won')
  })

  it('lists every recorded path of a collapsed variant at once and narrows to one on request', async () => {
    const first = 'a'.repeat(64)
    const second = 'b'.repeat(64)
    mockSearch.params = new URLSearchParams(`w=30d&variants=${first},${second}`)
    respondWith(casesPage({}))
    const view = renderXray(<XrayCasesPageClient processKey="customers.deal" />)
    expect(await screen.findByText(CASE_ID)).toBeInTheDocument()
    const all = requests.filter((request) => request.url.pathname.endsWith('/cases')).pop()
    expect(all?.url.searchParams.get('variantHashes')).toBe(`${first},${second}`)
    expect(all?.url.searchParams.has('variantHash')).toBe(false)
    expect(screen.getByRole('combobox', { name: 'Recorded path' })).toHaveTextContent('All 2 recorded paths')
    view.unmount()

    requests.length = 0
    mockSearch.params = new URLSearchParams(`w=30d&variants=${first},${second}&variant=${second}`)
    renderXray(<XrayCasesPageClient processKey="customers.deal" />)
    expect(await screen.findByText(CASE_ID)).toBeInTheDocument()
    const one = requests.filter((request) => request.url.pathname.endsWith('/cases')).pop()
    expect(one?.url.searchParams.get('variantHash')).toBe(second)
    expect(one?.url.searchParams.has('variantHashes')).toBe(false)
  })

  it('explains a drill-down hidden for privacy without any count or case id', async () => {
    respondWith(casesPage({ suppressed: true, n: 0, items: [] }))
    renderXray(<XrayCasesPageClient processKey="customers.deal" />)
    const notice = await screen.findByTestId('xray-cases-suppressed')
    expect(notice).toHaveTextContent('Hidden for privacy')
    expect(notice).toHaveTextContent('too few cases or people')
    expect(screen.queryByTestId('xray-result-n')).toBeNull()
    expect(screen.queryByText(/0 cases/)).toBeNull()
    expect(screen.getByText('No case is listed for a step or path hidden for privacy.')).toBeInTheDocument()
  })
})
