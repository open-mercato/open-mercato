/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import {
  invalidateInjectionWidgetCache,
  registerCoreInjectionTables,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { useHasInjectionWidgetsForSpotPrefix } from '../useHasInjectionWidgetsForSpotPrefix'

const PREFIX = 'crud-form:customers.deal:field:'

describe('useHasInjectionWidgetsForSpotPrefix', () => {
  beforeEach(() => {
    invalidateInjectionWidgetCache()
    registerCoreInjectionTables([])
  })

  it('answers false without a prefix even when field widgets are registered', () => {
    registerCoreInjectionTables([{ moduleId: 'insights', table: { 'crud-form:customers.deal:field:*:after': 'insights.injection.field-why' } }])
    const { result } = renderHook(() => useHasInjectionWidgetsForSpotPrefix(null))
    expect(result.current).toBe(false)
  })

  it('follows registry registrations made after mount', () => {
    const { result } = renderHook(() => useHasInjectionWidgetsForSpotPrefix(PREFIX))
    expect(result.current).toBe(false)

    act(() => {
      registerCoreInjectionTables([{ moduleId: 'insights', table: { 'crud-form:customers.deal:field:*:after': 'insights.injection.field-why' } }])
    })
    expect(result.current).toBe(true)

    act(() => {
      registerCoreInjectionTables([{ moduleId: 'record_locks', table: { 'crud-form:*': 'record_locks.injection.crud-form-locking' } }])
    })
    expect(result.current).toBe(false)
  })

  it('re-evaluates when the prefix changes', () => {
    registerCoreInjectionTables([{ moduleId: 'insights', table: { 'crud-form:customers.deal:field:*:after': 'insights.injection.field-why' } }])
    const { result, rerender } = renderHook(({ prefix }) => useHasInjectionWidgetsForSpotPrefix(prefix), {
      initialProps: { prefix: 'crud-form:customers.person:field:' as string | null },
    })
    expect(result.current).toBe(false)
    rerender({ prefix: PREFIX })
    expect(result.current).toBe(true)
  })
})
