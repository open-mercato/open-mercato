/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { PersonGroupsExplainTerms } from '../person-groups-explain-terms'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string, params?: Record<string, unknown>) =>
    (fallback ?? _key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/SectionHeader', () => ({
  SectionHeader: ({ title }: { title: string }) => <h3>{title}</h3>,
}))

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>

const GROUP = { id: '55555555-5555-4555-8555-555555555555', code: 'retail', name: 'Retail' }

function field(value: string | number | boolean | null, source: 'group' | 'tenant_default' | 'base_currency') {
  return {
    value,
    sourceGroupId: source === 'group' ? GROUP.id : null,
    source,
    path: source === 'group' ? [GROUP] : [],
  }
}

describe('PersonGroupsExplainTerms', () => {
  it('renders the four Release 5 terms and the base-currency source', async () => {
    mockedApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        groups: [GROUP],
        fields: {
          priceKindId: field(null, 'tenant_default'),
          paymentTermsDays: field(null, 'tenant_default'),
          allowPurchaseOnAccount: field(false, 'tenant_default'),
          approvalRequiredAbove: field(null, 'tenant_default'),
          minOrderValue: field(null, 'tenant_default'),
          termsCurrencyCode: field('EUR', 'base_currency'),
          approvalPolicy: field('both', 'group'),
          allowQuoteRequests: field(true, 'group'),
          requiresPoNumber: field(false, 'tenant_default'),
        },
      },
    } as never)

    render(<PersonGroupsExplainTerms customerId="44444444-4444-4444-8444-444444444444" />)

    const currencyRow = (await screen.findByText('Terms currency')).closest('li')
    expect(currencyRow?.textContent).toContain('EUR')
    expect(currencyRow?.textContent).toContain('Organization base currency')
    expect(currencyRow?.textContent).not.toContain('Tenant default')

    const policyRow = screen.getByText('Approval policy').closest('li')
    expect(policyRow?.textContent).toContain('Buyer and merchant')
    expect(policyRow?.textContent).toContain('via Retail (retail)')

    await waitFor(() => expect(screen.getByText('Allow quote requests').closest('li')?.textContent).toContain('Yes'))
    const poRow = screen.getByText('Requires PO number').closest('li')
    expect(poRow?.textContent).toContain('No')
    expect(poRow?.textContent).toContain('Tenant default')
  })
})
