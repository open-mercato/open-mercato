/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import { ContentLayout } from '../modules/content/frontend/components/ContentLayout'

jest.mock('next/link', () => {
  const React = require('react')
  return React.forwardRef(({ children, href, ...rest }: any, ref: React.ForwardedRef<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : href?.toString?.()} ref={ref} {...rest}>
      {children}
    </a>
  ))
})

jest.mock('next/image', () => (props: any) => <img alt={props.alt} {...props} />)

describe('ContentLayout', () => {
  describe('title rendering', () => {
    it('renders the title as an h1 heading', () => {
      render(
        <ContentLayout title="Test Title">
          <p>Body content</p>
        </ContentLayout>,
      )
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toBeTruthy()
      expect(heading.textContent).toBe('Test Title')
    })

    it('renders different titles correctly', () => {
      const { rerender } = render(
        <ContentLayout title="First Title">
          <p>Content</p>
        </ContentLayout>,
      )
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('First Title')

      rerender(
        <ContentLayout title="Second Title">
          <p>Content</p>
        </ContentLayout>,
      )
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Second Title')
    })
  })

  describe('intro rendering', () => {
    it('renders the intro text when provided', () => {
      render(
        <ContentLayout title="Page" intro="Introduction paragraph">
          <p>Body</p>
        </ContentLayout>,
      )
      expect(screen.getByText('Introduction paragraph')).toBeTruthy()
    })

    it('does not render an intro element when intro is omitted', () => {
      const { container } = render(
        <ContentLayout title="Page">
          <p>Body</p>
        </ContentLayout>,
      )
      // The header section should only have the title, no intro paragraph
      const headerSection = container.querySelector('header.border-b')
      const paragraphs = headerSection?.querySelectorAll('p')
      expect(paragraphs?.length ?? 0).toBe(0)
    })
  })

  describe('breadcrumb rendering', () => {
    it('renders breadcrumb navigation when items are provided', () => {
      render(
        <ContentLayout
          title="Page"
          breadcrumb={[
            { label: 'Home', href: '/' },
            { label: 'Current Page' },
          ]}
        >
          <p>Body</p>
        </ContentLayout>,
      )
      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' })
      expect(breadcrumbNav).toBeTruthy()
    })

    it('renders breadcrumb items with links when href is provided', () => {
      render(
        <ContentLayout
          title="Page"
          breadcrumb={[
            { label: 'Home', href: '/' },
            { label: 'Section', href: '/section' },
            { label: 'Current' },
          ]}
        >
          <p>Body</p>
        </ContentLayout>,
      )
      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' })
      const links = within(breadcrumbNav).getAllByRole('link')
      expect(links).toHaveLength(2)
      expect(links[0]).toHaveAttribute('href', '/')
      expect(links[0].textContent).toBe('Home')
      expect(links[1]).toHaveAttribute('href', '/section')
      expect(links[1].textContent).toBe('Section')
    })

    it('renders the last breadcrumb item as plain text without a link', () => {
      render(
        <ContentLayout
          title="Page"
          breadcrumb={[
            { label: 'Home', href: '/' },
            { label: 'Current Page' },
          ]}
        >
          <p>Body</p>
        </ContentLayout>,
      )
      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' })
      expect(within(breadcrumbNav).getByText('Current Page')).toBeTruthy()
      // The "Current Page" text should be in a span, not a link
      const currentItem = within(breadcrumbNav).getByText('Current Page')
      expect(currentItem.tagName).toBe('SPAN')
    })

    it('does not render breadcrumb navigation when breadcrumb is omitted', () => {
      render(
        <ContentLayout title="Page">
          <p>Body</p>
        </ContentLayout>,
      )
      expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    })

    it('does not render breadcrumb navigation when breadcrumb is an empty array', () => {
      render(
        <ContentLayout title="Page" breadcrumb={[]}>
          <p>Body</p>
        </ContentLayout>,
      )
      expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    })

    it('renders chevron separators between breadcrumb items but not before the first', () => {
      const { container } = render(
        <ContentLayout
          title="Page"
          breadcrumb={[
            { label: 'Home', href: '/' },
            { label: 'Middle', href: '/mid' },
            { label: 'Current' },
          ]}
        >
          <p>Body</p>
        </ContentLayout>,
      )
      // ChevronRight icons are rendered as SVG elements between items
      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' })
      const listItems = within(breadcrumbNav).getAllByRole('listitem')
      expect(listItems).toHaveLength(3)
      // First item should not have a chevron; second and third should
      const svgsInFirst = listItems[0].querySelectorAll('svg')
      const svgsInSecond = listItems[1].querySelectorAll('svg')
      const svgsInThird = listItems[2].querySelectorAll('svg')
      expect(svgsInFirst).toHaveLength(0)
      expect(svgsInSecond).toHaveLength(1)
      expect(svgsInThird).toHaveLength(1)
    })
  })

  describe('children rendering', () => {
    it('renders children inside the article element', () => {
      render(
        <ContentLayout title="Page">
          <p>Paragraph one</p>
          <p>Paragraph two</p>
        </ContentLayout>,
      )
      const article = document.querySelector('article')
      expect(article).toBeTruthy()
      expect(within(article!).getByText('Paragraph one')).toBeTruthy()
      expect(within(article!).getByText('Paragraph two')).toBeTruthy()
    })

    it('renders complex nested children', () => {
      render(
        <ContentLayout title="Page">
          <h2>Section</h2>
          <ul>
            <li>Item A</li>
            <li>Item B</li>
          </ul>
        </ContentLayout>,
      )
      expect(screen.getByText('Section')).toBeTruthy()
      expect(screen.getByText('Item A')).toBeTruthy()
      expect(screen.getByText('Item B')).toBeTruthy()
    })
  })

  describe('header navigation', () => {
    it('renders a Home link in the header', () => {
      render(
        <ContentLayout title="Page">
          <p>Body</p>
        </ContentLayout>,
      )
      const primaryNav = screen.getByRole('navigation', { name: 'Primary' })
      const homeLink = within(primaryNav).getByText('Home')
      expect(homeLink.closest('a')).toHaveAttribute('href', '/')
    })

    it('renders a Login link in the header', () => {
      render(
        <ContentLayout title="Page">
          <p>Body</p>
        </ContentLayout>,
      )
      const primaryNav = screen.getByRole('navigation', { name: 'Primary' })
      const loginLink = within(primaryNav).getByText('Login')
      expect(loginLink.closest('a')).toHaveAttribute('href', '/login')
    })

    it('renders the logo with correct alt text and link', () => {
      render(
        <ContentLayout title="Page">
          <p>Body</p>
        </ContentLayout>,
      )
      const logoLink = screen.getByLabelText('Go to the Open Mercato home page')
      expect(logoLink).toHaveAttribute('href', '/')
      const logoImage = within(logoLink).getByAltText('Open Mercato logo')
      expect(logoImage).toBeTruthy()
    })
  })

  describe('footer', () => {
    it('renders footer links for Home, Login, Terms, and Privacy', () => {
      render(
        <ContentLayout title="Page">
          <p>Body</p>
        </ContentLayout>,
      )
      const footer = document.querySelector('footer')
      expect(footer).toBeTruthy()
      const footerLinks = within(footer!).getAllByRole('link')
      const hrefs = footerLinks.map((link) => link.getAttribute('href'))
      expect(hrefs).toContain('/')
      expect(hrefs).toContain('/login')
      expect(hrefs).toContain('/terms')
      expect(hrefs).toContain('/privacy')
    })

    it('displays a copyright notice with the current year', () => {
      render(
        <ContentLayout title="Page">
          <p>Body</p>
        </ContentLayout>,
      )
      const currentYear = new Date().getFullYear().toString()
      const footer = document.querySelector('footer')
      expect(footer!.textContent).toContain(currentYear)
      expect(footer!.textContent).toContain('Open Mercato')
    })
  })

  describe('accessibility', () => {
    it('uses semantic landmark elements (header, main, footer)', () => {
      render(
        <ContentLayout title="Page">
          <p>Body</p>
        </ContentLayout>,
      )
      expect(document.querySelector('header')).toBeTruthy()
      expect(document.querySelector('main')).toBeTruthy()
      expect(document.querySelector('footer')).toBeTruthy()
    })

    it('wraps content in an article element with prose styling', () => {
      render(
        <ContentLayout title="Page">
          <p>Body</p>
        </ContentLayout>,
      )
      const article = document.querySelector('article')
      expect(article).toBeTruthy()
      expect(article!.className).toContain('prose')
    })
  })
})
