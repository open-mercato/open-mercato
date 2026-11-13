/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { metadata } from '../../backend/design-system/page.meta'
import { EntryCard } from '../components/EntryCard'
import type { GalleryEntry } from '../types'

function specimen() {
  const first = jest.fn(() => <div>First live example</div>)
  const second = jest.fn(() => <div>Second live example</div>)
  const entry: GalleryEntry = {
    id: 'test-component', title: 'Test component', importPath: '@open-mercato/ui/primitives/button',
    variants: [
      { id: 'first', title: 'First', render: first, code: '<Button>First</Button>' },
      { id: 'second', title: 'Second', render: second, code: '<Button>Second</Button>' },
    ],
  }
  return { first, second, entry }
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider locale="en" dict={{}}>{children}</I18nProvider>
}

describe('native Settings design-system explorer', () => {
  it('belongs to Settings and retains the existing access feature', () => {
    expect(metadata.pageContext).toBe('settings')
    expect(metadata.pageGroupKey).toBe('backend.nav.developers')
    expect(metadata.requireAuth).toBe(true)
    expect(metadata.requireFeatures).toEqual(['design_system.view'])
  })

  it('lists components without mounting their interactive variants', () => {
    const { entry, first, second } = specimen()
    render(<EntryCard entry={entry} summary />, { wrapper })
    expect(screen.getByRole('heading', { name: 'Test component' })).toBeTruthy()
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })

  it('keeps source metadata without rendering links to Figma', () => {
    const { entry } = specimen()
    entry.figmaNodeId = '129:1422'
    const { container } = render(<EntryCard entry={entry} summary />, { wrapper })
    expect(container.querySelector('a[href*="figma.com"]')).toBeNull()
  })

  it('shows one working example in family cards without mounting every variant or showing implementation metadata', () => {
    const { entry, first, second } = specimen()
    render(<EntryCard entry={entry} summary summaryPreview href="/backend/design-system?family=buttons&entry=test-component" />, { wrapper })
    expect(screen.getByText('First live example')).toBeVisible()
    expect(screen.getByText('First live example').closest('[inert]')).not.toBeNull()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(screen.queryByText(entry.importPath)).toBeNull()
    expect(screen.getByRole('link', { name: entry.title })).toHaveAttribute('href', '/backend/design-system?family=buttons&entry=test-component')
  })

  it('shows every variant immediately without a variant selector', () => {
    const { entry, first, second } = specimen()
    render(<EntryCard entry={entry} />, { wrapper })
    expect(screen.getByText('First live example')).toBeVisible()
    expect(screen.getByText('Second live example')).toBeVisible()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(document.getElementById('gallery-variant-test-component-second')).not.toBeNull()
  })
})
