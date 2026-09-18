/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ProcessEventPicker } from '../backend/processes/definitions/ProcessEventPicker'
import dictionary from '../i18n/en.json'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
const apiCallMock = apiCall as jest.Mock

test('recovers from a failed catalog request and selects a readable event without inventing an ID', async () => {
  apiCallMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
    ok: true,
    result: {
      data: [
        { id: 'cases.case.received', label: 'Case received', description: 'A new case is ready' },
        { id: 'cases.internal.updated', label: 'Internal event', excludeFromTriggers: true },
      ],
    },
  })
  const onChange = jest.fn()
  renderWithProviders(<ProcessEventPicker value="" onChange={onChange} />, { dict: dictionary })
  expect(
    await screen.findByText(dictionary['agent_orchestrator.processDefinitions.triggers.event.loadError']),
  ).toBeTruthy()
  fireEvent.click(
    screen.getByRole('button', {
      name: dictionary['agent_orchestrator.processDefinitions.milestones.retry'],
    }),
  )
  const input = screen.getByRole('combobox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'case' } })
  fireEvent.click(await screen.findByRole('option', { name: /Case received/ }))
  expect(onChange).toHaveBeenCalledWith('cases.case.received')
  expect(screen.queryByRole('option', { name: /Internal event/ })).toBeNull()
})
