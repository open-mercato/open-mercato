/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}))

import { FindingCard } from '../backend/documents/[id]/FindingCard'
import { ReleaseGate } from '../backend/documents/[id]/ReleaseGate'
import { ReviewSummaryBar } from '../backend/documents/[id]/ReviewSummaryBar'
import { normalizeFinding, normalizeFindingSummary, type DocumentFindingItem, type FindingSummary } from '../backend/documents/[id]/findingModel'
import {
  countSectionHeadings,
  firstOpenFindingId,
  isFindingCardExpanded,
  isReviewMode,
  releaseGateState,
  reviewSummaryLine,
  reviewWorkspaceStyle,
} from '../backend/documents/[id]/reviewModeModel'
import { EditorStatusPresence } from '../backend/documents/[id]/EditorStatusPresence'
import { isPlaybookCoverageCurrent, summarizeFindings } from '../lib/findingSummary'

function finding(overrides: Record<string, unknown> = {}): DocumentFindingItem {
  const parsed = normalizeFinding({
    id: 'finding-1',
    reviewId: 'review-1',
    source: 'ai',
    severity: 'blocking',
    title: 'Term too long',
    explanation: 'Exceeds the standard position.',
    sectionLabel: '2. Obligations',
    ruleCode: 'R-3.1',
    quote: 'five years',
    suggestedText: 'two years',
    anchorStatus: 'located',
    status: 'open',
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  })
  if (!parsed) throw new Error('[internal] invalid finding fixture')
  return parsed
}

function summary(overrides: Record<string, unknown> = {}): FindingSummary {
  const parsed = normalizeFindingSummary({
    reviewId: 'review-1',
    reviewedAt: '2026-11-12T10:00:00.000Z',
    source: 'ai',
    playbook: { id: 'playbook-1', code: 'PB', name: 'Standard', version: 3 },
    coverage: { rules: 12, references: 2 },
    open: { blocking: 2, warning: 1, info: 0 },
    decided: { applied: 0, kept: 0 },
    unlocated: 0,
    ...overrides,
  })
  if (!parsed) throw new Error('[internal] invalid summary fixture')
  return parsed
}

describe('review mode model', () => {
  it('is active only when the latest review exists', () => {
    expect(isReviewMode(null)).toBe(false)
    expect(isReviewMode(summary({ reviewId: null }))).toBe(false)
    expect(isReviewMode(summary())).toBe(true)
  })

  it('keeps summaries from older servers without source and coverage', () => {
    const legacy = normalizeFindingSummary({
      reviewId: 'review-1',
      reviewedAt: null,
      open: { blocking: 0, warning: 0, info: 0 },
      decided: { applied: 0, kept: 0 },
      unlocated: 0,
    })
    expect(legacy?.source).toBeNull()
    expect(legacy?.coverage).toEqual({ rules: null, references: null })
  })

  it('derives the release gate from open blocking findings', () => {
    expect(releaseGateState(null)).toBeNull()
    expect(releaseGateState(summary({ reviewId: null }))).toBeNull()
    expect(releaseGateState(summary())).toEqual({ kind: 'blocked', blocking: 2 })
    expect(releaseGateState(summary({ open: { blocking: 0, warning: 3, info: 1 } }))).toEqual({ kind: 'ready' })
  })

  it('reports coverage when every count is known and falls back otherwise', () => {
    expect(reviewSummaryLine(summary(), 5)).toEqual({ kind: 'coverage', sections: 5, rules: 12, references: 2 })
    expect(reviewSummaryLine(summary(), 0)).toMatchObject({ kind: 'fallback', playbookName: 'Standard', playbookVersion: 3 })
    expect(reviewSummaryLine(summary({ coverage: { rules: null, references: null } }), 5)).toMatchObject({ kind: 'fallback' })
    expect(reviewSummaryLine(summary({ playbook: null, coverage: { rules: null, references: null } }), null)).toEqual({
      kind: 'fallback',
      reviewedAt: '2026-11-12T10:00:00.000Z',
      playbookName: null,
      playbookVersion: null,
    })
  })

  it('counts non-empty headings as sections', () => {
    expect(countSectionHeadings([
      { typeName: 'heading', text: '1. Definitions' },
      { typeName: 'heading', text: '  ' },
      { typeName: 'paragraph', text: 'Body' },
      { typeName: 'heading', text: '2. Obligations' },
    ])).toBe(2)
  })

  it('picks the first open finding in severity order', () => {
    const items = [
      finding({ id: 'info-1', severity: 'info' }),
      finding({ id: 'warning-1', severity: 'warning' }),
      finding({ id: 'blocking-kept', status: 'kept' }),
      finding({ id: 'blocking-1' }),
    ]
    expect(firstOpenFindingId(items)).toBe('blocking-1')
    expect(firstOpenFindingId(items, ['warning'])).toBe('warning-1')
    expect(firstOpenFindingId([finding({ status: 'applied' })], ['blocking'])).toBeNull()
  })

  it('expands the first open and the active card unless the user toggled it', () => {
    const defaults = { firstOpenId: 'a', activeId: 'b' }
    expect(isFindingCardExpanded('a', defaults, {})).toBe(true)
    expect(isFindingCardExpanded('b', defaults, {})).toBe(true)
    expect(isFindingCardExpanded('c', defaults, {})).toBe(false)
    expect(isFindingCardExpanded('a', defaults, { a: false })).toBe(false)
    expect(isFindingCardExpanded('c', defaults, { c: true })).toBe(true)
  })
})

describe('review workspace', () => {
  it('spans the backend content column through the AppShell offset', () => {
    const style = reviewWorkspaceStyle()
    expect(String(style.width)).toContain('var(--app-content-offset, 0px)')
    expect(String(style.marginLeft)).toContain('1536px')
    expect(style.marginLeft).toEqual(style.marginRight)
  })

  it('folds the realtime notice into the status pill', () => {
    render(
      <EditorStatusPresence
        status="offline"
        users={[]}
        counts={{ words: 1, characters: 4 }}
        mode="edit"
        canEdit={false}
        onModeChange={jest.fn()}
        statusNotice="documents.editor.realtime.singleUserFallback"
      />,
    )
    const pill = screen.getByTestId('documents-editor-status-pill')
    expect(pill.textContent).toContain('documents.editor.realtime.offline')
    expect(pill.textContent).toContain('documents.editor.realtime.singleUserFallback')
  })
})

describe('review summary coverage', () => {
  it('trusts playbook counts only while the playbook is at the reviewed version', () => {
    expect(isPlaybookCoverageCurrent(3, 3)).toBe(true)
    expect(isPlaybookCoverageCurrent(3, 4)).toBe(false)
    expect(isPlaybookCoverageCurrent(null, 3)).toBe(false)
    expect(isPlaybookCoverageCurrent(3, undefined)).toBe(false)
  })

  it('adds source and coverage to the summary additively', () => {
    const reviewedAt = new Date('2026-11-12T10:00:00.000Z')
    const result = summarizeFindings(
      { reviewId: 'review-1', reviewedAt, source: 'import' },
      [{ severity: 'blocking', status: 'open', anchorStatus: 'located' }],
      null,
      { rules: 4, references: 1 },
    )
    expect(result).toMatchObject({ reviewId: 'review-1', source: 'import', coverage: { rules: 4, references: 1 }, open: { blocking: 1 } })
    expect(summarizeFindings(null, [])).toMatchObject({ reviewId: null, source: null, coverage: { rules: null, references: null } })
  })
})

describe('review mode components', () => {
  const cardProps = {
    resolution: undefined,
    active: false,
    canDecide: true,
    editorEditable: true,
    pending: false,
    revertable: false,
    onLocate: jest.fn(),
    onApply: jest.fn(),
    onKeep: jest.fn(),
    onReopen: jest.fn(),
    onRevert: jest.fn(),
  }

  it('keeps the title and meta row visible and toggles the body from the header', () => {
    const onToggle = jest.fn()
    const item = finding()
    const { rerender } = render(<FindingCard {...cardProps} finding={item} expanded={false} onToggle={onToggle} />)
    const toggle = screen.getByRole('button', { name: item.title })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('2. Obligations · R-3.1')).toBeTruthy()
    expect(screen.getByTestId('documents-finding-card-body').hidden).toBe(true)
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(item)

    rerender(<FindingCard {...cardProps} finding={item} expanded onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: item.title }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('documents-finding-card-body').hidden).toBe(false)
  })

  it('shows the blocking release gate and the ready state', () => {
    const onActivate = jest.fn()
    const { rerender } = render(<ReleaseGate state={{ kind: 'blocked', blocking: 2 }} onActivate={onActivate} />)
    const gate = screen.getByTestId('documents-release-gate')
    expect(gate.getAttribute('data-state')).toBe('blocked')
    expect(gate.textContent).toContain('documents.findings.releaseGate.blocked')
    expect(gate.className).toContain('bg-status-error-bg')
    fireEvent.click(gate)
    expect(onActivate).toHaveBeenCalledTimes(1)

    rerender(<ReleaseGate state={{ kind: 'ready' }} onActivate={onActivate} />)
    expect(screen.getByTestId('documents-release-gate').textContent).toContain('documents.findings.releaseGate.ready')
    expect(screen.getByTestId('documents-release-gate').className).toContain('bg-status-success-bg')
  })

  it('renders the fallback summary line without an editor', () => {
    render(<ReviewSummaryBar summary={summary()} editor={null} />)
    const bar = screen.getByTestId('documents-review-summary-bar')
    expect(bar.getAttribute('data-coverage')).toBe('fallback')
    expect(bar.textContent).toContain('documents.findings.reviewBar.agent')
    expect(bar.textContent).toContain('documents.reviewPlaybooks.header.playbook')
  })
})
