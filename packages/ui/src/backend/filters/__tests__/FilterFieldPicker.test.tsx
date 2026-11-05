// packages/ui/src/backend/filters/__tests__/FilterFieldPicker.test.tsx
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { FilterFieldPicker } from '../FilterFieldPicker'
import type { FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'

const fields: FilterFieldDef[] = [
  { key: 'owner', label: 'Owner', type: 'text', group: 'CRM', iconName: 'user-round' },
  { key: 'status', label: 'Status', type: 'select', group: 'CRM' },
  { key: 'created_at', label: 'Created date', type: 'date', group: 'Activity' },
  { key: 'email', label: 'Email', type: 'text', group: 'Contact', iconName: 'mail' },
]

describe('FilterFieldPicker', () => {
  it('renders fields grouped by group label', () => {
    render(<FilterFieldPicker fields={fields} open onSelect={() => {}} onOpenChange={() => {}} triggerRef={{ current: null }} />)
    expect(screen.getByText('CRM')).toBeInTheDocument()
    expect(screen.getByText('Activity')).toBeInTheDocument()
    expect(screen.getByText('Contact')).toBeInTheDocument()
  })

  it('filters by search input substring (case-insensitive)', () => {
    render(<FilterFieldPicker fields={fields} open onSelect={() => {}} onOpenChange={() => {}} triggerRef={{ current: null }} />)
    fireEvent.change(screen.getByPlaceholderText(/search field/i), { target: { value: 'em' } })
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.queryByText('Owner')).not.toBeInTheDocument()
  })

  it('selects a field on Enter via keyboard', () => {
    const onSelect = jest.fn()
    render(<FilterFieldPicker fields={fields} open onSelect={onSelect} onOpenChange={() => {}} triggerRef={{ current: null }} />)
    fireEvent.change(screen.getByPlaceholderText(/search field/i), { target: { value: 'owner' } })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'owner' }))
  })

  it('selects a field on click', () => {
    const onSelect = jest.fn()
    render(<FilterFieldPicker fields={fields} open onSelect={onSelect} onOpenChange={() => {}} triggerRef={{ current: null }} />)
    fireEvent.click(screen.getByText('Status'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'status' }))
  })

  it('closes on Escape', () => {
    const onOpenChange = jest.fn()
    render(<FilterFieldPicker fields={fields} open onSelect={() => {}} onOpenChange={onOpenChange} triggerRef={{ current: null }} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders explicit iconName when provided', () => {
    render(<FilterFieldPicker fields={fields} open onSelect={() => {}} onOpenChange={() => {}} triggerRef={{ current: null }} />)
    // Email has iconName='mail'; row contains a Mail icon (lucide-react renders an svg with class)
    const emailRow = screen.getByText('Email').closest('button, li, [role="option"]')!
    expect(emailRow.querySelector('svg')).not.toBeNull()
  })
})
