jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { FilterEmptyState } from '../FilterEmptyState'

describe('FilterEmptyState', () => {
  it('renders title, subtitle, and primary "Add condition" button', () => {
    render(<FilterEmptyState onAddCondition={() => {}} addConditionRef={{ current: null }} />)
    expect(screen.getByText(/no filters applied/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add condition/i })).toBeInTheDocument()
  })

  it('calls onAddCondition on click', () => {
    const onAdd = jest.fn()
    render(<FilterEmptyState onAddCondition={onAdd} addConditionRef={{ current: null }} />)
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('renders quickFilters slot when provided', () => {
    render(<FilterEmptyState onAddCondition={() => {}} addConditionRef={{ current: null }} quickFilters={<div data-testid="qf">qf</div>} />)
    expect(screen.getByTestId('qf')).toBeInTheDocument()
  })

  it('renders aiSlot when provided', () => {
    render(<FilterEmptyState onAddCondition={() => {}} addConditionRef={{ current: null }} aiSlot={<div data-testid="ai">try</div>} />)
    expect(screen.getByTestId('ai')).toBeInTheDocument()
  })
})
