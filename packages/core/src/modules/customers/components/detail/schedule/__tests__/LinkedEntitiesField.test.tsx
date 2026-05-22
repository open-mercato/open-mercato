/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LinkedEntitiesField } from '../LinkedEntitiesField'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

describe('LinkedEntitiesField', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/companies')) {
        return Promise.resolve({ items: [] })
      }
      if (url.startsWith('/api/sales/quotes')) {
        return Promise.resolve({
          items: [{ id: 'quote-1', quoteNumber: 'SQ-1001' }],
          totalPages: 1,
        })
      }
      return Promise.resolve({ items: [] })
    })
  })

  it('shows offer labels using quote numbers instead of raw ids', async () => {
    const setLinkedEntities = jest.fn()

    await act(async () => {
      renderWithProviders(
        <LinkedEntitiesField
          visible={new Set(['linkedEntities'])}
          activityType="meeting"
          linkedEntities={[]}
          setLinkedEntities={setLinkedEntities}
        />,
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /\+\s*Add link/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Offer' }))

    await waitFor(() => {
      expect(screen.getByText('SQ-1001')).toBeInTheDocument()
    })

    expect(screen.queryByText('quote-1')).not.toBeInTheDocument()
  })
})
