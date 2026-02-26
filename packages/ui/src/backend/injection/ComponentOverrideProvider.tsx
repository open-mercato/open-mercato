'use client'

import * as React from 'react'
import type { ComponentOverrideRegistryEntry } from '@open-mercato/shared/modules/widgets/component-registry'
import { getOverridesForComponent } from '@open-mercato/shared/modules/widgets/component-registry'

type ComponentOverrideContextValue = {
  getOverrides: (componentId: string) => ComponentOverrideRegistryEntry[]
  userFeatures: Set<string>
}

const ComponentOverrideContext = React.createContext<ComponentOverrideContextValue | null>(null)

/**
 * Context provider at app root that makes component override lookup available.
 * Wraps children and provides override context.
 * Transparent when no overrides exist.
 */
export function ComponentOverrideProvider({
  children,
  userFeatures = [],
}: {
  children: React.ReactNode
  userFeatures?: string[]
}) {
  const featureSet = React.useMemo(() => new Set(userFeatures), [userFeatures])

  const value = React.useMemo<ComponentOverrideContextValue>(
    () => ({
      getOverrides: getOverridesForComponent,
      userFeatures: featureSet,
    }),
    [featureSet],
  )

  return (
    <ComponentOverrideContext.Provider value={value}>
      {children}
    </ComponentOverrideContext.Provider>
  )
}

/**
 * Access the component override context.
 * Returns null when used outside ComponentOverrideProvider — callers
 * should fall back to the original component in that case.
 */
export function useComponentOverrideContext(): ComponentOverrideContextValue | null {
  return React.useContext(ComponentOverrideContext)
}
