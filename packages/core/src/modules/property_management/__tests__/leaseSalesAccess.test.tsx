/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LeaseHistoryCard } from '../components/leases/LeaseHistoryCard'
import { LeaseSummaryCard } from '../components/leases/LeaseSummaryCard'
import { salesDocumentLink, type LeaseDetail, type LeaseSummary, type LeaseVersionRow } from '../components/leases/leaseModel'

const mockGrantedFeatures: { current: string[] } = { current: ['customers.*'] }

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures.current } }),
}))

const VERSION_ID = '55555555-5555-4555-8555-555555555555'
const PROPOSAL_ID = '66666666-6666-4666-8666-666666666666'

function lease(extra: Partial<LeaseSummary> = {}): LeaseSummary {
  return {
    id: 'lease-1', reference: 'L-0001', status: 'active', buildingId: 'b', buildingName: 'HQ', unitId: 'u', unitName: 'U1', floorName: null,
    customerCompanyId: 'c', companyName: 'Acme', primaryContactPersonId: null, contactName: null, startsOn: '2026-01-01', termMonths: 12,
    endsOn: '2026-12-31', daysLeft: 200, productName: 'Office', monthlyRate: '100', currencyCode: 'EUR', salesOrderId: 'order-1',
    openProposal: null, pendingChange: null, billingPending: false, billingAttention: false,
    unitUnavailable: false, unitUnavailableFrom: null, unitUnavailableUntil: null, updatedAt: '2026-11-01T00:00:00Z',
    ...extra,
  }
}

function version(extra: Partial<LeaseVersionRow> = {}): LeaseVersionRow {
  return {
    id: VERSION_ID, versionNo: 1, event: 'activated', state: 'in_force', productName: 'Office', monthlyRate: '100', currencyCode: 'EUR',
    startsOn: '2026-01-01', endsOn: '2026-12-31', months: 12, salesOrderId: 'order-1',
    recurrence: { status: 'active', nextInvoiceOn: '2026-12-01', cancelEffectiveOn: null, invoicesAvailable: true }, createdAt: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

function detail(extra: Partial<LeaseDetail>): LeaseDetail {
  return {
    lease: lease(),
    leaseEnding: false,
    leaseEndingThresholdDays: 60,
    pendingChange: null,
    lastBillingRefusal: null,
    versions: [version()],
    proposals: [{
      id: PROPOSAL_ID, kind: 'new', status: 'approved', startsOn: '2026-01-01', endsOn: '2026-12-31', months: 12, monthlyRate: '100',
      currencyCode: 'EUR', message: null, respondBy: '2026-01-15', salesQuoteId: 'quote-1', createdAt: '2025-12-20T00:00:00Z',
    }],
    operations: [],
    billing: { canCredit: false, defaultSettlement: 'keep', cancelAvailable: true },
    crmAccess: { people: true, companies: true },
    ...extra,
  }
}

describe('salesDocumentLink', () => {
  it('links to the document by number when it is visible', () => {
    expect(salesDocumentLink('orders', 'order-1', 'SO-1', true)).toEqual({ state: 'link', href: '/backend/sales/orders/order-1', label: 'SO-1' })
  })

  it('hides a document the caller may not view, and one whose number was omitted', () => {
    expect(salesDocumentLink('orders', 'order-1', 'SO-1', false)).toEqual({ state: 'hidden' })
    expect(salesDocumentLink('quotes', 'quote-1', undefined, true)).toEqual({ state: 'hidden' })
  })

  it('reports no document when there is no id', () => {
    expect(salesDocumentLink('orders', null, undefined, false)).toEqual({ state: 'none' })
  })
})

describe('lease cards without sales access', () => {
  beforeEach(() => {
    mockGrantedFeatures.current = ['customers.*']
  })

  it('shows the tenant as plain text when the viewer cannot open CRM companies', () => {
    mockGrantedFeatures.current = ['customers.people.view']
    renderWithProviders(<LeaseSummaryCard detail={detail({ salesAccess: { orders: false, quotes: false, invoices: false } })} />)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText('Acme')).toBeTruthy()
  })

  it('shows notes instead of links or invoices when the sales fields are omitted', () => {
    const hidden = detail({ salesAccess: { orders: false, quotes: false, invoices: false } })
    renderWithProviders(<><LeaseSummaryCard detail={hidden} /><LeaseHistoryCard detail={hidden} canManage={false} onWithdraw={jest.fn()} /></>)

    expect(screen.queryAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/backend/customers/companies/c'])
    expect(screen.getByTestId('pm-lease-sales-order-hidden')).toBeTruthy()
    expect(screen.getByTestId(`pm-lease-version-order-${VERSION_ID}-hidden`)).toBeTruthy()
    expect(screen.getByTestId(`pm-lease-proposal-quote-${PROPOSAL_ID}-hidden`)).toBeTruthy()
    expect(screen.getByTestId(`pm-lease-invoices-hidden-${VERSION_ID}`)).toBeTruthy()
  })

  it('treats a response without salesAccess as hidden', () => {
    const legacy = detail({})
    renderWithProviders(<LeaseHistoryCard detail={legacy} canManage={false} onWithdraw={jest.fn()} />)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByTestId(`pm-lease-invoices-hidden-${VERSION_ID}`)).toBeTruthy()
  })

  it('links documents and lists invoices when the caller has sales access', () => {
    const visible = detail({
      lease: lease({ salesOrderNumber: 'SO-1' }),
      versions: [version({
        salesOrderNumber: 'SO-1',
        invoices: [{ periodIndex: 0, periodStart: '2026-01-01', periodEnd: '2026-01-31', invoiceId: 'inv-1', invoiceNumber: 'INV-1', creditMemoId: null, creditMemoNumber: null }],
      })],
      salesAccess: { orders: true, quotes: true, invoices: true },
    })
    visible.proposals[0].salesQuoteNumber = 'SQ-1'
    renderWithProviders(<><LeaseSummaryCard detail={visible} /><LeaseHistoryCard detail={visible} canManage={false} onWithdraw={jest.fn()} /></>)

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(expect.arrayContaining(['/backend/sales/orders/order-1', '/backend/sales/quotes/quote-1']))
    expect(screen.getByText('INV-1')).toBeTruthy()
  })
})
