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

type ProfileResponse = {
  email?: string
  roles?: string[]
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

async function readUserRoles(): Promise<Set<string>> {
  const call = await apiCall<ProfileResponse>('/api/auth/profile')
  if (!call.ok) return new Set()
  const roles = Array.isArray(call.result?.roles) ? call.result.roles : []
  return new Set(roles.filter((role): role is string => typeof role === 'string' && role.trim().length > 0))
}

export function useInjectedMenuItems(surfaceId: MenuSurfaceId): {
  items: InjectionMenuItem[]
  isLoading: boolean
} {
  const { widgets, isLoading } = useInjectionDataWidgets(surfaceId)
  const [grantedFeatures, setGrantedFeatures] = React.useState<Set<string>>(new Set())
  const [userRoles, setUserRoles] = React.useState<Set<string>>(new Set())

  const rawItems = React.useMemo(() => {
    const entries: InjectionMenuItem[] = []
    for (const widget of widgets) {
      if (!('menuItems' in widget)) continue
      const metadataFeatures = widget.metadata.features ?? []
      for (const menuItem of widget.menuItems) {
        const features = [...metadataFeatures, ...(menuItem.features ?? [])]
        const normalizedLabelKey =
          menuItem.labelKey ??
          (typeof menuItem.label === 'string' && menuItem.label.includes('.') ? menuItem.label : undefined)
        entries.push({
          ...menuItem,
          labelKey: normalizedLabelKey,
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

  React.useEffect(() => {
    let mounted = true
    const run = async () => {
      const roles = await readUserRoles()
      if (!mounted) return
      setUserRoles(roles)
    }
    void run()
    return () => {
      mounted = false
    }
  }, [])

  const items = React.useMemo(
    () =>
      rawItems.filter((item) => {
        const features = item.features ?? []
        const roles = item.roles ?? []
        const featuresOk = features.length === 0 || features.every((feature) => grantedFeatures.has(feature))
        const rolesOk = roles.length === 0 || roles.some((role) => userRoles.has(role))
        return featuresOk && rolesOk
      }),
    [rawItems, grantedFeatures, userRoles],
  )

  return { items, isLoading }
}
