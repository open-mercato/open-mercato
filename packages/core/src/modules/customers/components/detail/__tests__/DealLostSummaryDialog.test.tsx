/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealLostSummaryDialog } from '../DealLostSummaryDialog'

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="dialog-content" className={className}>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('DealLostSummaryDialog', () => {
  it('shows entered loss notes under the loss notes heading', () => {
    renderWithProviders(
      <DealLostSummaryDialog
        open
        onClose={() => undefined}
        dealTitle="Enterprise renewal"
        lossNotes="Budget owner chose a cheaper vendor."
        stats={{
          dealValue: 12000,
          dealCurrency: 'USD',
          closureOutcome: 'lost',
          closedAt: '2026-04-26T10:00:00.000Z',
          pipelineName: 'Enterprise',
          dealsClosedThisPeriod: 3,
          salesCycleDays: 42,
          dealRankInQuarter: 2,
          lossReason: 'Price',
        }}
      />,
    )

    expect(screen.getByText('Loss notes')).toBeVisible()
    expect(screen.queryByText("What's next")).not.toBeInTheDocument()
    expect(screen.getByText('Budget owner chose a cheaper vendor.')).toBeVisible()
  })
})
