'use client'

import * as React from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ComponentOverrideProvider } from '@open-mercato/ui/backend/injection/ComponentOverrideProvider'
import type { ClientBootstrapProfile } from '@/components/ClientBootstrap'
import { ensureModuleOverridesApplied, profileUsesComponentOverrides } from '@/components/ClientBootstrap'

const logger = createLogger('app').child({ component: 'ComponentOverridesBootstrap' })
const EMPTY_OVERRIDES: ComponentOverride[] = []

type LoadedOverrides = {
  overrides: ComponentOverride[]
}

let overridePromise: Promise<LoadedOverrides> | null = null

/**
 * The server registers these entries through `applyComponentOverridesToEntries`
 * (`@open-mercato/shared/lib/bootstrap/factory`). Registering the raw generated list
 * in the browser would overwrite that filtered registration, so a `widgets.components`
 * override declared in `src/modules.ts` holds while server-rendered and is undone on
 * hydration (#5864 — the #5152 defect, one key over). Awaiting the same dispatch the
 * override-dependent registry groups await fills the component override store before
 * the filter reads it; the dispatch is fail-soft, so a failure there degrades to the
 * unfiltered list rather than leaving the page with no overrides at all.
 */
function loadOverrides(): Promise<LoadedOverrides> {
  if (overridePromise) return overridePromise
  const pending = (async () => {
    await ensureModuleOverridesApplied()
    const [generated, overrides] = await Promise.all([
      import('@/.mercato/generated/component-overrides.generated'),
      import('@open-mercato/shared/modules/overrides'),
    ])
    const finalEntries = overrides.applyComponentOverridesToEntries(generated.componentOverrideEntries)
    return { overrides: finalEntries.flatMap((entry) => entry.componentOverrides ?? []) }
  })()
  const retryable = pending.catch((err) => {
    if (overridePromise === retryable) overridePromise = null
    throw err
  })
  overridePromise = retryable
  return overridePromise
}

function InitialOverrides({ children }: { children: React.ReactNode }) {
  const loaded = React.use(loadOverrides())
  return <ComponentOverrideProvider overrides={loaded.overrides}>{children}</ComponentOverrideProvider>
}

function DeferredOverrides({
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

  const overrides = enabled ? loaded?.overrides ?? EMPTY_OVERRIDES : EMPTY_OVERRIDES
  return <ComponentOverrideProvider overrides={overrides}>{children}</ComponentOverrideProvider>
}

export function ComponentOverridesBootstrap({
  profile,
  children,
}: {
  profile: ClientBootstrapProfile
  children: React.ReactNode
}) {
  if (profile === 'login') {
    return <InitialOverrides>{children}</InitialOverrides>
  }
  return <DeferredOverrides profile={profile}>{children}</DeferredOverrides>
}

export default ComponentOverridesBootstrap
