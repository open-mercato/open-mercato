"use client"
import * as React from 'react'
import type { AdvancedFilterState, FilterCondition, FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'
import { createEmptyCondition, getDefaultOperator, normalizeAdvancedFilterState } from '@open-mercato/shared/lib/query/advanced-filter'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { treeReducer, type TreeAction } from '../filters/treeReducer'
import { validateTreeForApply, type ValidationError } from '../filters/filterValidation'

export type UseAdvancedFilterOptions = {
  fields: FilterFieldDef[]
  onChange?: (state: AdvancedFilterState) => void
}

export function useAdvancedFilter({ fields, onChange }: UseAdvancedFilterOptions) {
  const [state, setState] = React.useState<AdvancedFilterState>({
    logic: 'and',
    conditions: [],
  })

  const updateState = React.useCallback((next: AdvancedFilterState) => {
    const normalized = normalizeAdvancedFilterState(next)
    setState(normalized)
    onChange?.(normalized)
  }, [onChange])

  const addCondition = React.useCallback(() => {
    const newCondition = createEmptyCondition()
    if (fields.length > 0) {
      newCondition.field = fields[0].key
      newCondition.operator = getDefaultOperator(fields[0].type)
    }
    updateState({
      ...state,
      conditions: [...state.conditions, newCondition],
    })
  }, [fields, state, updateState])

  const removeCondition = React.useCallback((conditionId: string) => {
    updateState({
      ...state,
      conditions: state.conditions.filter((c) => c.id !== conditionId),
    })
  }, [state, updateState])

  const updateCondition = React.useCallback((conditionId: string, updates: Partial<FilterCondition>) => {
    updateState({
      ...state,
      conditions: state.conditions.map((c) =>
        c.id === conditionId ? { ...c, ...updates } : c,
      ),
    })
  }, [state, updateState])

  const toggleLogic = React.useCallback(() => {
    const nextLogic = state.logic === 'and' ? 'or' : 'and'
    updateState({
      logic: nextLogic,
      conditions: state.conditions.map((condition, index) => (
        index === 0 ? condition : { ...condition, join: nextLogic }
      )),
    })
  }, [state, updateState])

  const clearAll = React.useCallback(() => {
    updateState({ logic: 'and', conditions: [] })
  }, [updateState])

  const hasActiveConditions = state.conditions.some((c) => c.field && c.operator)

  return {
    state,
    setState: updateState,
    addCondition,
    removeCondition,
    updateCondition,
    toggleLogic,
    clearAll,
    hasActiveConditions,
  }
}

export type UseAdvancedFilterTreeArgs = {
  initial: AdvancedFilterTree
  fields: FilterFieldDef[]
  onApply: (tree: AdvancedFilterTree) => void
  debounceMs?: number
}

export type UseAdvancedFilterTreeResult = {
  tree: AdvancedFilterTree
  setTree: (t: AdvancedFilterTree) => void
  dispatch: (a: TreeAction) => void
  pendingErrors: ValidationError[]
  flush: () => void
  clear: () => void
  hasActiveRules: boolean
}

/**
 * Tree-shaped advanced filter state with debounced auto-apply, validation gating,
 * and helpers for the CRM filter builder UI.
 *
 * - Debounced `onApply(tree)` (default 400 ms) — fires only when the tree validates.
 * - `pendingErrors` exposes the latest validation errors for inline UI rendering.
 * - `flush()` applies immediately if valid; `clear()` empties root children.
 * - `hasActiveRules` mirrors `tree.root.children.length > 0`.
 */
export function useAdvancedFilterTree({
  initial,
  fields,
  onApply,
  debounceMs = 400,
}: UseAdvancedFilterTreeArgs): UseAdvancedFilterTreeResult {
  const [tree, setTree] = React.useState<AdvancedFilterTree>(initial)
  const [pendingErrors, setPendingErrors] = React.useState<ValidationError[]>([])
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const didMountRef = React.useRef(false)
  const onApplyRef = React.useRef(onApply)
  const fieldsRef = React.useRef(fields)
  React.useEffect(() => { onApplyRef.current = onApply }, [onApply])
  React.useEffect(() => { fieldsRef.current = fields }, [fields])

  const tryApply = React.useCallback((candidate: AdvancedFilterTree): boolean => {
    const result = validateTreeForApply(candidate, fieldsRef.current)
    if (result.ok) {
      setPendingErrors([])
      onApplyRef.current(candidate)
      return true
    }
    setPendingErrors(result.errors)
    return false
  }, [])

  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    const timer = setTimeout(() => { tryApply(tree) }, debounceMs)
    timerRef.current = timer
    return () => clearTimeout(timer)
  }, [tree, debounceMs, tryApply])

  const dispatch = React.useCallback((action: TreeAction) => {
    setTree((prev) => treeReducer(prev, action))
  }, [])

  const flush = React.useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    tryApply(tree)
  }, [tree, tryApply])

  const clear = React.useCallback(() => {
    setTree((prev) => ({ root: { ...prev.root, children: [] } }))
  }, [])

  const hasActiveRules = tree.root.children.length > 0

  return { tree, setTree, dispatch, pendingErrors, flush, clear, hasActiveRules }
}
