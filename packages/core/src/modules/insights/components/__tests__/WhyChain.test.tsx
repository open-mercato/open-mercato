/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { WhyChain } from '../WhyChain'
import {
  DICT,
  LOG_NEWEST,
  LOG_OLDER,
  LOG_OLDEST,
  cause,
  chainEntry,
  fieldResponse,
  redactedValue,
  value,
} from './fixtures'

function renderChain(props: React.ComponentProps<typeof WhyChain>) {
  return renderWithProviders(<WhyChain {...props} />, { dict: DICT, locale: 'en' })
}

describe('WhyChain', () => {
  it('shows the verdict, confidence, summary with a localized date, and the current value', () => {
    renderChain({ explanation: fieldResponse() })
    expect(screen.getByText('Explained')).toBeInTheDocument()
    const formatted = formatDisplayDateTime('2026-10-01T10:15:00.000Z', 'en') as string
    expect(screen.getByText(`The current value was set on ${formatted}. Recorded changes: 1.`)).toBeInTheDocument()
    expect(screen.getByText('Current value').nextSibling).toHaveTextContent('won')
  })

  it('renders each entry with time, actor, from/to values, cause chip and confidence', () => {
    renderChain({ explanation: fieldResponse() })
    const item = screen.getByText('open').closest('li') as HTMLElement
    expect(within(item).getByText('won')).toBeInTheDocument()
    expect(within(item).getByText('by Alice Admin')).toBeInTheDocument()
    expect(within(item).getByText('User')).toBeInTheDocument()
    expect(within(item).getByText('Proven')).toBeInTheDocument()
    expect(item.querySelector('time')).toHaveAttribute('dateTime', '2026-10-01T10:15:00.000Z')
  })

  it('expands and collapses entry details', () => {
    renderChain({ explanation: fieldResponse() })
    const toggle = screen.getByRole('button', { name: 'Change details' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('customers.deals.update')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('customers.deals.update')).toBeInTheDocument()
    expect(document.getElementById(toggle.getAttribute('aria-controls') as string)).not.toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('customers.deals.update')).toBeNull()
  })

  it('renders redacted values and another user without leaking identity', () => {
    renderChain({
      explanation: fieldResponse({
        viewer: { canSeeActors: false, canSeePastValues: false, canSeeOwnValues: true },
        chain: [
          chainEntry({
            from: redactedValue(),
            to: redactedValue(),
            actor: { kind: 'user', id: null, label: null, isSelf: false, redacted: true },
          }),
        ],
      }),
    })
    expect(screen.getAllByText('Hidden')).toHaveLength(2)
    for (const node of document.querySelectorAll('[data-value-tone="redacted"]')) {
      expect(node.querySelector('svg')).not.toBeNull()
    }
    expect(screen.getByText('by Another user')).toBeInTheDocument()
    expect(screen.queryByText(/Alice/)).toBeNull()
    expect(screen.getByText('Past values of changes made by other users are hidden.')).toBeInTheDocument()
  })

  it('labels own changes as "You" and marks undone entries', () => {
    renderChain({
      explanation: fieldResponse({
        chain: [
          chainEntry({
            state: 'undone',
            undoneBy: LOG_OLDER,
            actor: { kind: 'user', id: 'me', label: 'Me', isSelf: true, redacted: false },
            from: value('won', { source: 'synthesized' }),
          }),
        ],
      }),
    })
    expect(screen.getByText('by You')).toBeInTheDocument()
    expect(screen.getByText('Undone')).toHaveAttribute('data-entry-state', 'undone')
    expect(screen.getByText('The value before the undo is copied from the undone change.')).toBeInTheDocument()
  })

  it('places gaps between the current value and the chain and after the entry they precede', () => {
    renderChain({
      explanation: fieldResponse({
        verdict: 'unexplained',
        confidence: 'unknown',
        chain: [chainEntry({ logId: LOG_NEWEST }), chainEntry({ logId: LOG_OLDER, from: value('new'), to: value('open') })],
        gaps: [
          { afterLogId: LOG_NEWEST, beforeLogId: null, reason: 'current_differs', at: '2026-10-02T08:00:00.000Z' },
          { afterLogId: LOG_OLDER, beforeLogId: LOG_NEWEST, reason: 'unlogged_change', at: '2026-10-01T10:15:00.000Z' },
        ],
      }),
    })
    const list = screen.getByText('Recorded changes').parentElement?.querySelector('ol') as HTMLElement
    const children = Array.from(list.children)
    expect(children.map((node) => node.getAttribute('data-gap-reason') ?? node.getAttribute('data-log-id'))).toEqual([
      'current_differs',
      LOG_NEWEST,
      'unlogged_change',
      LOG_OLDER,
    ])
    expect(screen.getByText('The current value differs from the last recorded value')).toBeInTheDocument()
    expect(screen.getByText('A change between these entries was not recorded')).toBeInTheDocument()
  })

  it('renders hints with translated detail keys and reference links', () => {
    renderChain({
      explanation: fieldResponse({
        hints: [
          { key: 'insights.explain.hints.truncated', params: {} },
          {
            key: 'insights.explain.hints.unloggedWriter',
            params: { writerId: 'sync', labelKey: 'insights.why.chain.details.note' },
          },
          {
            key: 'insights.explain.hints.providerFailed',
            params: {},
            confidence: 'inferred',
            reference: { kind: 'catalog.price', id: 'p1', label: 'Price list A', href: '/backend/catalog/prices/p1' },
          },
        ],
      }),
    })
    expect(screen.getByText('Only the most recent history was scanned; older entries were not checked.')).toBeInTheDocument()
    expect(screen.getByText('A known process can change this value without recording history.')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Price list A' })).toHaveAttribute('href', '/backend/catalog/prices/p1')
  })

  it('loads older changes through nextBefore and appends them', () => {
    const onLoadOlder = jest.fn()
    const { rerender } = renderChain({
      explanation: fieldResponse({ page: { limit: 1, nextBefore: 'cursor-1', scanned: 1, truncated: false, continuation: false } }),
      onLoadOlder,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load older changes' }))
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
    const olderPage = fieldResponse({
      chain: [chainEntry({ logId: LOG_OLDEST, from: value('draft'), to: value('open') })],
      page: { limit: 1, nextBefore: null, scanned: 2, truncated: false, continuation: true },
    })
    rerender(
      <WhyChain
        explanation={fieldResponse({ page: { limit: 1, nextBefore: 'cursor-1', scanned: 1, truncated: false, continuation: false } })}
        olderPages={[olderPage]}
        onLoadOlder={onLoadOlder}
      />,
    )
    expect(screen.getByText('draft')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load older changes' })).toBeNull()
  })

  it('does not repeat gaps that several pages report for the same entries', () => {
    const sharedGap = { afterLogId: LOG_OLDEST, beforeLogId: LOG_OLDER, reason: 'unlogged_change' as const, at: '2026-09-30T10:00:00.000Z' }
    renderChain({
      explanation: fieldResponse({
        chain: [chainEntry({ logId: LOG_NEWEST }), chainEntry({ logId: LOG_OLDER, from: value('new'), to: value('open') })],
        gaps: [sharedGap],
        page: { limit: 2, nextBefore: 'cursor-1', scanned: 3, truncated: false, continuation: false },
      }),
      olderPages: [
        fieldResponse({
          chain: [chainEntry({ logId: LOG_OLDEST, from: value('draft'), to: value('new') })],
          gaps: [sharedGap],
          page: { limit: 2, nextBefore: null, scanned: 1, truncated: false, continuation: true },
        }),
      ],
    })
    expect(screen.getAllByText('A change between these entries was not recorded')).toHaveLength(1)
  })

  it('shows an error with retry when older changes fail to load', () => {
    const onLoadOlder = jest.fn()
    renderChain({
      explanation: fieldResponse({ page: { limit: 1, nextBefore: 'cursor-1', scanned: 1, truncated: false, continuation: false } }),
      olderStatus: 'error',
      onLoadOlder,
    })
    expect(screen.getByText('Older changes could not be loaded.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  it('renders an empty state when no change is recorded', () => {
    renderChain({
      explanation: fieldResponse({
        verdict: 'no_history',
        confidence: 'unknown',
        chain: [],
        summary: { key: 'insights.explain.summary.noHistory', params: {} },
      }),
    })
    expect(screen.getByText('No recorded changes')).toBeInTheDocument()
    expect(screen.getAllByText('No recorded history touches this value.').length).toBeGreaterThan(0)
  })

  it('shows legacy causes with their honest note in details', () => {
    renderChain({
      explanation: fieldResponse({
        chain: [
          chainEntry({
            confidence: 'inferred',
            cause: cause({ legacy: true, labelKey: 'insights.explain.cause.legacyUser' }),
          }),
        ],
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Change details' }))
    expect(screen.getByText('Recorded as a user action — may have been automation')).toBeInTheDocument()
  })
})
