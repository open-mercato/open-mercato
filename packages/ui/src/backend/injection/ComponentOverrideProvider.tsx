'use client'

import * as React from 'react'
import { createContext, useContext } from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { registerComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'
import { apiCall } from '../utils/apiCall'

type FeatureCheckResponse = { granted: string[] }

const OverrideUserFeaturesContext = createContext<readonly string[]>([])
const OverrideRegistryRevisionContext = createContext<readonly ComponentOverride[]>([])
type OverrideReadiness = 'pending' | 'ready' | 'failed'
const OverrideReadinessContext = createContext<OverrideReadiness>('ready')

export function useComponentOverridesReadiness(): OverrideReadiness {
  return useContext(OverrideReadinessContext)
}

export function useOverrideUserFeatures(): readonly string[] {
  return useContext(OverrideUserFeaturesContext)
}

export function useOverrideRegistryRevision(): readonly ComponentOverride[] {
  return useContext(OverrideRegistryRevisionContext)
}

export function ComponentOverrideProvider({
  overrides,
  registrationState = 'ready',
  children,
}: {
  overrides: ComponentOverride[]
  registrationState?: OverrideReadiness
  children: React.ReactNode
}) {
  const [userFeatures, setUserFeatures] = React.useState<readonly string[]>([])
  const [featureCheck, setFeatureCheck] = React.useState<{ overrides: ComponentOverride[]; state: OverrideReadiness } | null>(null)
  const requiredFeatures = React.useMemo(() => [...new Set(overrides.flatMap(({ features }) =>
    (features ?? []).filter((feature) => typeof feature === 'string' && feature.trim().length > 0)))], [overrides])
  const readiness = registrationState !== 'ready' || requiredFeatures.length === 0
    ? registrationState
    : featureCheck?.overrides === overrides ? featureCheck.state : 'pending'

  registerComponentOverrides(overrides)

  React.useEffect(() => {
    registerComponentOverrides(overrides)
    return () => {
      registerComponentOverrides([])
    }
  }, [overrides])

  React.useEffect(() => {
    if (requiredFeatures.length === 0) return
    let cancelled = false
    const fetchFeatures = async () => {
      let granted: string[] | undefined
      try {
        const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: requiredFeatures }),
        })
        if (call.ok) granted = call.result?.granted
      } catch {
        if (!cancelled) setFeatureCheck({ overrides, state: 'failed' })
        return
      }
      if (cancelled) return
      if (granted) setUserFeatures(granted)
      setFeatureCheck({ overrides, state: granted ? 'ready' : 'failed' })
    }
    void fetchFeatures()
    return () => {
      cancelled = true
    }
  }, [overrides, requiredFeatures])

  return (
    <OverrideRegistryRevisionContext.Provider value={overrides}>
      <OverrideUserFeaturesContext.Provider value={userFeatures}>
        <OverrideReadinessContext.Provider value={readiness}>
          {children}
        </OverrideReadinessContext.Provider>
      </OverrideUserFeaturesContext.Provider>
    </OverrideRegistryRevisionContext.Provider>
  )
}

export default ComponentOverrideProvider
