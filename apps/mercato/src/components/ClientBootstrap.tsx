"use client"

import * as React from 'react'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('app').child({ component: 'ClientBootstrap' })

export type ClientBootstrapProfile =
  | 'public'
  | 'login'
  | 'backend'
  | 'backend-dashboard'
  | 'backend-messages'
  | 'backend-checkout'
  | 'portal'
  | 'checkout'
  | 'message'

type ClientRegistryGroup =
  | 'translations'
  | 'injection'
  | 'dashboard'
  | 'notifications'
  | 'messages'
  | 'payments'

const BACKEND_PREFIX = '/backend'

export function resolveClientBootstrapProfile(pathname: string | null): ClientBootstrapProfile {
  const path = pathname?.split('?')[0].replace(/\/+$/, '') || '/'

  if (path === '/login') return 'login'
  if (path === BACKEND_PREFIX) return 'backend-dashboard'
  if (path === `${BACKEND_PREFIX}/messages` || path.startsWith(`${BACKEND_PREFIX}/messages/`)) {
    return 'backend-messages'
  }
  if (/^\/backend\/checkout\/templates\/[^/]+\/preview(?:\/|$)/.test(path)) {
    return 'backend-checkout'
  }
  if (path.startsWith(`${BACKEND_PREFIX}/`)) return 'backend'
  if (/^\/[^/]+\/portal(?:\/|$)/.test(path)) return 'portal'
  if (path === '/pay' || path.startsWith('/pay/')) return 'checkout'
  if (path === '/messages/view' || path.startsWith('/messages/view/')) return 'message'
  return 'public'
}

export function profileUsesComponentOverrides(profile: ClientBootstrapProfile): boolean {
  return profile === 'login'
    || profile === 'backend'
    || profile === 'backend-dashboard'
    || profile === 'backend-messages'
    || profile === 'backend-checkout'
    || profile === 'portal'
    || profile === 'checkout'
}

export function groupsForProfile(profile: ClientBootstrapProfile): ClientRegistryGroup[] {
  switch (profile) {
    case 'backend-dashboard':
      return ['translations', 'injection', 'notifications', 'messages', 'dashboard']
    case 'backend-messages':
      return ['translations', 'injection', 'notifications', 'messages']
    case 'backend-checkout':
      return ['translations', 'injection', 'notifications', 'messages', 'payments']
    case 'backend':
      // Message composers are embedded across backend modules (customers,
      // sales, catalog, staff, and others), not only under /backend/messages.
      return ['translations', 'injection', 'notifications', 'messages']
    case 'portal':
      // Injection tables include the translations table, which is materialized
      // at module evaluation time. Register translations first so a later
      // portal -> backend navigation cannot cache an incomplete table.
      return ['translations', 'injection']
    case 'checkout':
      return ['translations', 'injection', 'payments']
    case 'message':
      return ['messages']
    default:
      return []
  }
}

const loadedGroups = new Set<ClientRegistryGroup>()
const groupPromises = new Map<ClientRegistryGroup, Promise<void>>()

async function loadRegistryGroup(group: ClientRegistryGroup): Promise<void> {
  if (loadedGroups.has(group)) return
  const pending = groupPromises.get(group)
  if (pending) return pending

  const promise = (async () => {
    switch (group) {
      case 'translations':
        await import('@/.mercato/generated/translations-fields.generated')
        break
      case 'injection': {
        const [widgets, tables, enabledModules, coreRegistry, uiRegistry] = await Promise.all([
          import('@/.mercato/generated/injection-widgets.generated'),
          import('@/.mercato/generated/injection-tables.generated'),
          import('@/.mercato/generated/enabled-module-ids.generated'),
          import('@open-mercato/core/modules/widgets/lib/injection'),
          import('@open-mercato/ui/backend/injection/widgetRegistry'),
        ])
        uiRegistry.registerInjectionWidgets(widgets.injectionWidgetEntries)
        coreRegistry.registerCoreInjectionWidgets(widgets.injectionWidgetEntries)
        coreRegistry.registerCoreInjectionTables(tables.injectionTables)
        coreRegistry.registerEnabledModuleIds(enabledModules.enabledModuleIds)
        break
      }
      case 'dashboard': {
        const [widgets, registry] = await Promise.all([
          import('@/.mercato/generated/dashboard-widgets.generated'),
          import('@open-mercato/ui/backend/dashboard/widgetRegistry'),
        ])
        registry.registerDashboardWidgets(widgets.dashboardWidgetEntries)
        break
      }
      case 'notifications': {
        const [handlers, registry] = await Promise.all([
          import('@/.mercato/generated/notification-handlers.generated'),
          import('@open-mercato/shared/lib/notifications/handler-registry'),
        ])
        registry.registerNotificationHandlers(handlers.notificationHandlerEntries)
        break
      }
      case 'messages':
        await import('@/.mercato/generated/messages.client.generated')
        break
      case 'payments':
        await import('@/.mercato/generated/payments.client.generated')
        break
    }
    loadedGroups.add(group)
  })().catch((err) => {
    groupPromises.delete(group)
    logger.error('Failed to register client registry group; next render will retry', { group, err })
    throw err
  })

  groupPromises.set(group, promise)
  return promise
}

const profilePromises = new Map<ClientBootstrapProfile, Promise<void>>()

function bootstrapProfile(profile: ClientBootstrapProfile): Promise<void> {
  const existing = profilePromises.get(profile)
  if (existing) return existing

  const groups = groupsForProfile(profile)
  const promise = (async () => {
    // Translation registration must precede injection-table evaluation.
    if (groups[0] === 'translations') {
      await loadRegistryGroup('translations')
    }
    await Promise.all(groups.filter((group) => group !== 'translations').map(loadRegistryGroup))
  })().catch((err) => {
    profilePromises.delete(profile)
    throw err
  })
  profilePromises.set(profile, promise)
  return promise
}

export function ClientBootstrapProvider({
  profile,
  children,
}: {
  profile: ClientBootstrapProfile
  children: React.ReactNode
}) {
  const promise = bootstrapProfile(profile)
  const hasRegistryGroups = groupsForProfile(profile).length > 0

  React.useEffect(() => {
    if (!hasRegistryGroups) return
    // Start registration during the first client render, but do not suspend
    // hydration behind lazy registry chunks. Server-rendered controls remain
    // visible while hydration is pending, and blocking here would let users
    // interact with DOM that React has not attached to yet.
    void promise.catch(() => {})
  }, [hasRegistryGroups, promise])

  if (hasRegistryGroups && typeof window === 'undefined') {
    // Server registry consumers still need a complete profile before render.
    // The rejected promise is evicted above so a boundary retry requests a
    // fresh lazy chunk.
    React.use(promise)
  }
  return <>{children}</>
}
