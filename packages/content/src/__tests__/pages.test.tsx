/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import PrivacyPage from '../modules/content/frontend/privacy/page'
import TermsPage from '../modules/content/frontend/terms/page'

jest.mock('next/link', () => {
  const React = require('react')
  return React.forwardRef(({ children, href, ...rest }: any, ref: React.ForwardedRef<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : href?.toString?.()} ref={ref} {...rest}>
      {children}
    </a>
  ))
})

jest.mock('next/image', () => (props: any) => <img alt={props.alt} {...props} />)

describe('PrivacyPage', () => {
  beforeEach(() => {
    render(<PrivacyPage />)
  })

  it('renders "Privacy Policy" as the page title', () => {
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('Privacy Policy')
  })

  it('displays the last-updated date in the intro', () => {
    expect(screen.getByText('Last Updated: January 1, 2026')).toBeTruthy()
  })

  it('renders breadcrumb with Home link and current page label', () => {
    const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const homeLink = within(breadcrumbNav).getByText('Home')
    expect(homeLink.closest('a')).toHaveAttribute('href', '/')
    const currentLabel = within(breadcrumbNav).getByText('Privacy Policy')
    expect(currentLabel.tagName).toBe('SPAN')
  })

  it('contains key privacy policy sections', () => {
    expect(screen.getByText('1. Information We Collect')).toBeTruthy()
    expect(screen.getByText('2. Purposes of Processing')).toBeTruthy()
    expect(screen.getByText('3. Legal Bases for Processing')).toBeTruthy()
    expect(screen.getByText('4. Data Recipients and Transfers')).toBeTruthy()
    expect(screen.getByText('5. Data Retention')).toBeTruthy()
    expect(screen.getByText('6. Data Security')).toBeTruthy()
    expect(screen.getByText('7. Your Rights Under GDPR')).toBeTruthy()
    expect(screen.getByText('8. Your Rights Under CCPA')).toBeTruthy()
    expect(screen.getByText('9. How to Exercise Your Rights and Contact Us')).toBeTruthy()
    expect(screen.getByText('10. Updates to Privacy Policy')).toBeTruthy()
  })

  it('includes a link to the Terms of Service', () => {
    const article = document.querySelector('article')
    const termsLinks = within(article!).getAllByRole('link').filter((link) => link.getAttribute('href') === '/terms')
    expect(termsLinks.length).toBeGreaterThan(0)
  })

  it('includes an external link to the platform site', () => {
    const article = document.querySelector('article')
    const externalLinks = within(article!).getAllByRole('link').filter((link) =>
      link.getAttribute('href')?.includes('openmercato.com'),
    )
    expect(externalLinks.length).toBeGreaterThan(0)
  })
})

describe('TermsPage', () => {
  beforeEach(() => {
    render(<TermsPage />)
  })

  it('renders "Terms of Service" as the page title', () => {
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('Terms of Service')
  })

  it('displays the effective date in the intro', () => {
    expect(screen.getByText('Effective as of January 1, 2026')).toBeTruthy()
  })

  it('renders breadcrumb with Home link and current page label', () => {
    const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const homeLink = within(breadcrumbNav).getByText('Home')
    expect(homeLink.closest('a')).toHaveAttribute('href', '/')
    const currentLabel = within(breadcrumbNav).getByText('Terms of Service')
    expect(currentLabel.tagName).toBe('SPAN')
  })

  it('contains key terms of service sections', () => {
    expect(screen.getByText('1. Definitions')).toBeTruthy()
    expect(screen.getByText('2. Scope of Services')).toBeTruthy()
    expect(screen.getByText('3. Formation of Agreement')).toBeTruthy()
  })

  it('includes a link to the Privacy Policy', () => {
    const article = document.querySelector('article')
    const privacyLinks = within(article!).getAllByRole('link').filter((link) => link.getAttribute('href') === '/privacy')
    expect(privacyLinks.length).toBeGreaterThan(0)
  })
})
