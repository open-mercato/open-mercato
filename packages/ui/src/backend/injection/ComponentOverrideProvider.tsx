'use client'

import * as React from 'react'
import { createContext, useContext } from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { registerComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'
import { getCurrentOrganizationScopeVersion, subscribeOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { apiCall } from '../utils/apiCall'

type FeatureCheckResponse = { granted: string[] }

function isGrantList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((feature: unknown) => typeof feature === 'string')
}

const EMPTY_GRANTS: readonly string[] = []
const serverEpoch = () => 0
const OverrideUserFeaturesContext = createContext<readonly string[]>(EMPTY_GRANTS)
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
  const epoch = React.useSyncExternalStore(subscribeOrganizationScopeChanged, getCurrentOrganizationScopeVersion, serverEpoch)
  const [featureCheck, setFeatureCheck] = React.useState<{
    overrides: ComponentOverride[]; epoch: number; state: 'ready' | 'failed'; grants?: readonly string[]
  } | null>(null)
  const requiredFeatures = React.useMemo(() => [...new Set(overrides.flatMap(({ features }) =>
    (features ?? []).filter((feature) => typeof feature === 'string' && feature.trim().length > 0)))], [overrides])
  const current = featureCheck?.overrides === overrides && featureCheck.epoch === epoch ? featureCheck : null
  const readiness = registrationState !== 'ready' || requiredFeatures.length === 0
    ? registrationState : current?.state ?? 'pending'
  const userFeatures = readiness === 'ready' && requiredFeatures.length ? current?.grants ?? EMPTY_GRANTS : EMPTY_GRANTS

  registerComponentOverrides(overrides)

  React.useEffect(() => {
    registerComponentOverrides(overrides)
    return () => {
      registerComponentOverrides([])
    }
  }, [overrides])

  React.useEffect(() => {
    if (registrationState !== 'ready' || requiredFeatures.length === 0) return
    const controller = new AbortController()
    const active = () => !controller.signal.aborted && getCurrentOrganizationScopeVersion() === epoch
    const fetchFeatures = async () => {
      await Promise.resolve()
      if (!active()) return
      try {
        const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: requiredFeatures }),
          signal: controller.signal,
        })
        if (!active()) return
        const granted: unknown = call.result?.granted
        if (call.ok && isGrantList(granted)) {
          setFeatureCheck({ overrides, epoch, state: 'ready', grants: [...new Set(granted)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0) })
          return
        }
      } catch {
        if (!active()) return
      }
      setFeatureCheck({ overrides, epoch, state: 'failed' })
    }
    void fetchFeatures()
    return () => controller.abort()
  }, [overrides, epoch, requiredFeatures, registrationState])

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
