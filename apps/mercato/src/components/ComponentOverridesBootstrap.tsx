'use client'

import * as React from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ComponentOverrideProvider } from '@open-mercato/ui/backend/injection/ComponentOverrideProvider'
import type { ClientBootstrapProfile } from '@/components/ClientBootstrap'
import { profileUsesComponentOverrides } from '@/components/ClientBootstrap'

const logger = createLogger('app').child({ component: 'ComponentOverridesBootstrap' })

type LoadedOverrides = {
  overrides: ComponentOverride[]
}

let overridePromise: Promise<LoadedOverrides> | null = null

function loadOverrides(): Promise<LoadedOverrides> {
  if (overridePromise) return overridePromise
  const pending = import('@/.mercato/generated/component-overrides.generated').then((generated) => ({
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

  const overrides = enabled ? loaded?.overrides ?? [] : []
  return <ComponentOverrideProvider overrides={overrides}>{children}</ComponentOverrideProvider>
}

export default ComponentOverridesBootstrap
