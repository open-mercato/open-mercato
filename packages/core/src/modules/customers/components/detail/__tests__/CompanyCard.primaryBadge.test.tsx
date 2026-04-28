/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CompanyCard, type EnrichedCompanyData } from '../CompanyCard'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

function makeCompanyData(overrides: Partial<EnrichedCompanyData> = {}): EnrichedCompanyData {
  return {
    linkId: 'link-1',
    companyId: 'company-1',
    displayName: 'Alpha Corp',
    isPrimary: true,
    subtitle: null,
    profile: null,
    billing: null,
    primaryAddress: null,
    tags: [],
    roles: [],
    activeDeal: null,
    lastContactAt: null,
    clv: null,
    status: null,
    lifecycleStage: null,
    temperature: null,
    renewalQuarter: null,
    ...overrides,
  } as EnrichedCompanyData
}

describe('CompanyCard primary badge', () => {
  it('renders the primary marker with semantic info tokens (no bg-primary class)', () => {
    const { container } = renderWithProviders(
      <CompanyCard data={makeCompanyData({ isPrimary: true })} personName="Lena Ortiz" />,
    )
    const html = container.innerHTML
    expect(html).not.toContain('bg-primary')
    expect(html).toMatch(/bg-status-info-bg|status-info/)
    const text = container.textContent ?? ''
    expect(text.toLowerCase()).toContain('primary')
  })

  it('does not render the primary marker when isPrimary is false', () => {
    const { container } = renderWithProviders(
      <CompanyCard data={makeCompanyData({ isPrimary: false })} personName="Lena Ortiz" />,
    )
    const html = container.innerHTML
    expect(html).not.toMatch(/bg-status-info-bg|status-info/)
  })
})
