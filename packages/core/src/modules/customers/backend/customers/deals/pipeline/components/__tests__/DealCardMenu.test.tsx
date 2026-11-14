/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DealCardMenu } from '../DealCardMenu'

it('keeps a standard 32px action target without enlarging the icon', () => {
  render(<DealCardMenu ariaLabel="Deal actions" items={[{ id: 'open', label: 'Open', onSelect: jest.fn() }]} />)
  const trigger = screen.getByRole('button', { name: 'Deal actions' })
  expect(trigger).toHaveClass('size-8')
  expect(trigger).toHaveAttribute('type', 'button')
  expect(trigger.querySelector('svg')).toHaveClass('size-3.5')
})

it('opens by pointer, navigates by keyboard and returns focus on Escape', async () => {
  const onSelect = jest.fn()
  render(<DealCardMenu ariaLabel="Deal actions" items={[
    { id: 'open', label: 'Open', onSelect },
    { id: 'edit', label: 'Edit', onSelect: jest.fn() },
  ]} />)
  const trigger = screen.getByRole('button', { name: 'Deal actions' })
  fireEvent.click(trigger)
  await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus())
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
  expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Open' }))
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})
