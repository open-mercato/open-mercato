jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { AdvancedFilterBuilder } from '../AdvancedFilterBuilder'
import { createEmptyTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'

const fields = [
  { key: 'name', label: 'Name', type: 'text' as const, group: 'CRM' },
  {
    key: 'status',
    label: 'Status',
    type: 'select' as const,
    group: 'CRM',
    options: [{ value: 'a', label: 'Active', tone: 'success' as const }],
  },
]

describe('AdvancedFilterBuilder — rewrite', () => {
  it('renders nothing inside the body when tree has no rules', () => {
    const tree = createEmptyTree()
    render(
      <AdvancedFilterBuilder
        fields={fields}
        value={tree}
        onChange={() => {}}
        onApply={() => {}}
        onClear={() => {}}
      />,
    )
    // Empty tree → no group toolbar, no row labels, no connector words.
    expect(screen.queryByTestId('advanced-filter-combinator-toggle')).not.toBeInTheDocument()
    expect(screen.queryByText(/^where:?$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^and$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^or$/i)).not.toBeInTheDocument()
  })

  it('renders the Kendo-style And/Or toggle once the root group has rules — no Where prefix, no row connector words', () => {
    const tree = {
      root: {
        id: 'r',
        type: 'group' as const,
        combinator: 'and' as const,
        children: [
          {
            id: 'a',
            type: 'rule' as const,
            field: 'name',
            operator: 'contains' as const,
            value: 'X',
          } as any,
          {
            id: 'b',
            type: 'rule' as const,
            field: 'name',
            operator: 'contains' as const,
            value: 'Y',
          } as any,
        ],
      },
    }
    render(
      <AdvancedFilterBuilder
        fields={fields}
        value={tree}
        onChange={() => {}}
        onApply={() => {}}
        onClear={() => {}}
      />,
    )
    const toggle = screen.getByTestId('advanced-filter-combinator-toggle')
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute('data-combinator', 'and')
    // Toggle exposes both choices as buttons with aria-pressed reflecting selection.
    const andBtn = screen.getByRole('button', { name: /^And$/, pressed: true })
    const orBtn = screen.getByRole('button', { name: /^Or$/, pressed: false })
    expect(andBtn).toBeInTheDocument()
    expect(orBtn).toBeInTheDocument()
    // No "Where" prefix and no inline `and` / `or` row words anywhere.
    expect(screen.queryByText(/^where:?$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^and$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^or$/)).not.toBeInTheDocument()
  })

  it('clicking the unselected side of the toggle dispatches updateGroupCombinator', () => {
    const onChange = jest.fn()
    const tree = {
      root: {
        id: 'r',
        type: 'group' as const,
        combinator: 'and' as const,
        children: [
          {
            id: 'a',
            type: 'rule' as const,
            field: 'name',
            operator: 'contains' as const,
            value: 'X',
          } as any,
        ],
      },
    }
    render(
      <AdvancedFilterBuilder
        fields={fields}
        value={tree}
        onChange={onChange}
        onApply={() => {}}
        onClear={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^Or$/, pressed: false }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    expect(next.root.combinator).toBe('or')
  })

  it('renders a nested toolbar for a sub-group with combinator=or', () => {
    const tree = {
      root: {
        id: 'r',
        type: 'group' as const,
        combinator: 'and' as const,
        children: [
          {
            id: 'g',
            type: 'group' as const,
            combinator: 'or' as const,
            children: [
              {
                id: 'a',
                type: 'rule' as const,
                field: 'name',
                operator: 'contains' as const,
                value: 'X',
              } as any,
            ],
          } as any,
        ],
      },
    }
    render(
      <AdvancedFilterBuilder
        fields={fields}
        value={tree}
        onChange={() => {}}
        onApply={() => {}}
        onClear={() => {}}
      />,
    )
    const toggles = screen.getAllByTestId('advanced-filter-combinator-toggle')
    expect(toggles).toHaveLength(2)
    expect(toggles.map((el) => el.getAttribute('data-combinator')).sort()).toEqual(['and', 'or'])
  })

  it('Cmd+Enter calls onApply', () => {
    const onApply = jest.fn()
    const tree = createEmptyTree()
    render(
      <AdvancedFilterBuilder
        fields={fields}
        value={tree}
        onChange={() => {}}
        onApply={onApply}
        onClear={() => {}}
      />,
    )
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    expect(onApply).toHaveBeenCalled()
  })

  it('renders red ring + translated error message when pendingErrors include the rule', () => {
    const tree = {
      root: {
        id: 'r',
        type: 'group' as const,
        combinator: 'and' as const,
        children: [
          {
            id: 'a',
            type: 'rule' as const,
            field: 'name',
            operator: 'contains' as const,
            value: '',
          } as any,
        ],
      },
    }
    const errors = [
      {
        ruleId: 'a',
        messageKey: 'ui.advancedFilter.error.missingValue',
        message: 'Pick a value',
      },
    ]
    const { container } = render(
      <AdvancedFilterBuilder
        fields={fields}
        value={tree}
        onChange={() => {}}
        onApply={() => {}}
        onClear={() => {}}
        pendingErrors={errors}
      />,
    )
    expect(container.querySelector('.border-status-error-border')).not.toBeNull()
    expect(container.textContent).toContain('Pick a value')
  })
})
