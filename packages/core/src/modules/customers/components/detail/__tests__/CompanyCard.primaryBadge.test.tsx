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
    const badge = container.querySelector('.bg-status-info-bg')
    expect(badge).not.toBeNull()
    const badgeClasses = badge?.className?.toString?.() ?? ''
    // The badge itself MUST NOT use bg-primary; tailwind variants like
    // `aria-pressed:bg-primary` may appear on unrelated icon buttons elsewhere.
    expect(badgeClasses.split(/\s+/)).not.toContain('bg-primary')
    expect(badgeClasses).toMatch(/bg-status-info-bg|status-info/)
    const text = (badge?.textContent ?? '').toLowerCase()
    expect(text).toContain('primary')
  })

  it('does not render the primary marker when isPrimary is false', () => {
    const { container } = renderWithProviders(
      <CompanyCard data={makeCompanyData({ isPrimary: false })} personName="Lena Ortiz" />,
    )
    expect(container.querySelector('.bg-status-info-bg')).toBeNull()
  })
})
