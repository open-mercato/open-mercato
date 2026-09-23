/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { CryptocurrencyDemo, type CryptocurrencyDemoProps } from '../demos/cryptocurrency'
import dictionary from '../../i18n/en.json'

const renderCrypto = (props: CryptocurrencyDemoProps) =>
  render(
    <I18nProvider locale="en" dict={dictionary}>
      <CryptocurrencyDemo {...props} />
    </I18nProvider>,
  )

it('validates the balance and calculates the quote from the selected demo pair', () => {
  renderCrypto({ part: 'swap' })
  const selling = screen.getByRole('textbox', { name: 'You are selling' })
  fireEvent.change(selling, { target: { value: '1' } })
  expect(screen.getByRole('alert')).toHaveTextContent('within the available balance')
  expect(screen.getByRole('button', { name: 'Enter amount' })).toBeDisabled()
  fireEvent.change(selling, { target: { value: '0.005' } })
  fireEvent.click(screen.getByRole('button', { name: 'Get demo quote' }))
  expect(screen.getByRole('textbox', { name: 'You will receive' })).toHaveValue('581.18')
  fireEvent.keyDown(selling, { key: 'Enter', ctrlKey: true })
  expect(screen.getByRole('button', { name: 'Demo swap confirmed' })).toBeDisabled()
  fireEvent.change(selling, { target: { value: '-1' } })
  expect(screen.getByRole('button', { name: 'Enter amount' })).toBeDisabled()
})

it('reverses the token pair and resets the old quote', () => {
  renderCrypto({ part: 'swap', step: 3 })
  fireEvent.click(screen.getByRole('button', { name: 'Reverse token pair' }))
  expect(screen.getByRole('textbox', { name: 'You are selling' })).toHaveValue('')
  const tokenButtons = screen.getAllByRole('button', { name: 'Select token' })
  expect(tokenButtons[0]).toHaveTextContent('USDC')
  expect(tokenButtons[1]).toHaveTextContent('BTC')
  expect(screen.getByRole('button', { name: 'Enter amount' })).toBeDisabled()
})

it('filters favorites and keeps the count synchronized after toggling or clearing', () => {
  renderCrypto({ part: 'favorites-dropdown' })
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Ethereum' } })
  expect(screen.queryByRole('button', { name: 'Bitcoin' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove Ethereum from favorites' }))
  expect(screen.getByText('My favorites (3)')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(screen.getByText('My favorites (0)')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add Ethereum to favorites' })).toHaveAttribute('aria-pressed', 'false')
})

it('represents mixed, all and empty multi-select states without stale checkbox values', () => {
  renderCrypto({ part: 'filter-type' })
  const all = screen.getByRole('checkbox', { name: 'Select all' })
  expect(all).toHaveAttribute('data-state', 'indeterminate')
  fireEvent.click(all)
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toHaveAttribute('data-state', 'checked')
  fireEvent.click(all)
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toHaveAttribute('data-state', 'unchecked')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Swap' }))
  expect(all).toHaveAttribute('data-state', 'indeterminate')
})

it('connects a demo provider without requesting an external wallet', () => {
  renderCrypto({ part: 'connect-wallet' })
  fireEvent.click(screen.getByRole('button', { name: 'Connect MetaMask' }))
  expect(screen.getByText('Wallet connected')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Connected to MetaMask' })).toBeInTheDocument()
})

it('keeps exactly one selected navigation item after changing sections', () => {
  renderCrypto({ part: 'navigation' })
  fireEvent.click(screen.getByRole('button', { name: 'Markets' }))
  expect(screen.getByRole('button', { name: 'Markets' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'false')
})

it('scopes the theme switch to its menu and disconnects only the demo wallet', () => {
  const menu = renderCrypto({ part: 'menu-dropdown' })
  fireEvent.click(screen.getByRole('switch'))
  expect(menu.container.querySelector('[data-slot="crypto-menu-theme"]')).toHaveClass('dark')
  expect(document.documentElement).not.toHaveClass('dark')
  menu.unmount()
  renderCrypto({ part: 'wallet-dropdown' })
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect wallet' }))
  expect(screen.getByText('Disconnected')).toBeInTheDocument()
  for (const name of ['Swap', 'Buy', 'Send']) expect(screen.getByRole('button', { name })).toBeDisabled()
})

it('keeps the disabled swap source variant inert', () => {
  const { container } = renderCrypto({ part: 'swap-input', kind: 'selling', state: 'disabled' })
  expect(screen.getByRole('textbox')).toBeDisabled()
  expect(within(container).getByRole('button', { name: 'Select token' })).toBeDisabled()
})
