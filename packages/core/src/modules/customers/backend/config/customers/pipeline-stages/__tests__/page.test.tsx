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
          result: { items: [{ id: 'pipeline-1', name: 'Sales', isDefault: true, stageProbabilitiesEnabled: true, updatedAt: '2026-06-01T00:00:00.000Z' }] },
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
    const checkbox = screen.getByRole('checkbox', { name: 'Set as default pipeline' })
    expect(checkbox).toHaveAttribute('id', 'pipeline-is-default')
    const stageProbabilitiesCheckbox = screen.getByRole('checkbox', { name: 'Use default stage probabilities' })
    expect(stageProbabilitiesCheckbox).toHaveAttribute('id', 'pipeline-stage-probabilities')
  })

  const submitShortcuts = [
    ['Ctrl+Enter', { key: 'Enter', ctrlKey: true }],
    ['Cmd+Enter', { key: 'Enter', metaKey: true }],
  ] as const

  it.each(submitShortcuts)('saves the stage with %s from the default probability field', async (_shortcut, keyDown) => {
    renderWithProviders(<PipelineStagesPage />)
    await screen.findByText('Qualification')
    const [, editStage] = screen.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(editStage)

    const probability = screen.getByRole('spinbutton', { name: 'Default probability (%)' })
    fireEvent.change(probability, { target: { value: '25' } })
    fireEvent.keyDown(probability, keyDown)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit stage' })).not.toBeInTheDocument())
    const updates = apiCallMock.mock.calls.filter(([url, options]) => url === '/api/customers/pipeline-stages' && options?.method === 'PUT')
    expect(updates).toHaveLength(1)
    expect(JSON.parse(updates[0][1].body)).toMatchObject({ id: 'stage-1', defaultProbability: 25 })
  })

  it.each(submitShortcuts)('saves the pipeline with %s from the stage probabilities checkbox', async (_shortcut, keyDown) => {
    renderWithProviders(<PipelineStagesPage />)
    await screen.findByText('Qualification')
    const [editPipeline] = screen.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(editPipeline)

    const checkbox = screen.getByRole('checkbox', { name: 'Use default stage probabilities' })
    fireEvent.click(checkbox)
    fireEvent.keyDown(checkbox, keyDown)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit pipeline' })).not.toBeInTheDocument())
    const updates = apiCallMock.mock.calls.filter(([url, options]) => url === '/api/customers/pipelines' && options?.method === 'PUT')
    expect(updates).toHaveLength(1)
    expect(JSON.parse(updates[0][1].body)).toMatchObject({ id: 'pipeline-1', stageProbabilitiesEnabled: false })
  })

  it('lets the color picker handle Enter before saving the stage', async () => {
    renderWithProviders(<PipelineStagesPage />)
    await screen.findByText('Qualification')
    const [, editStage] = screen.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(editStage)

    const color = screen.getByRole('button', { name: 'Color' })
    fireEvent.click(color)
    const hex = screen.getByDisplayValue('#000000')
    fireEvent.change(hex, { target: { value: '#123456' } })
    fireEvent.keyDown(hex, { key: 'Enter', ctrlKey: true })
    expect(color).toHaveTextContent('#123456')
    expect(screen.getByRole('dialog', { name: 'Edit stage' })).toBeInTheDocument()

    fireEvent.click(color)
    fireEvent.keyDown(screen.getByPlaceholderText('e.g. Qualification'), { key: 'Enter' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit stage' })).not.toBeInTheDocument())
    const updates = apiCallMock.mock.calls.filter(([url, options]) => url === '/api/customers/pipeline-stages' && options?.method === 'PUT')
    expect(updates).toHaveLength(1)
    expect(JSON.parse(updates[0][1].body)).toMatchObject({ id: 'stage-1', color: '#123456' })
  })
})
