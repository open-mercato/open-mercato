/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { DictionaryValue } from '../dictionaryAppearance'

const map = {
  active: { value: 'active', label: 'Active', color: '#16a34a', icon: 'lucide:check' },
  plain: { value: 'plain', label: 'Plain', color: null, icon: null },
}

function dotOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('span[style*="background-color"]')
}

describe('DictionaryValue appearances', () => {
  it('renders the label alone by default, even when the entry has a colour and an icon', () => {
    const { container } = render(<DictionaryValue value="active" map={map} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(dotOf(container)).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('leads with the entry colour for dot and pill-dot', () => {
    for (const appearance of ['dot', 'pill-dot'] as const) {
      const { container, unmount } = render(<DictionaryValue value="active" map={map} appearance={appearance} />)
      expect(dotOf(container)).not.toBeNull()
      expect(screen.getByText('Active')).toBeInTheDocument()
      unmount()
    }
  })

  it('shows no dot for an entry without a colour', () => {
    const { container } = render(<DictionaryValue value="plain" map={map} appearance="dot" />)
    expect(dotOf(container)).toBeNull()
    expect(screen.getByText('Plain')).toBeInTheDocument()
  })

  it('wraps the label in a badge for pill and keeps it colourless', () => {
    const { container } = render(<DictionaryValue value="active" map={map} appearance="pill" />)
    expect(container.querySelector('[data-slot="badge"]')).not.toBeNull()
    expect(dotOf(container)).toBeNull()
  })

  it('falls back to the raw value and to the fallback node', () => {
    const { rerender } = render(<DictionaryValue value="unknown" map={map} />)
    expect(screen.getByText('unknown')).toBeInTheDocument()
    rerender(<DictionaryValue value={null} map={map} fallback={<span>none</span>} />)
    expect(screen.getByText('none')).toBeInTheDocument()
  })
})
