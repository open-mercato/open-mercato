import { renderHook, act } from '@testing-library/react'
import { useAdvancedFilterTree } from '../useAdvancedFilter'
import { createEmptyTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'

jest.useFakeTimers()

describe('useAdvancedFilterTree — auto-apply', () => {
  it('debounces onApply by 400 ms when valid; suppresses when invalid', () => {
    const onApply = jest.fn()
    const { result } = renderHook(() => useAdvancedFilterTree({ initial: createEmptyTree(), fields: [], onApply }))
    act(() => { result.current.dispatch({ type: 'addRule', groupId: result.current.tree.root.id }) })
    expect(onApply).not.toHaveBeenCalled()
    act(() => { jest.advanceTimersByTime(400) })
    // tree has invalid rule (empty value) - should NOT apply
    expect(onApply).not.toHaveBeenCalled()
    expect(result.current.pendingErrors.length).toBeGreaterThan(0)
  })

  it('flush() applies immediately if valid', () => {
    const onApply = jest.fn()
    const fields = [{ key: 'n', label: 'Name', type: 'text' as const }]
    const { result } = renderHook(() => useAdvancedFilterTree({ initial: createEmptyTree(), fields, onApply }))
    act(() => {
      result.current.dispatch({ type: 'addRule', groupId: result.current.tree.root.id, defaultField: 'n' })
    })
    const ruleId = result.current.tree.root.children[0].id
    act(() => {
      // Substring text operators now require >= 3 characters to validate.
      result.current.dispatch({ type: 'updateRule', ruleId, updates: { value: 'XYZ' } })
    })
    act(() => { result.current.flush() })
    expect(onApply).toHaveBeenCalled()
  })

  it('flush() suppresses apply on invalid tree', () => {
    const onApply = jest.fn()
    const fields = [{ key: 'n', label: 'Name', type: 'text' as const }]
    const { result } = renderHook(() => useAdvancedFilterTree({ initial: createEmptyTree(), fields, onApply }))
    act(() => { result.current.dispatch({ type: 'addRule', groupId: result.current.tree.root.id, defaultField: 'n' }) })
    act(() => { result.current.flush() })
    expect(onApply).not.toHaveBeenCalled()
    expect(result.current.pendingErrors.length).toBe(1)
  })

  it('hasActiveRules reflects tree.root.children.length', () => {
    const { result } = renderHook(() => useAdvancedFilterTree({ initial: createEmptyTree(), fields: [], onApply: () => {} }))
    expect(result.current.hasActiveRules).toBe(false)
    act(() => { result.current.dispatch({ type: 'addRule', groupId: result.current.tree.root.id }) })
    expect(result.current.hasActiveRules).toBe(true)
  })

  it('clear() empties root children', () => {
    const { result } = renderHook(() => useAdvancedFilterTree({ initial: createEmptyTree(), fields: [], onApply: () => {} }))
    act(() => { result.current.dispatch({ type: 'addRule', groupId: result.current.tree.root.id }) })
    expect(result.current.tree.root.children.length).toBe(1)
    act(() => { result.current.clear() })
    expect(result.current.tree.root.children.length).toBe(0)
  })

  it('setTree replaces tree', () => {
    const onApply = jest.fn()
    const { result } = renderHook(() => useAdvancedFilterTree({ initial: createEmptyTree(), fields: [], onApply }))
    const newTree = { root: { id: 'r2', type: 'group' as const, combinator: 'or' as const, children: [] } }
    act(() => { result.current.setTree(newTree) })
    expect(result.current.tree.root.id).toBe('r2')
  })

  it('does NOT auto-apply on mount when initial is non-empty and valid', () => {
    const onApply = jest.fn()
    const fields = [{ key: 'n', label: 'Name', type: 'text' as const }]
    const initial = {
      root: {
        id: 'r',
        type: 'group' as const,
        combinator: 'and' as const,
        // Substring text operators now require >= 3 characters; use 'XYZ' so the
        // initial tree is valid.
        children: [{ id: 'a', type: 'rule' as const, field: 'n', operator: 'contains' as const, value: 'XYZ' } as any],
      },
    }
    renderHook(() => useAdvancedFilterTree({ initial, fields, onApply }))
    act(() => { jest.advanceTimersByTime(500) })
    expect(onApply).not.toHaveBeenCalled()
  })

  it('does auto-apply after a dispatch from a non-empty initial', () => {
    const onApply = jest.fn()
    const fields = [{ key: 'n', label: 'Name', type: 'text' as const }]
    const initial = {
      root: {
        id: 'r',
        type: 'group' as const,
        combinator: 'and' as const,
        children: [{ id: 'a', type: 'rule' as const, field: 'n', operator: 'contains' as const, value: 'XYZ' } as any],
      },
    }
    const { result } = renderHook(() => useAdvancedFilterTree({ initial, fields, onApply }))
    act(() => { result.current.dispatch({ type: 'updateRule', ruleId: 'a', updates: { value: 'WXY' } }) })
    act(() => { jest.advanceTimersByTime(400) })
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('auto-applies non-blank short substring text rules', () => {
    const onApply = jest.fn()
    const fields = [{ key: 'n', label: 'Name', type: 'text' as const }]
    const { result } = renderHook(() => useAdvancedFilterTree({ initial: createEmptyTree(), fields, onApply }))
    act(() => { result.current.dispatch({ type: 'addRule', groupId: result.current.tree.root.id, defaultField: 'n' }) })
    const ruleId = result.current.tree.root.children[0].id
    act(() => { result.current.dispatch({ type: 'updateRule', ruleId, updates: { value: 'a' } }) })
    act(() => { jest.advanceTimersByTime(400) })
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(result.current.pendingErrors).toEqual([])
  })
})
