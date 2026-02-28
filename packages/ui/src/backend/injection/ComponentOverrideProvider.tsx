'use client'

import * as React from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { registerComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'
import { apiCall } from '../utils/apiCall'

type FeatureCheckResponse = { granted: string[] }

const OverrideUserFeaturesContext = React.createContext<readonly string[]>([])

export function useOverrideUserFeatures(): readonly string[] {
  return React.useContext(OverrideUserFeaturesContext)
}

export function ComponentOverrideProvider({
  overrides,
  children,
}: {
  overrides: ComponentOverride[]
  children: React.ReactNode
}) {
  const [userFeatures, setUserFeatures] = React.useState<readonly string[]>([])

  React.useEffect(() => {
    registerComponentOverrides(overrides)
    return () => {
      registerComponentOverrides([])
    }
  }, [overrides])

  React.useEffect(() => {
    const requiredFeatures = new Set<string>()
    for (const override of overrides) {
      for (const feature of override.features ?? []) {
        if (feature && feature.trim().length > 0) requiredFeatures.add(feature)
      }
    }
    if (requiredFeatures.size === 0) return
    let cancelled = false
    const fetchFeatures = async () => {
      const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: Array.from(requiredFeatures) }),
      })
      if (cancelled) return
      if (call.ok && call.result?.granted) {
        setUserFeatures(call.result.granted)
      }
    }
    void fetchFeatures()
    return () => {
      cancelled = true
    }
  }, [overrides])

  return (
    <OverrideUserFeaturesContext.Provider value={userFeatures}>
      {children}
    </OverrideUserFeaturesContext.Provider>
  )
}

export default ComponentOverrideProvider
