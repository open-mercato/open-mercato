'use client'

import * as React from 'react'
import type { InjectionMenuItem } from '@open-mercato/shared/modules/widgets/injection'
import { useInjectionDataWidgets } from './useInjectionDataWidgets'
import { apiCall } from '../utils/apiCall'

export type MenuSurfaceId =
  | 'menu:sidebar:main'
  | 'menu:sidebar:settings'
  | 'menu:sidebar:profile'
  | 'menu:topbar:profile-dropdown'
  | 'menu:topbar:actions'
  | `menu:sidebar:settings:${string}`
  | `menu:sidebar:main:${string}`
  | `menu:${string}`

type FeatureCheckResponse = {
  ok: boolean
  granted?: string[]
}

function collectRequiredFeatures(items: InjectionMenuItem[]): string[] {
  const set = new Set<string>()
  for (const item of items) {
    for (const feature of item.features ?? []) {
      if (!feature || feature.trim().length === 0) continue
      set.add(feature)
    }
  }
  return Array.from(set)
}

async function readGrantedFeatures(features: string[]): Promise<Set<string>> {
  if (features.length === 0) return new Set()
  const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ features }),
  })
  if (!call.ok) return new Set(features)
  return new Set(call.result?.granted ?? [])
}

export function useInjectedMenuItems(surfaceId: MenuSurfaceId): {
  items: InjectionMenuItem[]
  isLoading: boolean
} {
  const { widgets, isLoading } = useInjectionDataWidgets(surfaceId)
  const [grantedFeatures, setGrantedFeatures] = React.useState<Set<string>>(new Set())

  const rawItems = React.useMemo(() => {
    const entries: InjectionMenuItem[] = []
    for (const widget of widgets) {
      if (!('menuItems' in widget)) continue
      const metadataFeatures = widget.metadata.features ?? []
      for (const menuItem of widget.menuItems) {
        const features = [...metadataFeatures, ...(menuItem.features ?? [])]
        entries.push({
          ...menuItem,
          features,
        })
      }
    }
    return entries
  }, [widgets])

  React.useEffect(() => {
    let mounted = true
    const run = async () => {
      const features = collectRequiredFeatures(rawItems)
      const next = await readGrantedFeatures(features)
      if (!mounted) return
      setGrantedFeatures(next)
    }
    void run()
    return () => {
      mounted = false
    }
  }, [rawItems])

  const items = React.useMemo(
    () =>
      rawItems.filter((item) => {
        const features = item.features ?? []
        if (features.length === 0) return true
        return features.every((feature) => grantedFeatures.has(feature))
      }),
    [rawItems, grantedFeatures],
  )

  return { items, isLoading }
}
