"use client"
import * as React from 'react'
import {
  hasInjectionWidgetsForSpotPrefix,
  subscribeToInjectionRegistryChanges,
} from '@open-mercato/shared/modules/widgets/injection-loader'

function readServerSnapshot(): boolean {
  return false
}

/**
 * Reactive `hasInjectionWidgetsForSpotPrefix`: re-evaluates when the injection registry is
 * registered (or re-registered) after the first render, and answers `false` during server
 * rendering and hydration. Pass `null` to skip the lookup.
 */
export function useHasInjectionWidgetsForSpotPrefix(prefix: string | null | undefined): boolean {
  const readSnapshot = React.useCallback(
    () => (prefix ? hasInjectionWidgetsForSpotPrefix(prefix) : false),
    [prefix],
  )
  return React.useSyncExternalStore(subscribeToInjectionRegistryChanges, readSnapshot, readServerSnapshot)
}
