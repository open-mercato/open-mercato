"use client"
import * as React from 'react'
import type { AdvancedFilterState, FilterCondition, FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'
import { createEmptyCondition, getDefaultOperator, normalizeAdvancedFilterState } from '@open-mercato/shared/lib/query/advanced-filter'

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
