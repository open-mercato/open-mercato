'use client'

import * as React from 'react'
import type { ComponentType } from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import type { ClientBootstrapProfile } from '@/components/ClientBootstrap'
import { profileUsesComponentOverrides } from '@/components/ClientBootstrap'

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
  if (!profileUsesComponentOverrides(profile)) return <>{children}</>

  const { Provider, overrides } = React.use(loadOverrides())
  return <Provider overrides={overrides}>{children}</Provider>
}

export default ComponentOverridesBootstrap
