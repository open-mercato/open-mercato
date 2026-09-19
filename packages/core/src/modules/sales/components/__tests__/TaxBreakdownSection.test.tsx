/**
 * @jest-environment jsdom
 *
 * The section exists so a provider outage is visible instead of silently
 * becoming a mispriced invoice. These cases pin the three things a merchant
 * relies on: that a fallback says so, that the retry is offered, and that a
 * document with no provenance says that rather than claiming a zero.
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { TaxBreakdownSection, type TaxInfoView } from '../documents/TaxBreakdownSection'

// Only `useT` is stubbed: `PriceWithCurrency` also reads `useOptionalLocale`
// from this module, and replacing the whole module would break it.
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/i18n/context'),
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

const calculatedInfo: TaxInfoView = {
  providerKey: 'external-tax',
  status: 'calculated',
  calculatedAt: '2026-09-19T10:00:00.000Z',
  breakdown: [
    {
      jurisdictionCode: 'US-CA',
      jurisdictionName: 'California',
      jurisdictionType: 'state',
      taxName: 'CA State Tax',
      rate: 5,
      taxableAmount: 100,
      taxAmount: 5,
      exemptAmount: 0,
    },
    {
      jurisdictionCode: 'US-CA-SF',
      jurisdictionName: 'San Francisco',
      jurisdictionType: 'city',
      taxName: 'SF City Tax',
      rate: 2,
      taxableAmount: 100,
      taxAmount: 2,
      exemptAmount: 0,
    },
  ],
  transaction: { reference: null, state: 'estimate' },
  messages: [],
  failure: null,
}

describe('TaxBreakdownSection', () => {
  it('reports that nothing was recorded rather than implying a zero', () => {
    render(<TaxBreakdownSection currency="USD" />)
    expect(screen.getByText('No tax provenance recorded for this document.')).toBeInTheDocument()
  })

  it('shows the provider and a success badge for a calculated document', () => {
    render(
      <TaxBreakdownSection
        taxStatus="calculated"
        taxStrategyKey="external-tax"
        taxCalculatedAt="2026-09-19T10:00:00.000Z"
        taxInfo={calculatedInfo}
        currency="USD"
      />
    )
    expect(screen.getByText('Calculated')).toBeInTheDocument()
    expect(screen.getByText(/external-tax/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Recalculate tax/ })).not.toBeInTheDocument()
  })

  it('keeps the jurisdiction rows collapsed until asked', () => {
    render(
      <TaxBreakdownSection taxStatus="calculated" taxInfo={calculatedInfo} currency="USD" />
    )
    expect(screen.queryByText('California')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByText('California')).toBeInTheDocument()
    expect(screen.getByText('San Francisco')).toBeInTheDocument()
  })

  it('warns and offers a retry on a fallback', () => {
    const onRecalculate = jest.fn()
    render(
      <TaxBreakdownSection
        taxStatus="fallback"
        taxStrategyKey="avalara"
        taxInfo={{
          ...calculatedInfo,
          status: 'fallback',
          failure: {
            code: 'timeout',
            message: 'provider did not answer in time',
            at: '2026-09-19T10:00:00.000Z',
            providerKey: 'avalara',
          },
        }}
        currency="USD"
        onRecalculate={onRecalculate}
      />
    )
    expect(
      screen.getByText(
        'Tax is an estimate: the provider did not answer, so table rates were applied.'
      )
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate tax' }))
    expect(onRecalculate).toHaveBeenCalledTimes(1)
  })

  it('treats a decline as information rather than an incident', () => {
    render(
      <TaxBreakdownSection
        taxStatus="fallback"
        taxInfo={{
          ...calculatedInfo,
          status: 'fallback',
          failure: {
            code: 'unsupported',
            message: 'not my jurisdiction',
            at: '2026-09-19T10:00:00.000Z',
            providerKey: 'avalara',
          },
        }}
        currency="USD"
        onRecalculate={() => {}}
      />
    )
    expect(
      screen.getByText('The tax provider declined this document; table rates were applied.')
    ).toBeInTheDocument()
  })

  it('disables the retry while one is in flight', () => {
    render(
      <TaxBreakdownSection
        taxStatus="fallback"
        taxInfo={{
          ...calculatedInfo,
          status: 'fallback',
          failure: {
            code: 'provider_error',
            message: 'boom',
            at: '2026-09-19T10:00:00.000Z',
            providerKey: 'avalara',
          },
        }}
        currency="USD"
        onRecalculate={() => {}}
        recalculating
      />
    )
    expect(screen.getByRole('button', { name: 'Recalculate tax' })).toBeDisabled()
  })

  it('offers no retry when the caller supplies no handler (invoices inherit)', () => {
    render(
      <TaxBreakdownSection
        taxStatus="fallback"
        taxInfo={{
          ...calculatedInfo,
          status: 'fallback',
          failure: {
            code: 'provider_error',
            message: 'boom',
            at: '2026-09-19T10:00:00.000Z',
            providerKey: 'avalara',
          },
        }}
        currency="USD"
      />
    )
    expect(screen.queryByRole('button', { name: /Recalculate tax/ })).not.toBeInTheDocument()
  })

  it('links a transaction reference that carries an external url', () => {
    render(
      <TaxBreakdownSection
        taxStatus="calculated"
        taxTransactionRef="txn-42"
        taxInfo={{
          ...calculatedInfo,
          transaction: {
            reference: 'txn-42',
            state: 'committed',
            externalUrl: 'https://vendor.example/txn-42',
          },
        }}
        currency="USD"
      />
    )
    const link = screen.getByRole('link', { name: 'txn-42' })
    expect(link).toHaveAttribute('href', 'https://vendor.example/txn-42')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
})
