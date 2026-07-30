/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, cleanup } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/backend/design-system/mockups/customers-quick-add',
}))

import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { GalleryEntry } from '../../gallery/types'
import { loadGalleryEntryMap } from '../integrity'
import { findRepoRoot, getMockupBySlug, type LoadedMockup } from '../loader'
import { collectLeaves } from '../schema'
import { MockupLedger } from '../components/MockupLedger'
import { MockupStage } from '../components/MockupStage'

/**
 * Phase 3 draft presentation: a draft is marked with a muted chip in the
 * LEDGER HEADER (and the list) — 6px radius, no new colors — and NEVER as a
 * watermark, banner, or any markup over the stage content. The draft renders
 * normally; the review loop, not the canvas, carries the state.
 */

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let entries: Map<string, GalleryEntry>
let draft: LoadedMockup
let final: LoadedMockup

beforeAll(async () => {
  ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock
  entries = await loadGalleryEntryMap()
  const repoRoot = findRepoRoot(__dirname)
  const loadedDraft = getMockupBySlug('customers-quick-add', repoRoot)
  if (!loadedDraft?.document) throw new Error('Draft fixture missing or invalid')
  draft = loadedDraft
  const loadedFinal = getMockupBySlug('suppliers-directory', repoRoot)
  if (!loadedFinal?.document) throw new Error('Promotable fixture missing or invalid')
  final = loadedFinal
})

afterEach(cleanup)

function renderLedger(mockup: LoadedMockup) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <MockupLedger
        document={mockup.document!}
        entries={entries}
        counts={mockup.counts}
        findingsSummary={mockup.findings}
        contentHash={mockup.contentHash}
        storyFilter={null}
        hoveredBlockId={null}
        onHoverBlock={() => {}}
        onSelectBlock={() => {}}
      />
    </I18nProvider>,
  )
}

describe('design_system draft presentation', () => {
  it('shows the muted draft chip in the ledger header for draft documents', () => {
    const { container } = renderLedger(draft)
    const chip = container.querySelector('[data-testid="mockup-ledger-draft-chip"]')
    expect(chip).not.toBeNull()
    expect(chip!.textContent).toBe('Draft')
    // Muted recipe: 6px radius, border/muted tokens, no pills, no new colors.
    expect(chip!.className).toContain('rounded-sm')
    expect(chip!.className).toContain('border-border')
    expect(chip!.className).not.toMatch(/rounded-full|amber/)
    expect(container.querySelector('[data-testid="mockup-ledger-draft-note"]')).not.toBeNull()
  })

  it('shows no draft chip for finalized documents', () => {
    const { container } = renderLedger(final)
    expect(container.querySelector('[data-testid="mockup-ledger-draft-chip"]')).toBeNull()
    expect(container.querySelector('[data-testid="mockup-ledger-draft-note"]')).toBeNull()
  })

  it('renders the draft stage normally, with zero draft markup over content', () => {
    const { container } = render(
      <I18nProvider locale="en" dict={{}}>
        <MockupStage document={draft.document!} entries={entries} annotated />
      </I18nProvider>,
    )
    for (const leaf of collectLeaves(draft.document!.root)) {
      expect(container.querySelector(`[data-mockup-block-id="${leaf.id}"]`)).not.toBeNull()
    }
    // Never watermarked or bannered on the canvas: the word appears nowhere
    // inside the stage.
    const stage = container.querySelector('[data-testid="mockup-stage"]')
    expect(stage).not.toBeNull()
    expect(stage!.textContent).not.toMatch(/draft/i)
  })

  it('renders the Phase 3 compose blocks with the real primitives (table + form fields)', () => {
    const { container } = render(
      <I18nProvider locale="en" dict={{}}>
        <MockupStage document={final.document!} entries={entries} annotated={false} />
      </I18nProvider>,
    )
    // Table compose: real table with the fixture's column labels and rows.
    const table = container.querySelector('[data-mockup-block-id="directory-table"] table')
    expect(table).not.toBeNull()
    expect(table!.textContent).toContain('Onboarded')
    expect(table!.textContent).toContain('Nordwind Supplies')
    // Form-field compose: real FormField with label and control.
    const formField = container.querySelector('[data-mockup-block-id="quick-add-notes"]')
    expect(formField).not.toBeNull()
    expect(formField!.textContent).toContain('Notes')
    expect(formField!.querySelector('textarea')).not.toBeNull()
  })

  it('renders an empty-rows table compose with its empty state', () => {
    const document = JSON.parse(JSON.stringify(final.document!))
    const tableBlock = collectLeaves(document.root).find(
      (leaf) => leaf.id === 'directory-table',
    )
    if (!tableBlock || tableBlock.type !== 'block') throw new Error('table block missing')
    delete (tableBlock.props as Record<string, unknown>).rows
    const { container } = render(
      <I18nProvider locale="en" dict={{}}>
        <MockupStage document={document} entries={entries} annotated={false} />
      </I18nProvider>,
    )
    const block = container.querySelector('[data-mockup-block-id="directory-table"]')
    expect(block!.textContent).toContain('No suppliers yet')
    expect(block!.textContent).toContain('Add the first supplier')
  })
})
