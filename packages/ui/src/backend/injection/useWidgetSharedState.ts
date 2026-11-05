'use client'

import * as React from 'react'
import { getWidgetSharedState } from './WidgetSharedState'

export function useWidgetSharedState<T>(key: string, namespace = 'global'): [T | undefined, (value: T) => void] {
  const store = React.useMemo(() => getWidgetSharedState(namespace), [namespace])

  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      const unsubscribe = store.subscribe(key, () => onStoreChange())
      return unsubscribe
    },
    [key, store],
  )

  const getSnapshot = React.useCallback(() => store.get<T>(key), [key, store])
  const value = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const setValue = React.useCallback(
    (nextValue: T) => {
      store.set<T>(key, nextValue)
    },
    [key, store],
  )

  return [value, setValue]
}
