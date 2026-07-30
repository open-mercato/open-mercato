/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, cleanup } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/backend/design-system/mockups/customers-people-list',
}))

import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { GalleryEntry } from '../../gallery/types'
import { loadGalleryEntryMap } from '../integrity'
import { findRepoRoot, getMockupBySlug } from '../loader'
import { collectLeaves, type MockupDocument } from '../schema'
import { MockupStage } from '../components/MockupStage'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let entries: Map<string, GalleryEntry>
let golden: MockupDocument

beforeAll(async () => {
  ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock
  entries = await loadGalleryEntryMap()
  const loaded = getMockupBySlug('customers-people-list', findRepoRoot(__dirname))
  if (!loaded?.document) throw new Error('Golden mockup missing or invalid')
  golden = loaded.document
})

afterEach(cleanup)

function renderStage(annotated: boolean) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <MockupStage document={golden} entries={entries} annotated={annotated} />
    </I18nProvider>,
  )
}

describe('design_system mockup render smoke', () => {
  it('renders the golden mockup clean (no rails, no badges on content)', () => {
    const { container } = renderStage(false)
    expect(container.querySelector('[data-testid="mockup-stage"]')).not.toBeNull()
    // Every leaf renders a wrapper; no annotation rails in Clean mode.
    for (const leaf of collectLeaves(golden.root)) {
      expect(container.querySelector(`[data-mockup-block-id="${leaf.id}"]`)).not.toBeNull()
    }
    expect(container.querySelectorAll('[data-testid^="mockup-rail-"]')).toHaveLength(0)
  })

  it('renders the golden mockup annotated with one margin rail per leaf', () => {
    const { container } = renderStage(true)
    const leaves = collectLeaves(golden.root)
    const rails = container.querySelectorAll('[data-testid^="mockup-rail-"]')
    expect(rails).toHaveLength(leaves.length)
    // The rail is margin furniture: absolutely positioned, never a border on
    // the content itself, and uses status tokens / brand-violet only.
    for (const rail of Array.from(rails)) {
      expect(rail.className).toContain('absolute')
      expect(rail.className).toContain('border-l-4')
      expect(rail.className).not.toMatch(/amber/)
    }
  })

  it('renders the placeholder as a dashed labeled box', () => {
    const { container } = renderStage(false)
    const placeholder = container.querySelector('[data-mockup-block-id="enrichment-panel"]')
    expect(placeholder).not.toBeNull()
    expect(placeholder!.textContent).toContain('Person enrichment side panel')
    expect(placeholder!.querySelector('.border-dashed')).not.toBeNull()
  })
})
