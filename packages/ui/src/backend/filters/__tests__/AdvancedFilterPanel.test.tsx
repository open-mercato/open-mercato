jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) => {
    if (!vars) return fallback
    return Object.entries(vars).reduce((s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)), fallback)
  },
}))

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AdvancedFilterPanel } from '../AdvancedFilterPanel'
import { createEmptyTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import type { FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'

const fields: FilterFieldDef[] = [{ key: 'name', label: 'Name', type: 'text', group: 'CRM' }]
const flashMock = jest.fn()

jest.mock('../../FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

describe('AdvancedFilterPanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
    flashMock.mockReset()
  })

  it('renders the empty state when tree has no rules and popover is open', () => {
    render(
      <AdvancedFilterPanel
        fields={fields}
        value={createEmptyTree()}
        onChange={() => {}}
        onApply={() => {}}
        onClear={() => {}}
        pendingErrors={[]}
        userId="u1"
        presets={[]}
        open
        onOpenChange={() => {}}
        triggerRef={{ current: null }}
      />,
    )
    expect(screen.getByText(/no filters applied/i)).toBeInTheDocument()
  })

  it('shows validation banner when pendingErrors is non-empty', () => {
    const tree = { root: { id: 'r', type: 'group' as const, combinator: 'and' as const, children: [
      { id: 'a', type: 'rule' as const, field: 'name', operator: 'contains' as const, value: '' } as any,
    ] } }
    render(
      <AdvancedFilterPanel
        fields={fields}
        value={tree}
        onChange={() => {}}
        onApply={() => {}}
        onClear={() => {}}
        pendingErrors={[{ ruleId: 'a', messageKey: 'ui.advancedFilter.error.missingValue', message: 'Pick a value' }]}
        userId="u1"
        presets={[]}
        open
        onOpenChange={() => {}}
        triggerRef={{ current: null }}
      />,
    )
    expect(screen.getByText(/1 filter is incomplete/i)).toBeInTheDocument()
  })

  it('renders quick filters in empty state when presets provided', () => {
    const presets = [{ id: 'p1', labelKey: 'p1', build: () => createEmptyTree() }]
    render(
      <AdvancedFilterPanel
        fields={fields}
        value={createEmptyTree()}
        onChange={() => {}}
        onApply={() => {}}
        onClear={() => {}}
        pendingErrors={[]}
        userId="u1"
        presets={presets}
        open
        onOpenChange={() => {}}
        triggerRef={{ current: null }}
      />,
    )
    expect(screen.getByText(/quick filters/i)).toBeInTheDocument()
  })

  it('does not render the empty state when tree has rules', () => {
    const tree = { root: { id: 'r', type: 'group' as const, combinator: 'and' as const, children: [
      { id: 'a', type: 'rule' as const, field: 'name', operator: 'contains' as const, value: 'X' } as any,
    ] } }
    render(
      <AdvancedFilterPanel
        fields={fields}
        value={tree}
        onChange={() => {}}
        onApply={() => {}}
        onClear={() => {}}
        pendingErrors={[]}
        userId="u1"
        presets={[]}
        open
        onOpenChange={() => {}}
        triggerRef={{ current: null }}
      />,
    )
    expect(screen.queryByText(/no filters applied/i)).not.toBeInTheDocument()
  })

  it('saves filters separately from perspectives', async () => {
    const tree = { root: { id: 'r', type: 'group' as const, combinator: 'and' as const, children: [
      { id: 'a', type: 'rule' as const, field: 'name', operator: 'contains' as const, value: 'Alice' } as any,
    ] } }
    const originalFetch = globalThis.fetch
    const fetchMock = jest.fn()
    ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

    try {
      render(
        <AdvancedFilterPanel
          fields={fields}
          value={tree}
          onChange={() => {}}
          onApply={() => {}}
          onClear={() => {}}
          pendingErrors={[]}
          userId="u1"
          presets={[]}
          open
          onOpenChange={() => {}}
          triggerRef={{ current: null }}
          savedFilterStorageKey="customers.people.list"
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Save filter' }))
      fireEvent.change(screen.getByLabelText('Filter name'), { target: { value: 'Owned leads' } })
      const dialog = screen.getByRole('dialog', { name: 'Save filter' })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save filter' }))

      await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Filter saved', 'success'))
      expect(fetchMock).not.toHaveBeenCalled()
      const raw = window.localStorage.getItem('open-mercato:advanced-filters:customers.people.list')
      expect(raw).toBeTruthy()
      const saved = JSON.parse(String(raw))
      expect(saved).toEqual({
        v: 1,
        filters: [
          expect.objectContaining({
            name: 'Owned leads',
            tree: expect.objectContaining({ v: 2 }),
          }),
        ],
      })
    } finally {
      if (originalFetch) {
        globalThis.fetch = originalFetch
      } else {
        delete (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch
      }
    }
  })

  it('applies a saved filter from the filter panel', async () => {
    window.localStorage.setItem('open-mercato:advanced-filters:customers.people.list', JSON.stringify([
      {
        id: 'saved-1',
        name: 'Owned leads',
        tree: {
          v: 2,
          root: {
            id: 'saved-root',
            type: 'group',
            combinator: 'and',
            children: [
              { id: 'saved-rule', type: 'rule', field: 'name', operator: 'contains', value: 'Alice' },
            ],
          },
        },
        createdAt: '2026-05-10T00:00:00.000Z',
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
    ]))
    const onChange = jest.fn()
    const onOpenChange = jest.fn()

    render(
      <AdvancedFilterPanel
        fields={fields}
        value={createEmptyTree()}
        onChange={onChange}
        onApply={() => {}}
        onClear={() => {}}
        pendingErrors={[]}
        userId="u1"
        presets={[]}
        open
        onOpenChange={onOpenChange}
        triggerRef={{ current: null }}
        savedFilterStorageKey="customers.people.list"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Owned leads' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      root: expect.objectContaining({
        children: [expect.objectContaining({ field: 'name', value: 'Alice' })],
      }),
    }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
