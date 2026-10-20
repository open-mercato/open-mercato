import * as React from 'react'
import { getCurrentOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { fetchExplainDescriptors } from './explainApi'
import type { ExplainResourceDescriptorView } from './types'

type DescriptorCacheEntry = {
  scopeVersion: number
  promise: Promise<ExplainResourceDescriptorView[]>
  resources: ExplainResourceDescriptorView[] | null
}

let descriptorCache: DescriptorCacheEntry | null = null

export type ExplainDescriptorsStatus = 'loading' | 'ready' | 'error'

export type ExplainDescriptorsState = {
  status: ExplainDescriptorsStatus
  resources: ExplainResourceDescriptorView[]
}

export function loadExplainDescriptors(): Promise<ExplainResourceDescriptorView[]> {
  const scopeVersion = getCurrentOrganizationScopeVersion()
  if (descriptorCache && descriptorCache.scopeVersion === scopeVersion) return descriptorCache.promise
  const entry: DescriptorCacheEntry = {
    scopeVersion,
    resources: null,
    promise: fetchExplainDescriptors().then((outcome) => {
      if (outcome.status === 'ok') return Array.isArray(outcome.body.resources) ? outcome.body.resources : []
      if (outcome.status === 'forbidden') return []
      throw new Error('[internal] Explain descriptors could not be loaded')
    }),
  }
  descriptorCache = entry
  entry.promise.then((resources) => {
    entry.resources = resources
  }, () => undefined)
  entry.promise.catch(() => {
    if (descriptorCache === entry) descriptorCache = null
  })
  return entry.promise
}

export function peekExplainDescriptors(): ExplainResourceDescriptorView[] | null {
  if (!descriptorCache || descriptorCache.scopeVersion !== getCurrentOrganizationScopeVersion()) return null
  return descriptorCache.resources
}

export function resetExplainDescriptorsCache(): void {
  descriptorCache = null
}

export function findExplainResourceDescriptor(
  resources: readonly ExplainResourceDescriptorView[],
  resourceKind: string | null | undefined,
): ExplainResourceDescriptorView | null {
  if (!resourceKind) return null
  return resources.find((resource) => resource.resourceKind === resourceKind) ?? null
}

export function useExplainDescriptors(enabled = true): ExplainDescriptorsState {
  const scopeVersion = useOrganizationScopeVersion()
  const [state, setState] = React.useState<ExplainDescriptorsState>(() => {
    const cached = peekExplainDescriptors()
    return cached ? { status: 'ready', resources: cached } : { status: 'loading', resources: [] }
  })
  React.useEffect(() => {
    if (!enabled) return
    let active = true
    const cached = peekExplainDescriptors()
    if (cached) {
      setState((current) => (current.status === 'ready' && current.resources === cached ? current : { status: 'ready', resources: cached }))
      return
    }
    setState((current) => (current.status === 'loading' ? current : { status: 'loading', resources: current.resources }))
    loadExplainDescriptors()
      .then((resources) => {
        if (active) setState({ status: 'ready', resources })
      })
      .catch(() => {
        if (active) setState({ status: 'error', resources: [] })
      })
    return () => {
      active = false
    }
  }, [enabled, scopeVersion])
  return state
}

export function useExplainResourceDescriptor(resourceKind: string | null | undefined): {
  status: ExplainDescriptorsStatus
  descriptor: ExplainResourceDescriptorView | null
} {
  const enabled = Boolean(resourceKind)
  const { status, resources } = useExplainDescriptors(enabled)
  const descriptor = React.useMemo(
    () => findExplainResourceDescriptor(resources, resourceKind),
    [resources, resourceKind],
  )
  return { status: enabled ? status : 'ready', descriptor }
}
