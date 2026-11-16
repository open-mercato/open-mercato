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

    fireEvent.focus(screen.getByPlaceholderText('Search...'))
    fireEvent.click(screen.getByRole('radio', { name: 'Offer' }))

    await waitFor(() => {
      expect(screen.getByText('SQ-1001')).toBeInTheDocument()
    })

    expect(screen.queryByText('quote-1')).not.toBeInTheDocument()
  })

  // The guard used to be `page < totalPages`. A `totalPages` of 1 alongside a
  // full page — an under-reporting or capped total — hid the button and made
  // the remaining companies unreachable. Termination follows page fullness now.
  it('offers Load more on a full page even when totalPages reports a single page', async () => {
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/companies')) {
        return Promise.resolve({
          items: Array.from({ length: 20 }, (_, index) => ({
            id: `company-${index + 1}`,
            name: `Company ${index + 1}`,
          })),
          totalPages: 1,
          total: 3,
          pageSize: 20,
        })
      }
      return Promise.resolve({ items: [] })
    })

    await act(async () => {
      renderWithProviders(
        <LinkedEntitiesField
          visible={new Set(['linkedEntities'])}
          activityType="meeting"
          linkedEntities={[]}
          setLinkedEntities={jest.fn()}
        />,
      )
    })

    fireEvent.focus(screen.getByPlaceholderText('Search...'))

    await waitFor(() => {
      expect(screen.getByText('Company 1')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
  })

  it('hides Load more once a page comes back short', async () => {
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/companies')) {
        return Promise.resolve({
          items: [{ id: 'company-1', name: 'Company 1' }],
          // A large total must not conjure a next page.
          total: 999,
          totalPages: 50,
          pageSize: 20,
        })
      }
      return Promise.resolve({ items: [] })
    })

    await act(async () => {
      renderWithProviders(
        <LinkedEntitiesField
          visible={new Set(['linkedEntities'])}
          activityType="meeting"
          linkedEntities={[]}
          setLinkedEntities={jest.fn()}
        />,
      )
    })

    fireEvent.focus(screen.getByPlaceholderText('Search...'))

    await waitFor(() => {
      expect(screen.getByText('Company 1')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  // `/api/customers/companies` is a query-engine list: the page past the end
  // comes back empty rather than clamped, and that empty page ends the run.
  it('stops on the empty page past the end', async () => {
    readApiResultOrThrowMock.mockReset()
    let companiesCall = 0
    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/companies')) {
        companiesCall += 1
        if (companiesCall === 1) {
          return Promise.resolve({
            items: Array.from({ length: 20 }, (_, index) => ({
              id: `company-${index + 1}`,
              name: `Company ${index + 1}`,
            })),
            totalPages: 1,
            total: 20,
            pageSize: 20,
          })
        }
        return Promise.resolve({ items: [], totalPages: 1, total: 20, pageSize: 20 })
      }
      return Promise.resolve({ items: [] })
    })

    await act(async () => {
      renderWithProviders(
        <LinkedEntitiesField
          visible={new Set(['linkedEntities'])}
          activityType="meeting"
          linkedEntities={[]}
          setLinkedEntities={jest.fn()}
        />,
      )
    })

    fireEvent.focus(screen.getByPlaceholderText('Search...'))

    await waitFor(() => {
      expect(screen.getByText('Company 1')).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    })
    expect(screen.getByText('Company 20')).toBeInTheDocument()
  })
})
