/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import enDict from '../../../../i18n/en.json'
import AvailabilityCheckPage from '../page'

function closestLiveRegion(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('[role="alert"], [role="status"], [role="log"], [aria-live]')
}

function renderPage() {
  return renderWithProviders(<AvailabilityCheckPage />, { dict: enDict as Record<string, string> })
}

function submitCheck(productId: string) {
  fireEvent.change(screen.getByLabelText(enDict['availability.policies.form.field.productId']), {
    target: { value: productId },
  })
  fireEvent.click(screen.getByRole('button', { name: enDict['availability.check.action.run'] }))
}

describe('AvailabilityCheckPage live regions', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('announces a server error through an alert region', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 400, result: { error: 'Variant does not belong to the product.' } })
    renderPage()
    submitCheck('product-1')

    const error = await screen.findByTestId('availability-check-error')
    const alert = screen.getByRole('alert')
    expect(error.contains(alert)).toBe(true)
    expect(alert).toHaveTextContent('Variant does not belong to the product.')
  })

  it('announces a local validation error through an alert region', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: enDict['availability.check.action.run'] }))

    expect(screen.getByRole('alert')).toHaveTextContent(enDict['availability.check.errors.productRequired'])
  })

  it('renders the result inside a polite status region that exists before the check runs', async () => {
    renderPage()
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()

    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        availability: {
          state: 'in_stock',
          availableQuantity: 5,
          canFulfil: true,
          leadTimeDays: null,
          releaseAt: null,
          isAuthoritative: true,
          policySourceId: null,
        },
        policyTrace: null,
      },
    })
    submitCheck('product-1')

    const result = await screen.findByTestId('availability-check-result')
    await waitFor(() => expect(closestLiveRegion(result)).toBe(region))
    expect(region).toHaveTextContent(enDict['availability.states.in_stock'])
  })
})
