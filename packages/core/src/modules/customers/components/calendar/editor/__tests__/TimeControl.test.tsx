/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TimeControl } from '../inputs'

describe('TimeControl', () => {
  const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
  })
  afterAll(() => {
    if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })

  it('shows the selected time while closed and builds the full list, with an off-grid value, on open', async () => {
    renderWithProviders(<TimeControl value="09:15" onChange={() => {}} ariaLabel="Starts" />)
    const trigger = screen.getByRole('combobox', { name: 'Starts' })
    expect(trigger).toHaveTextContent('09:15')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(49))
    expect(screen.getByRole('option', { name: '09:15', exact: true })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '23:30', exact: true })).toBeInTheDocument()
  })

  it('renders an empty draft without a phantom option', async () => {
    renderWithProviders(<TimeControl value="" onChange={() => {}} ariaLabel="Starts" />)
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Starts' }), { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(48))
  })
})
