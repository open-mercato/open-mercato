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
import { computeContentHash, findRepoRoot, getMockupBySlug, type LoadedMockup } from '../loader'
import { MockupLedger } from '../components/MockupLedger'
import { MockupStage } from '../components/MockupStage'

/**
 * Findings render in the rail+ledger vocabulary ONLY (Phase 2): severity
 * segments in the margin gutter and ledger entries; stale findings are dimmed
 * and labeled IN THE LEDGER; content is never outlined, badged, or dimmed.
 */

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let entries: Map<string, GalleryEntry>
let golden: LoadedMockup

beforeAll(async () => {
  ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock
  entries = await loadGalleryEntryMap()
  const loaded = getMockupBySlug('customers-people-list', findRepoRoot(__dirname))
  if (!loaded?.document) throw new Error('Golden mockup missing or invalid')
  golden = loaded
})

afterEach(cleanup)

describe('design_system mockup findings rendering', () => {
  it('renders severity rail segments in the margin gutter, never on content', () => {
    const { container } = render(
      <I18nProvider locale="en" dict={{}}>
        <MockupStage document={golden.document!} entries={entries} annotated />
      </I18nProvider>,
    )
    const tableSegment = container.querySelector(
      '[data-testid="mockup-finding-segment-f-om-empty-state-next-action--people-table"]',
    )
    expect(tableSegment).not.toBeNull()
    // High severity → status-error tokens; the segment sits in the gutter
    // (absolute container), not inside the block content.
    expect(tableSegment!.className).toContain('bg-status-error-icon')
    expect(tableSegment!.className).not.toMatch(/amber/)
    const gutter = container.querySelector('[data-testid="mockup-finding-rail-people-table"]')
    expect(gutter).not.toBeNull()
    expect(gutter!.className).toContain('absolute')
    expect(gutter!.className).toContain('pointer-events-none')
  })

  it('hides all finding segments in Clean mode', () => {
    const { container } = render(
      <I18nProvider locale="en" dict={{}}>
        <MockupStage document={golden.document!} entries={entries} annotated={false} />
      </I18nProvider>,
    )
    expect(container.querySelectorAll('[data-testid^="mockup-finding-"]')).toHaveLength(0)
  })

  it('the ledger lists findings; stale ones are dimmed with a label, fresh ones are not', () => {
    const contentHash = computeContentHash(golden.document!)
    const { container, getAllByText } = render(
      <I18nProvider locale="en" dict={{}}>
        <MockupLedger
          document={golden.document!}
          entries={entries}
          counts={golden.counts}
          findingsSummary={golden.findings}
          contentHash={contentHash}
          storyFilter={null}
          hoveredBlockId={null}
          onHoverBlock={() => {}}
          onSelectBlock={() => {}}
        />
      </I18nProvider>,
    )
    // Findings count in the ledger header.
    const header = container.querySelector('[data-testid="mockup-ledger-findings-count"]')
    expect(header).not.toBeNull()
    expect(header!.textContent).toContain('3')
    // The stale judgment finding on view-switcher is dimmed + labeled.
    const stale = container.querySelector(
      '[data-testid="mockup-ledger-finding-f-nielsen-04--view-switcher"]',
    )
    expect(stale).not.toBeNull()
    expect(stale!.getAttribute('data-mockup-finding-stale')).toBe('true')
    expect(stale!.className).toContain('opacity-50')
    expect(getAllByText('Stale').length).toBeGreaterThan(0)
    // The fresh mechanical finding is neither dimmed nor labeled.
    const fresh = container.querySelector(
      '[data-testid="mockup-ledger-finding-f-om-empty-state-next-action--people-table"]',
    )
    expect(fresh).not.toBeNull()
    expect(fresh!.getAttribute('data-mockup-finding-stale')).toBeNull()
    expect(fresh!.className).not.toContain('opacity-50')
    // Screen-level findings render in their own ledger section.
    expect(container.querySelector('[data-testid="mockup-ledger-document-findings"]')).not.toBeNull()
    // The evidence tag renders as a small uppercase chip on semantic tokens —
    // muted, 6px radius, never a pill, never a new color.
    const evidenceTag = fresh!.querySelector('[data-mockup-finding-evidence="heuristic"]')
    expect(evidenceTag).not.toBeNull()
    expect(evidenceTag!.textContent).toBe('heuristic')
    expect(evidenceTag!.className).toContain('uppercase')
    expect(evidenceTag!.className).toContain('rounded-sm')
    expect(evidenceTag!.className).toContain('text-muted-foreground')
    expect(evidenceTag!.className).not.toMatch(/rounded-full|amber/)
    // The stale judgment finding is tagged as an assumption.
    expect(stale!.querySelector('[data-mockup-finding-evidence="assumption"]')).not.toBeNull()
    // The ledger header surfaces the assumption count beside the stale count.
    const assumptions = container.querySelector('[data-testid="mockup-ledger-assumptions-count"]')
    expect(assumptions).not.toBeNull()
    expect(assumptions!.textContent).toContain('1')
  })
})
