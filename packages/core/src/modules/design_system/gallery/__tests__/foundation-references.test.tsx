/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import english from '../../i18n/en.json'
import { FoundationGuide } from '../components/FoundationGuide'
import { SourceColors, SourceGrids, SourceRadius, SourceShadows, SourceTypography } from '../demos/foundation-references'
import { entries } from '../entries/foundations'

function wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider locale="en" dict={english}>{children}</I18nProvider>
}

it('shows all measured foundation collections in the native guide', () => {
  const selected = entries.filter(entry => ['typography', 'corner-radius', 'shadows', 'spacing'].includes(entry.id))
  const { container } = render(<FoundationGuide entries={selected} />, { wrapper })
  expect(container.querySelectorAll('[data-foundation="typography"]')).toHaveLength(22)
  expect(container.querySelectorAll('[data-foundation="radius"]')).toHaveLength(12)
  expect(container.querySelectorAll('[data-foundation="shadow"]')).toHaveLength(13)
  expect(container.querySelectorAll('[data-foundation="grid"]')).toHaveLength(4)
  expect(container.querySelector('a[href*="figma.com"]')).toBeNull()
  expect(container.querySelector('select')).toBeNull()
})

it('keeps the original Figma metrics in source specimens without substituting approximate application scales', () => {
  const { container } = render(<><SourceTypography /><SourceRadius /><SourceShadows /><SourceGrids /></>, { wrapper })
  const title = container.querySelector('[data-foundation="typography"] > p') as HTMLElement
  expect(title.style.fontSize).toBe('56px')
  expect(title.style.lineHeight).toBe('64px')
  expect(title.style.letterSpacing).toBe('-0.01em')
  const radiusTiles = Array.from(container.querySelectorAll('[data-foundation="radius"] > div:first-child')) as HTMLElement[]
  expect(radiusTiles.map(item => item.style.borderRadius)).toContain('28px')
  expect(screen.getByText('108 px')).toBeVisible()
})

it('makes every measured color available and copies the actual fill after filtering', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const { container } = render(<SourceColors />, { wrapper })
  expect(container.querySelectorAll('[data-foundation="color"]')).toHaveLength(358)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Neutral Gray [950]' } })
  const swatches = container.querySelectorAll('[data-foundation="color"]')
  expect(swatches).toHaveLength(1)
  fireEvent.click(swatches[0])
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('#171717'))
})

it('leads with usage guidance and shows the complete typography reference without a disclosure', () => {
  const typography = entries.find(entry => entry.id === 'typography')!
  const { container } = render(<FoundationGuide entries={[typography]} />, { wrapper })
  const roles = container.querySelectorAll('[data-typography-role]')
  expect(roles).toHaveLength(5)
  expect(screen.getByText('Workspace settings')).toBeVisible()
  expect(screen.getByText(/Use once at the top of a page/)).toBeVisible()
  expect(screen.getByText(/a placeholder does not replace the label/)).toBeVisible()
  const sourceStyle = container.querySelector('[data-foundation="typography"]')!
  expect(container.querySelector('details')).toBeNull()
  expect(sourceStyle).toBeVisible()
  expect(container.querySelectorAll('[data-foundation="typography"]')).toHaveLength(22)
})
