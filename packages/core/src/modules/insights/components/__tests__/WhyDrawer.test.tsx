/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockApiCall = jest.fn()
const mockPush = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
}))

import { WhyDrawer } from '../WhyDrawer.client'
import {
  DEAL_ID,
  DICT,
  OTHER_DEAL_ID,
  apiOk,
  apiStatus,
  chainEntry,
  deferred,
  fieldResponse,
  overviewResponse,
  value,
  type MockApiResult,
} from './fixtures'

type DrawerProps = React.ComponentProps<typeof WhyDrawer>

function renderDrawer(overrides: Partial<DrawerProps> = {}) {
  const onOpenChange = jest.fn()
  const props: DrawerProps = {
    open: true,
    onOpenChange,
    resourceKind: 'customers.deal',
    resourceId: DEAL_ID,
    resourceLabelKey: 'customers.insights.resources.deal',
    ...overrides,
  }
  const view = renderWithProviders(<WhyDrawer {...props} />, { dict: DICT })
  return { ...view, onOpenChange, props }
}

function requestedUrl(callIndex: number): URL {
  return new URL(String(mockApiCall.mock.calls[callIndex][0]), 'http://localhost')
}

function requestSignal(callIndex: number): AbortSignal | undefined {
  const init = mockApiCall.mock.calls[callIndex][1] as RequestInit | undefined
  return init?.signal ?? undefined
}

describe('WhyDrawer', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockPush.mockReset()
  })

  it('shows a loading state, then the overview of explainable fields', async () => {
    const pending = deferred<MockApiResult>()
    mockApiCall.mockReturnValueOnce(pending.promise)
    renderDrawer()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('How this Deal got its current values, based on recorded history.')).toBeInTheDocument()
    expect(screen.getByText('Loading explanation…')).toBeInTheDocument()
    await act(async () => {
      pending.resolve(apiOk(overviewResponse()))
    })
    expect(await screen.findByRole('button', { name: 'Explain Status' })).toBeInTheDocument()
    const url = requestedUrl(0)
    expect(url.pathname).toBe('/api/insights/explain')
    expect(url.searchParams.get('resourceKind')).toBe('customers.deal')
    expect(url.searchParams.get('resourceId')).toBe(DEAL_ID)
    expect(url.searchParams.has('field')).toBe(false)
  })

  it('opens a field chain from the overview and returns to all fields', async () => {
    mockApiCall
      .mockResolvedValueOnce(apiOk(overviewResponse()))
      .mockResolvedValueOnce(apiOk(fieldResponse()))
      .mockResolvedValueOnce(apiOk(overviewResponse()))
    renderDrawer()
    fireEvent.click(await screen.findByRole('button', { name: 'Explain Status' }))
    expect(screen.queryByText('The explanation could not be loaded.')).toBeNull()
    expect(screen.getByText('Loading explanation…')).toBeInTheDocument()
    expect(await screen.findByTestId('insights-why-chain')).toBeInTheDocument()
    expect(requestedUrl(1).searchParams.get('field')).toBe('status')
    expect(screen.getByRole('heading', { name: 'Status' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'All fields' }))
    expect(await screen.findByRole('button', { name: 'Explain Status' })).toBeInTheDocument()
  })

  it('starts on the initial field when given', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk(fieldResponse()))
    renderDrawer({ initialField: 'status' })
    expect(await screen.findByTestId('insights-why-chain')).toBeInTheDocument()
    expect(requestedUrl(0).searchParams.get('field')).toBe('status')
  })

  it('shows an error with retry that refetches', async () => {
    mockApiCall
      .mockResolvedValueOnce(apiStatus(500))
      .mockResolvedValueOnce(apiOk(fieldResponse()))
    renderDrawer({ initialField: 'status' })
    expect(await screen.findByText('The explanation could not be loaded.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('insights-why-chain')).toBeInTheDocument()
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })

  it('renders the not-found state for a 404', async () => {
    mockApiCall.mockResolvedValueOnce(apiStatus(404, { error: 'not_found' }))
    renderDrawer({ initialField: 'status' })
    expect(await screen.findByText('Nothing to explain')).toBeInTheDocument()
    expect(screen.getByText('The record does not exist or you cannot see it.')).toBeInTheDocument()
  })

  it('renders the empty state when no field can be explained', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk(overviewResponse({ fields: [] })))
    renderDrawer()
    expect(await screen.findByText('No fields to explain')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk(overviewResponse()))
    const { onOpenChange } = renderDrawer()
    await screen.findByRole('button', { name: 'Explain Status' })
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens the deep-link page on Cmd/Ctrl+Enter', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk(fieldResponse()))
    const { onOpenChange } = renderDrawer({ initialField: 'status' })
    await screen.findByTestId('insights-why-chain')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', ctrlKey: true })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockPush).toHaveBeenCalledWith(`/backend/insights/why?resourceKind=customers.deal&resourceId=${DEAL_ID}&field=status`)
    expect(screen.getByRole('link', { name: 'Open as page' })).toHaveAttribute(
      'href',
      `/backend/insights/why?resourceKind=customers.deal&resourceId=${DEAL_ID}&field=status`,
    )
  })

  it('aborts the stale request and ignores its response when the record changes', async () => {
    const first = deferred<MockApiResult>()
    const second = deferred<MockApiResult>()
    mockApiCall.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { rerender, props } = renderDrawer({ initialField: 'status' })
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    rerender(<WhyDrawer {...props} resourceId={OTHER_DEAL_ID} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
    expect(requestSignal(0)?.aborted).toBe(true)
    expect(requestedUrl(1).searchParams.get('resourceId')).toBe(OTHER_DEAL_ID)
    await act(async () => {
      first.resolve(apiOk(fieldResponse({ chain: [chainEntry({ from: value('stale-from'), to: value('stale-to') })] })))
      second.resolve(apiOk(fieldResponse({ resourceId: OTHER_DEAL_ID, chain: [chainEntry({ from: value('fresh-from'), to: value('fresh-to') })] })))
    })
    expect(await screen.findByText('fresh-from')).toBeInTheDocument()
    expect(screen.queryByText('stale-from')).toBeNull()
  })

  it('reopens on the initial field without requesting the previously selected one', async () => {
    mockApiCall
      .mockResolvedValueOnce(apiOk(overviewResponse()))
      .mockResolvedValueOnce(apiOk(fieldResponse()))
      .mockResolvedValueOnce(apiOk(overviewResponse()))
    const { rerender, props } = renderDrawer()
    fireEvent.click(await screen.findByRole('button', { name: 'Explain Status' }))
    await screen.findByTestId('insights-why-chain')
    rerender(<WhyDrawer {...props} open={false} />)
    rerender(<WhyDrawer {...props} open />)
    expect(await screen.findByRole('button', { name: 'Explain Status' })).toBeInTheDocument()
    expect(mockApiCall).toHaveBeenCalledTimes(3)
    expect(requestedUrl(2).searchParams.has('field')).toBe(false)
  })

  it('shows a no-access state for a 403 without a retry action', async () => {
    mockApiCall.mockResolvedValueOnce(apiStatus(403, { error: 'tenant_required' }))
    renderDrawer({ initialField: 'status' })
    expect(await screen.findByText('Explanation not available')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('does not fetch while closed', () => {
    renderDrawer({ open: false })
    expect(mockApiCall).not.toHaveBeenCalled()
  })
})
