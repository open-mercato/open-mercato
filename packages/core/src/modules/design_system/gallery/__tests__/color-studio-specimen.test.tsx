/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import english from '../../i18n/en.json'
import { ColorStudioSpecimen } from '../components/ColorStudioSpecimen'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/backend/design-system',
}))

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

const tokens = {
  '--background': '#FFFFFF',
  '--foreground': '#171717',
  '--primary': '#2563EB',
  '--primary-foreground': '#FFFFFF',
  '--primary-hover': '#1D4ED8',
  '--accent': '#DBEAFE',
  '--accent-foreground': '#1E40AF',
  '--focus-ring-outer': '#2563EB',
}

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => { render(<QueryClientProvider client={client}><I18nProvider locale="en" dict={english}><ColorStudioSpecimen theme="light" tokens={tokens} /></I18nProvider></QueryClientProvider>) })
}

it('filters actual table rows and selects a project with its progress and semantic status', async () => {
  await setup()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search projects' }), { target: { value: 'Website' } })
  const table = screen.getByRole('table')
  expect(within(table).queryByText('Mobile application')).not.toBeInTheDocument()
  fireEvent.click(within(table).getByRole('button', { name: /Website refresh/ }))
  expect(screen.getByRole('heading', { name: 'Website refresh' })).toBeVisible()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '38')
  expect(within(table).getByText('Pending')).toHaveClass('text-status-warning-text')
})

it('adds only a local example and makes it visible even with an active search', async () => {
  await setup()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search projects' }), { target: { value: 'No match' } })
  expect(screen.getByText('No matching projects')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'New project', exact: true }))
  expect(screen.getByRole('textbox', { name: 'Search projects' })).toHaveValue('')
  expect(screen.getByRole('heading', { name: 'New project' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('Example project added')
  expect(screen.getByRole('button', { name: 'New project', exact: true })).toBeDisabled()
})

it('saves and cancels local settings, including the checkbox', async () => {
  await setup()
  fireEvent.click(screen.getByRole('radio', { name: 'Settings' }))
  const name = screen.getByRole('textbox', { name: 'Workspace name' })
  const notifications = screen.getByRole('checkbox', { name: 'Send review notifications' })
  fireEvent.change(name, { target: { value: 'My studio' } })
  fireEvent.click(notifications)
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(screen.getByText('My studio')).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('Changes saved in the preview')
  fireEvent.change(name, { target: { value: 'Unsaved' } })
  fireEvent.click(notifications)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(name).toHaveValue('My studio')
  expect(notifications).not.toBeChecked()
})

it('shows real hover and focus token values without mutating the host theme', async () => {
  const rootStyle = document.documentElement.getAttribute('style')
  await setup()
  expect(screen.getByRole('button', { name: 'Hover', exact: true })).toHaveStyle({ backgroundColor: '#1D4ED8', color: '#FFFFFF' })
  expect(screen.getByRole('button', { name: 'Focus', exact: true }).style.boxShadow).toContain('#2563EB')
  expect(screen.getByRole('button', { name: 'Disabled', exact: true })).toBeDisabled()
  expect(document.documentElement.getAttribute('style')).toBe(rootStyle)
})
