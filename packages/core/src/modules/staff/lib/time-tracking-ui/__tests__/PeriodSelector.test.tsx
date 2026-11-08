/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { PeriodSelector } from '../PeriodSelector'
import { formatPeriodLabel } from '../timesheetPeriod'

const mockTranslate = (key: string, fallback?: string): string => fallback ?? key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

describe('PeriodSelector', () => {
  it('lets the period label shrink below sm and keeps the full label in its title', () => {
    render(
      <PeriodSelector
        periodKind="week"
        anchorDate="2026-11-04"
        onPeriodKindChange={jest.fn()}
        onAnchorDateChange={jest.fn()}
        locale="pl"
      />,
    )
    const fullLabel = formatPeriodLabel('week', '2026-11-04', 'pl')
    const label = screen.getByTitle(fullLabel)

    expect(label).toHaveTextContent(fullLabel)
    expect(label).toHaveClass('min-w-0', 'truncate', 'sm:min-w-48')
    expect(label).not.toHaveClass('min-w-48')
    expect(label.parentElement).toHaveClass('min-w-0', 'max-w-full')
    expect(label.parentElement?.parentElement).toHaveClass('min-w-0')
    expect(screen.getByRole('button', { name: 'Today' })).toHaveClass('shrink-0')
  })
})
