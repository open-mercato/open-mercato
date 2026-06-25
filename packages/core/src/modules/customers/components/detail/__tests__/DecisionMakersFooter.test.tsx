/**
 * @jest-environment jsdom
 */
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DecisionMakersFooter } from '../DecisionMakersFooter'

// Regression for issue #3525: starring a Person in the Company detail view mounts
// DecisionMakersFooter, whose "Send invitation" tooltip previously rendered a raw
// <Tooltip> with no <TooltipProvider> ancestor. The backend shell provides no global
// TooltipProvider, so the favourite action crashed the page with
// "`Tooltip` must be used within `TooltipProvider`". renderWithProviders deliberately
// omits a TooltipProvider, mirroring the backend shell, so a regression would throw here.

describe('DecisionMakersFooter — tooltip provider regression (#3525)', () => {
  it('renders the send-invitation tooltip without a surrounding TooltipProvider', () => {
    expect(() =>
      renderWithProviders(
        <DecisionMakersFooter names={['Jan Kowalski']} onSendInvitation={() => {}} />,
      ),
    ).not.toThrow()

    expect(screen.getByText('Send invitation')).toBeInTheDocument()
    expect(screen.getByText('Decision Makers')).toBeInTheDocument()
  })

  it('returns nothing when there are no decision makers', () => {
    const { container } = renderWithProviders(
      <DecisionMakersFooter names={[]} onSendInvitation={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
