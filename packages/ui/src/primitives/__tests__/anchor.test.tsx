/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render as baseRender, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

import { Anchor, flattenAnchorItems, resolveActiveAnchor, type AnchorItem } from '../anchor'

function render(ui: React.ReactElement) {
  return baseRender(ui, { wrapper: ({ children }) => <I18nProvider locale="en" dict={{}}>{children}</I18nProvider> })
}

const items: AnchorItem[] = [
  { href: '#details', title: 'Details' },
  { href: '#history', title: 'History', children: [{ href: '#notes', title: 'Notes' }] },
]

const tops: Record<string, number> = { details: 0, history: 600, notes: 900 }

function mountSections() {
  for (const id of Object.keys(tops)) {
    const section = document.createElement('section')
    section.id = id
    section.getBoundingClientRect = () => ({ top: tops[id] - window.scrollY, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
    document.body.appendChild(section)
  }
}

describe('Anchor', () => {
  beforeEach(() => {
    mountSections()
    window.scrollTo = jest.fn()
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 })
  })

  afterEach(() => {
    document.querySelectorAll('section').forEach((section) => section.remove())
    jest.restoreAllMocks()
  })

  it('flattens nested items and picks the last section above the threshold', () => {
    expect(flattenAnchorItems(items).map((item) => item.href)).toEqual(['#details', '#history', '#notes'])
    expect(resolveActiveAnchor([{ href: '#a', top: -10 }, { href: '#b', top: 50 }, { href: '#c', top: 400 }], 81)).toBe('#b')
    expect(resolveActiveAnchor([{ href: '#a', top: 200 }], 81)).toBe('#a')
  })

  it('renders a labelled navigation with nested links', () => {
    render(<Anchor items={items} />)
    const nav = screen.getByRole('navigation', { name: 'On this page' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Notes' })).toHaveAttribute('href', '#notes')
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('aria-current', 'location')
  })

  it('marks the section in view while scrolling', () => {
    const onChange = jest.fn()
    render(<Anchor items={items} offset={80} onChange={onChange} />)
    act(() => {
      window.scrollY = 620
      window.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'location')
    expect(screen.getByRole('link', { name: 'Details' })).not.toHaveAttribute('aria-current')
    expect(onChange).toHaveBeenLastCalledWith('#history')
  })

  it('marks the last section when the page is scrolled to the end', () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 1400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 700 })
    render(<Anchor items={items} offset={80} />)
    act(() => {
      window.scrollY = 700
      window.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByRole('link', { name: 'Notes' })).toHaveAttribute('aria-current', 'location')
    delete (document.documentElement as { scrollHeight?: number }).scrollHeight
  })

  it('scrolls to the section with the offset and updates the hash', () => {
    const replaceState = jest.spyOn(window.history, 'replaceState')
    render(<Anchor items={items} offset={72} />)
    fireEvent.click(screen.getByRole('link', { name: 'Notes' }))
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 828, behavior: 'smooth' })
    expect(replaceState).toHaveBeenCalledWith(null, '', '#notes')
    expect(screen.getByRole('link', { name: 'Notes' })).toHaveAttribute('aria-current', 'location')
  })

  it('jumps without animation when the user prefers reduced motion', () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = jest.fn().mockReturnValue({ matches: true })
    render(<Anchor items={items} />)
    fireEvent.click(screen.getByRole('link', { name: 'History' }))
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'auto' })
    window.matchMedia = originalMatchMedia
  })

  it('leaves modified clicks to the browser', () => {
    render(<Anchor items={items} />)
    fireEvent.click(screen.getByRole('link', { name: 'History' }), { metaKey: true })
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})
