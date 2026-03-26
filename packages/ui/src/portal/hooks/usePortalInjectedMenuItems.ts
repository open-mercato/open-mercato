'use client'

import * as React from 'react'
import type { InjectionMenuItem } from '@open-mercato/shared/modules/widgets/injection'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { useInjectionDataWidgets } from '../../backend/injection/useInjectionDataWidgets'
import { apiCall } from '../../backend/utils/apiCall'
import { usePortalContext } from '../PortalContext'

function useOptionalOrgSlug(): string {
  try {
    return usePortalContext().orgSlug
  } catch {
    return ''
  }
}

export type PortalMenuSurfaceId =
  | 'menu:portal:sidebar:main'
  | 'menu:portal:sidebar:account'
  | 'menu:portal:header:actions'
  | 'menu:portal:user-dropdown'
  | `menu:portal:${string}`

type PortalFeatureCheckResponse = {
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

async function readPortalGrantedFeatures(features: string[]): Promise<Set<string>> {
  if (features.length === 0) return new Set()
  try {
    const { ok, result: data } = await apiCall<PortalFeatureCheckResponse>('/api/customer_accounts/portal/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features }),
    })
    if (!ok || !data?.ok) return new Set()
    return new Set(data.granted ?? [])
  } catch {
    return new Set()
  }
}

/**
 * Portal-aware variant of useInjectedMenuItems.
 *
 * Checks feature visibility against the customer portal RBAC
 * via `/api/customer_accounts/portal/feature-check` instead of
 * the staff `/api/auth/feature-check`.
 *
 * @example
 * ```tsx
 * import { usePortalInjectedMenuItems } from '@open-mercato/ui/portal/hooks/usePortalInjectedMenuItems'
 *
 * const { items, isLoading } = usePortalInjectedMenuItems('menu:portal:sidebar:main')
 * ```
 */
export function usePortalInjectedMenuItems(surfaceId: PortalMenuSurfaceId): {
  items: InjectionMenuItem[]
  isLoading: boolean
} {
  const { widgets, isLoading } = useInjectionDataWidgets(surfaceId)
  const orgSlug = useOptionalOrgSlug()
  const [grantedFeatures, setGrantedFeatures] = React.useState<Set<string>>(new Set())
  const grantedFeatureList = React.useMemo(() => Array.from(grantedFeatures), [grantedFeatures])

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
      const next = await readPortalGrantedFeatures(features)
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
      rawItems
        .filter((item) => {
          const features = item.features ?? []
          return features.length === 0 || hasAllFeatures(grantedFeatureList, features)
        })
        .map((item) => ({
          ...item,
          href: item.href && orgSlug && item.href.startsWith('/portal/')
            ? `/${orgSlug}${item.href}`
            : item.href,
        })),
    [rawItems, grantedFeatureList, orgSlug],
  )

  return { items, isLoading }
}
