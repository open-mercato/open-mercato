'use client'

import * as React from 'react'
import type { ComponentType } from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ClientBootstrapProfile } from '@/components/ClientBootstrap'
import { profileUsesComponentOverrides } from '@/components/ClientBootstrap'

const logger = createLogger('app').child({ component: 'ComponentOverridesBootstrap' })

type OverrideProvider = ComponentType<{
  overrides: ComponentOverride[]
  children: React.ReactNode
}>

type LoadedOverrides = {
  Provider: OverrideProvider
  overrides: ComponentOverride[]
}

let overridePromise: Promise<LoadedOverrides> | null = null

function loadOverrides(): Promise<LoadedOverrides> {
  if (overridePromise) return overridePromise
  const pending = Promise.all([
    import('@/.mercato/generated/component-overrides.generated'),
    import('@open-mercato/ui/backend/injection/ComponentOverrideProvider'),
  ]).then(([generated, provider]) => ({
    Provider: provider.ComponentOverrideProvider,
    overrides: generated.componentOverrideEntries.flatMap((entry) => entry.componentOverrides ?? []),
  }))
  const retryable = pending.catch((err) => {
    if (overridePromise === retryable) overridePromise = null
    throw err
  })
  overridePromise = retryable
  return overridePromise
}

export function ComponentOverridesBootstrap({
  profile,
  children,
}: {
  profile: ClientBootstrapProfile
  children: React.ReactNode
}) {
  const enabled = profileUsesComponentOverrides(profile)
  const [loaded, setLoaded] = React.useState<LoadedOverrides | null>(null)
  // Start fetching during the first browser render so the override contract is
  // ready as early as possible, while keeping hydration itself unsuspended.
  const pending = enabled && typeof window !== 'undefined' ? loadOverrides() : null

  React.useEffect(() => {
    if (!enabled) {
      setLoaded(null)
      return
    }
    let active = true
    void (pending ?? loadOverrides()).then((result) => {
      if (active) setLoaded(result)
    }).catch((err) => {
      logger.error('Failed to load component overrides', { err })
    })
    return () => {
      active = false
    }
  }, [enabled, pending])

  if (!enabled || !loaded) return <>{children}</>

  const { Provider, overrides } = loaded
  return <Provider overrides={overrides}>{children}</Provider>
}

export default ComponentOverridesBootstrap
