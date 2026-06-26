/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import PipelineStagesPage from '../page'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_header: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

describe('PipelineStagesPage controls', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockImplementation((url: string) => {
      if (url === '/api/customers/pipelines') {
        return Promise.resolve({
          ok: true,
          result: { items: [{ id: 'pipeline-1', name: 'Sales', isDefault: true, updatedAt: '2026-06-01T00:00:00.000Z' }] },
        })
      }
      if (url.startsWith('/api/customers/pipeline-stages')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              { id: 'stage-1', pipelineId: 'pipeline-1', label: 'Qualification', order: 0, color: null, icon: null },
              { id: 'stage-2', pipelineId: 'pipeline-1', label: 'Proposal', order: 1, color: null, icon: null },
            ],
          },
        })
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })
  })

  it('renders stage reorder controls through the shared IconButton primitive (no raw <button>)', async () => {
    await act(async () => {
      renderWithProviders(<PipelineStagesPage />)
    })

    await waitFor(() => expect(screen.getByText('Qualification')).toBeInTheDocument())

    const moveUpButtons = screen.getAllByRole('button', { name: 'Move up' })
    const moveDownButtons = screen.getAllByRole('button', { name: 'Move down' })
    expect(moveUpButtons.length).toBe(2)
    expect(moveDownButtons.length).toBe(2)
    moveUpButtons.forEach((node) => expect(node).toHaveAttribute('data-slot', 'icon-button'))
    moveDownButtons.forEach((node) => expect(node).toHaveAttribute('data-slot', 'icon-button'))

    // First stage can't move up; last stage can't move down.
    expect(moveUpButtons[0]).toBeDisabled()
    expect(moveDownButtons[1]).toBeDisabled()
  })

  it('renders the default-pipeline toggle as a shared Checkbox primitive (no raw checkbox input)', async () => {
    await act(async () => {
      renderWithProviders(<PipelineStagesPage />)
    })

    await waitFor(() => expect(screen.getByText('Qualification')).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '+ Add pipeline' }))
    })

    await waitFor(() => expect(screen.getByText('Set as default pipeline')).toBeInTheDocument())
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toHaveAttribute('id', 'pipeline-is-default')
  })
})
