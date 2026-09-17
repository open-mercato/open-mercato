/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { WorkflowSelector } from '../WorkflowSelector'
import dictionary from '../../i18n/en.json'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
const call = apiCall as jest.Mock
const workflow = { id: 'checkout-row', workflowId: 'checkout', workflowName: 'Checkout', description: 'Confirm payment', enabled: true, version: 1 }
const response = (data: unknown[], hasMore = false) => ({ ok: true, result: { data, pagination: { hasMore } } })

beforeEach(() => call.mockReset())

test('browses all pages and searches descriptions before selecting without submitting the parent form', async () => {
  call.mockResolvedValueOnce(response([{ ...workflow, id: 'other', workflowId: 'other', workflowName: 'Other', description: 'Other' }], true))
    .mockResolvedValueOnce(response([workflow]))
  const onSelect = jest.fn()
  const onSubmit = jest.fn((event) => event.preventDefault())
  renderWithProviders(<form onSubmit={onSubmit}><WorkflowSelector isOpen onClose={jest.fn()} onSelect={onSelect} /></form>, { dict: dictionary })
  const card = await screen.findByRole('button', { name: /Checkout checkout/ })
  expect(call.mock.calls[1][0]).toContain('offset=100')
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  PAYMENT  ' } })
  expect(screen.queryByRole('button', { name: /Other other/ })).toBeNull()
  fireEvent.click(card)
  expect(onSelect).toHaveBeenCalledWith('checkout', workflow)
  expect(onSubmit).not.toHaveBeenCalled()
})

test('shows recoverable failures instead of an empty catalogue', async () => {
  call.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(response([workflow]))
  renderWithProviders(<WorkflowSelector isOpen onClose={jest.fn()} onSelect={jest.fn()} />, { dict: dictionary })
  expect(await screen.findByText('Failed to load workflows')).toBeTruthy()
  expect(screen.queryByText('No workflows available')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: /Checkout checkout/ })).toBeTruthy()
})

test('honors exclusions and clears an unsuccessful search', async () => {
  call.mockResolvedValue(response([workflow, { ...workflow, id: 'excluded', workflowId: 'excluded', workflowName: 'Excluded' }]))
  const onClose = jest.fn()
  renderWithProviders(<WorkflowSelector isOpen onClose={onClose} onSelect={jest.fn()} excludeWorkflowIds={['excluded']} />, { dict: dictionary })
  await screen.findByRole('button', { name: /Checkout checkout/ })
  expect(screen.queryByRole('button', { name: /Excluded excluded/ })).toBeNull()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'absent' } })
  expect(screen.getByText('No workflows match your search')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.getByRole('button', { name: /Checkout checkout/ })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})
