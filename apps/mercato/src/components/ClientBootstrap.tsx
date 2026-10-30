"use client"

import * as React from 'react'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleOverrideDomain } from '@open-mercato/shared/modules/overrides'

const logger = createLogger('app').child({ component: 'ClientBootstrap' })

// The registries below are also registered by the server bootstrap, which applies
// `src/modules.ts` overrides first. Re-registering them in the browser without the
// same step would overwrite the filtered registries with the raw generated ones, so
// a disabled widget reappears on hydration (#5152). Only the domains backing the
// registries below are dispatched — the rest stay server-only, so a domain whose
// applier never loads in the browser is not reported as unwired.
export const CLIENT_OVERRIDE_DOMAINS: readonly ModuleOverrideDomain[] = ['widgets', 'notifications']

let moduleOverridesPromise: Promise<void> | null = null

/**
 * `src/modules.ts` is evaluated again in the browser, where every server-only
 * `process.env.OM_*` read is `undefined` — Next.js inlines only `NEXT_PUBLIC_*`
 * values. An entry gated on such a variable is therefore absent from the client's
 * `enabledModules`, so the `widgets`/`notifications` overrides it carries are
 * dispatched on the server and silently skipped here, which reproduces the very
 * symptom of #5152 (filtered while server-rendered, back after hydration) with no
 * log line to explain it.
 *
 * The generated id list is the build-time evaluation of the same file with the real
 * env, so comparing against it names exactly the entries the browser cannot see. It
 * is a development aid only: the list is a build-time snapshot, so a deployment
 * whose runtime env differs from its build env would otherwise warn on every load.
 */
async function warnOnServerOnlyModuleGating(enabledModules: readonly { id: string }[]): Promise<void> {
  if (process.env.NODE_ENV === 'production') return
  try {
    const generated = await import('@/.mercato/generated/enabled-module-ids.generated')
    const clientIds = new Set(enabledModules.map((entry) => entry.id))
    const invisible = generated.enabledModuleIds.filter((id) => !clientIds.has(id))
    if (invisible.length === 0) return
    logger.warn(
      'Modules are missing from the browser-evaluated module list; any widgets or notifications overrides they declare cannot reach the client',
      {
        modules: invisible,
        hint: 'An enabledModules entry gated on a non-NEXT_PUBLIC_ env var must not carry widgets or notifications overrides',
      },
    )
  } catch (err) {
    logger.debug('Skipped the client module-gating check; the generated module id list is unavailable', { err })
  }
}

/**
 * Exported so the registry groups' dependency on it is testable. A failure here is
 * deliberately NOT fatal: registering the raw generated registries is what this app
 * did before the overrides reached the browser at all, whereas rethrowing would fail
 * the whole group and leave the page with no injection widgets, no dashboard widgets
 * and no notification handlers. Showing one widget that should have been hidden is
 * the smaller of the two failures.
 */
export function ensureModuleOverridesApplied(): Promise<void> {
  const pending = moduleOverridesPromise
  if (pending) return pending

  const promise: Promise<void> = (async () => {
    const [appModules, overrides] = await Promise.all([
      import('@/modules'),
      import('@open-mercato/shared/modules/overrides'),
    ])
    overrides.applyModuleOverridesFromEnabledModules(appModules.enabledModules, {
      domains: CLIENT_OVERRIDE_DOMAINS,
    })
    await warnOnServerOnlyModuleGating(appModules.enabledModules)
  })().catch((err) => {
    // Non-fatal but retryable, mirroring loadRegistryGroup below: caching the
    // rejected promise would pin the browser to unfiltered registries for the rest
    // of the session after a single transient chunk-load failure.
    if (moduleOverridesPromise === promise) moduleOverridesPromise = null
    logger.error('Failed to apply module overrides on the client; registries stay unfiltered', { err })
  })

  moduleOverridesPromise = promise
  return promise
}

/** @__internal Test-only hook — forget that the dispatch already ran. */
export function resetModuleOverridesAppliedForTests(): void {
  moduleOverridesPromise = null
}

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

export type ClientRegistryGroup =
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

/**
 * The groups backing `CLIENT_OVERRIDE_DOMAINS` — the only ones whose registration an
 * override can change. Awaiting the dispatch for the others would pull `@/modules`
 * and the overrides module into the client graph of the public `/messages/view/*`
 * and `/pay/*` routes, and serialize their registration behind that import, for no
 * behavioural gain.
 */
export const OVERRIDE_DEPENDENT_GROUPS: ReadonlySet<ClientRegistryGroup> = new Set<ClientRegistryGroup>([
  'injection',
  'dashboard',
  'notifications',
])

async function loadRegistryGroup(group: ClientRegistryGroup): Promise<void> {
  if (loadedGroups.has(group)) return
  const pending = groupPromises.get(group)
  if (pending) return pending

  const promise = (async () => {
    if (OVERRIDE_DEPENDENT_GROUPS.has(group)) await ensureModuleOverridesApplied()
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
        coreRegistry.registerCoreInjectionTables(tables.injectionTables, widgets.injectionWidgetEntries)
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
