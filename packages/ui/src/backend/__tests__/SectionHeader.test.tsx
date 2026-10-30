/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CollapsibleSection, SectionHeader } from '../SectionHeader'

const plDict = {
  'ui.sectionHeader.collapse': 'Zwiń sekcję {title}',
  'ui.sectionHeader.expand': 'Rozwiń sekcję {title}',
}

describe('CollapsibleSection', () => {
  it('translates the toggle aria-label for the active locale', () => {
    renderWithProviders(
      <CollapsibleSection title="Skrzynka">
        <p>Treść</p>
      </CollapsibleSection>,
      { locale: 'pl', dict: plDict },
    )

    expect(screen.getByRole('button', { name: 'Zwiń sekcję Skrzynka' })).toBeTruthy()
  })

  it('switches to the expand key once collapsed', () => {
    renderWithProviders(
      <CollapsibleSection title="Skrzynka">
        <p>Treść</p>
      </CollapsibleSection>,
      { locale: 'pl', dict: plDict },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Zwiń sekcję Skrzynka' }))

    expect(screen.getByRole('button', { name: 'Rozwiń sekcję Skrzynka' })).toBeTruthy()
  })

  it('falls back to English when the locale has no translation', () => {
    renderWithProviders(
      <CollapsibleSection title="Billing details">
        <p>Content</p>
      </CollapsibleSection>,
      { locale: 'en', dict: {} },
    )

    expect(screen.getByRole('button', { name: 'Collapse Billing details section' })).toBeTruthy()
  })

  it('renders outside an I18nProvider using the English fallback', () => {
    render(
      <CollapsibleSection title="Billing details">
        <p>Content</p>
      </CollapsibleSection>,
    )

    expect(screen.getByRole('button', { name: 'Collapse Billing details section' })).toBeTruthy()
  })

  it('applies titleClassName and lets the header row shrink so truncation works', () => {
    renderWithProviders(
      <CollapsibleSection title="a-fairly-long-identifier@example.com" titleClassName="truncate">
        <p>Content</p>
      </CollapsibleSection>,
      { locale: 'en', dict: {} },
    )

    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading.className).toContain('truncate')
    expect(heading.className).toContain('min-w-0')
    expect(heading.className).toContain('text-sm')
    expect(screen.getByRole('button').className).toContain('min-w-0')
  })

  it('keeps the header row unconstrained when no titleClassName is supplied', () => {
    renderWithProviders(
      <CollapsibleSection title="Billing details">
        <p>Content</p>
      </CollapsibleSection>,
      { locale: 'en', dict: {} },
    )

    expect(screen.getByRole('heading', { level: 3 }).className).not.toContain('min-w-0')
    expect(screen.getByRole('button').className).not.toContain('min-w-0')
  })
})

describe('SectionHeader', () => {
  it('applies titleClassName to the title element', () => {
    renderWithProviders(<SectionHeader title="a-fairly-long-identifier@example.com" titleClassName="truncate" />, {
      locale: 'en',
      dict: {},
    })

    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading.className).toContain('truncate')
    expect(heading.className).toContain('min-w-0')
  })

  it('keeps the title unconstrained when no titleClassName is supplied', () => {
    renderWithProviders(<SectionHeader title="Billing details" />, { locale: 'en', dict: {} })

    expect(screen.getByRole('heading', { level: 3 }).className).not.toContain('min-w-0')
  })
})
