/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LinkedEntitiesField } from '../LinkedEntitiesField'
import offerWidget from '@open-mercato/core/modules/sales/widgets/injection/schedule-offer-link/widget'

const readApiResultOrThrowMock = jest.fn()
const useInjectionWidgetsMock = jest.fn()

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionWidgets: (...args: unknown[]) => useInjectionWidgetsMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

describe('LinkedEntitiesField', () => {
  beforeEach(() => {
    useInjectionWidgetsMock.mockReset()
    useInjectionWidgetsMock.mockReturnValue({ widgets: [], loading: false })
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
    useInjectionWidgetsMock.mockReturnValue({ widgets: [{ module: offerWidget }], loading: false })
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

  it('offers only customer link types when no provider is loaded', async () => {
    renderWithProviders(
      <LinkedEntitiesField visible={new Set(['linkedEntities'])} activityType="meeting" linkedEntities={[]} setLinkedEntities={jest.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /\+\s*Add link/ }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Company' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Deal' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Offer' })).not.toBeInTheDocument()
    expect(readApiResultOrThrowMock.mock.calls.every(([url]: [string]) => !url.startsWith('/api/sales/'))).toBe(true)
    expect(useInjectionWidgetsMock).toHaveBeenCalledWith('schedule:customers.link-types')
  })

  it('adds and searches a provider loaded after the built-in types', async () => {
    const setLinkedEntities = jest.fn()
    const field = () => <LinkedEntitiesField visible={new Set(['linkedEntities'])} activityType="meeting" linkedEntities={[]} setLinkedEntities={setLinkedEntities} />
    const { rerender } = renderWithProviders(field())
    fireEvent.click(screen.getByRole('button', { name: /\+\s*Add link/ }))
    expect(screen.queryByRole('button', { name: 'Offer' })).not.toBeInTheDocument()

    useInjectionWidgetsMock.mockReturnValue({ widgets: [{ module: offerWidget }], loading: false })
    rerender(field())
    fireEvent.click(await screen.findByRole('button', { name: 'Offer' }))
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'SQ-1001' } })
    fireEvent.click(await screen.findByRole('button', { name: 'SQ-1001' }))

    expect(readApiResultOrThrowMock).toHaveBeenCalledWith(expect.stringContaining('/api/sales/quotes?pageSize=20&page=1&search=SQ-1001'), expect.anything())
    const update = setLinkedEntities.mock.calls[0][0] as (current: unknown[]) => unknown[]
    expect(update([])).toEqual([{ id: 'quote-1', type: 'offer', label: 'SQ-1001' }])
  })

  it('preserves saved links when their provider is unavailable', () => {
    renderWithProviders(
      <LinkedEntitiesField visible={new Set(['linkedEntities'])} activityType="meeting" linkedEntities={[{ id: 'quote-1', type: 'offer', label: 'SQ-1001' }]} setLinkedEntities={jest.fn()} />,
    )
    expect(screen.getByText('SQ-1001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove link' })).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: /\+\s*Add link/ }))

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

    fireEvent.click(screen.getByRole('button', { name: /\+\s*Add link/ }))

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

    fireEvent.click(screen.getByRole('button', { name: /\+\s*Add link/ }))

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
