jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { ActiveFilterChips } from '../ActiveFilterChips'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import type { FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'

const fields: FilterFieldDef[] = [
  { key: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active', tone: 'success' }] },
  { key: 'owner', label: 'Owner', type: 'text' },
  { key: 'tags', label: 'Tags', type: 'tags', options: [{ value: 't1', label: 'Hot' }, { value: 't2', label: 'Cold' }] },
]

function tree(...children: any[]): AdvancedFilterTree {
  return { root: { id: 'r', type: 'group', combinator: 'and', children } }
}

describe('ActiveFilterChips', () => {
  it('renders nothing when root has no children', () => {
    const { container } = render(<ActiveFilterChips tree={tree()} fields={fields} popoverOpen={false} onRemoveNode={() => {}} onOpen={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides chips when popover is open', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'status', operator: 'is', value: 'active' })
    const { container } = render(<ActiveFilterChips tree={t} fields={fields} popoverOpen={true} onRemoveNode={() => {}} onOpen={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one chip per top-level rule with field label and value', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'status', operator: 'is', value: 'active' })
    render(<ActiveFilterChips tree={t} fields={fields} popoverOpen={false} onRemoveNode={() => {}} onOpen={() => {}} />)
    expect(screen.getByText(/Status/)).toBeInTheDocument()
    expect(screen.getByText(/Active/)).toBeInTheDocument()
  })

  it('renders multi-value rule with first value + N badge', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'tags', operator: 'has_any_of', value: ['t1', 't2'] })
    render(<ActiveFilterChips tree={t} fields={fields} popoverOpen={false} onRemoveNode={() => {}} onOpen={() => {}} />)
    expect(screen.getByText(/Hot/)).toBeInTheDocument()
    expect(screen.getByText(/\+1/)).toBeInTheDocument()
  })

  it('collapses sub-group into one chip with first rule + remaining count', () => {
    const t = tree({
      id: 'g1',
      type: 'group',
      combinator: 'or',
      children: [
        { id: 'r1', type: 'rule', field: 'status', operator: 'is', value: 'active' },
        { id: 'r2', type: 'rule', field: 'status', operator: 'is', value: 'lead' },
        { id: 'r3', type: 'rule', field: 'status', operator: 'is', value: 'won' },
      ],
    })
    render(<ActiveFilterChips tree={t} fields={fields} popoverOpen={false} onRemoveNode={() => {}} onOpen={() => {}} />)
    expect(screen.getByText(/\+2/)).toBeInTheDocument()
  })

  it('calls onRemoveNode with the rule id when × is clicked', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'status', operator: 'is', value: 'active' })
    const onRemoveNode = jest.fn()
    render(<ActiveFilterChips tree={t} fields={fields} popoverOpen={false} onRemoveNode={onRemoveNode} onOpen={() => {}} />)
    fireEvent.click(screen.getByLabelText(/remove/i))
    expect(onRemoveNode).toHaveBeenCalledWith('a')
  })

  it('truncates long values at 24 chars', () => {
    const longLabel = 'A'.repeat(40)
    const t = tree({ id: 'a', type: 'rule', field: 'owner', operator: 'is', value: longLabel })
    render(<ActiveFilterChips tree={t} fields={fields} popoverOpen={false} onRemoveNode={() => {}} onOpen={() => {}} />)
    expect(screen.getByText(/A{1,24}…/)).toBeInTheDocument()
  })
})
