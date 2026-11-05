/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesAddNewMenu } from '../ActivitiesAddNewMenu'

describe('ActivitiesAddNewMenu', () => {
  it('renders the trigger and menu options through the shared Button primitive (no raw <button>)', async () => {
    await act(async () => {
      renderWithProviders(<ActivitiesAddNewMenu onSelect={jest.fn()} />)
    })

    const trigger = screen.getByRole('button', { name: 'Add new' })
    expect(trigger).toHaveAttribute('data-slot', 'button')

    await act(async () => {
      fireEvent.click(trigger)
    })

    await waitFor(() => expect(screen.getByText('New meeting')).toBeInTheDocument())
    const optionButtons = screen
      .getAllByRole('button')
      .filter((node) => node.getAttribute('data-slot') === 'button')
    expect(optionButtons.length).toBeGreaterThanOrEqual(5)
  })

  it('invokes onSelect with the chosen activity kind and closes the menu', async () => {
    const onSelect = jest.fn()
    await act(async () => {
      renderWithProviders(<ActivitiesAddNewMenu onSelect={onSelect} />)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add new' }))
    })
    await waitFor(() => expect(screen.getByText('Log call')).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(screen.getByText('Log call'))
    })

    expect(onSelect).toHaveBeenCalledWith('call')
  })

  it('disables the trigger when disabled', async () => {
    await act(async () => {
      renderWithProviders(<ActivitiesAddNewMenu onSelect={jest.fn()} disabled />)
    })
    expect(screen.getByRole('button', { name: 'Add new' })).toBeDisabled()
  })
})
