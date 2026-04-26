/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealWonPopup } from '../DealWonPopup'

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="dialog-content" className={className}>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('DealWonPopup', () => {
  it('keeps the dialog body scrollable for short viewports', () => {
    const { container } = renderWithProviders(
      <DealWonPopup
        open
        onClose={() => undefined}
        dealTitle="Enterprise renewal"
        stats={{
          dealValue: 12000,
          dealCurrency: 'USD',
          closureOutcome: 'won',
          closedAt: '2026-04-26T10:00:00.000Z',
          pipelineName: 'Enterprise',
          dealsClosedThisPeriod: 3,
          salesCycleDays: 42,
          dealRankInQuarter: 2,
          lossReason: null,
        }}
      />,
    )

    expect(screen.getByTestId('dialog-content').className).toEqual(expect.stringContaining('max-h-[90vh]'))
    const scrollRegion = Array.from(container.querySelectorAll('div')).find((node) =>
      node.className.includes('overflow-y-auto'),
    )
    expect(scrollRegion?.className).toEqual(expect.stringContaining('max-h-[90vh]'))
  })
})
