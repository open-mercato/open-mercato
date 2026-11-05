'use client'

import * as React from 'react'
import type { InjectionMenuItem } from '@open-mercato/shared/modules/widgets/injection'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { useInjectionDataWidgets } from './useInjectionDataWidgets'
import { useBackendChrome } from '../BackendChromeProvider'

export type MenuSurfaceId =
  | 'menu:sidebar:main'
  | 'menu:sidebar:settings'
  | 'menu:sidebar:profile'
  | 'menu:topbar:profile-dropdown'
  | 'menu:topbar:actions'
  | `menu:sidebar:settings:${string}`
  | `menu:sidebar:main:${string}`
  | `menu:${string}`

export function useInjectedMenuItems(surfaceId: MenuSurfaceId): {
  items: InjectionMenuItem[]
  isLoading: boolean
} {
  const { widgets, isLoading } = useInjectionDataWidgets(surfaceId)
  const { payload, isReady } = useBackendChrome()
  const grantedFeatureList = React.useMemo(
    () => payload?.grantedFeatures ?? [],
    [payload?.grantedFeatures],
  )
  const userRoles = React.useMemo(
    () => new Set(payload?.roles ?? []),
    [payload?.roles],
  )

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

  const items = React.useMemo(
    () =>
      rawItems.filter((item) => {
        const features = item.features ?? []
        const roles = item.roles ?? []
        const featuresOk = features.length === 0 || hasAllFeatures(grantedFeatureList, features)
        const rolesOk = roles.length === 0 || roles.some((role) => userRoles.has(role))
        return featuresOk && rolesOk
      }),
    [rawItems, grantedFeatureList, userRoles],
  )

  return { items, isLoading: isLoading || !isReady }
}
