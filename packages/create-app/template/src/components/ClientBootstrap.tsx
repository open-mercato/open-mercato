"use client"

import * as React from 'react'
// Side-effect imports: these register types/components on import, so they
// MUST stay top-level to be available during the first paint.
import '@/.mercato/generated/translations-fields.generated'
import '@/.mercato/generated/messages.client.generated'
import '@/.mercato/generated/payments.client.generated'

import { registerCoreInjectionWidgets, registerCoreInjectionTables, registerEnabledModuleIds } from '@open-mercato/core/modules/widgets/lib/injection'
import { registerInjectionWidgets } from '@open-mercato/ui/backend/injection/widgetRegistry'
import { registerDashboardWidgets } from '@open-mercato/ui/backend/dashboard/widgetRegistry'
import { registerNotificationHandlers } from '@open-mercato/shared/lib/notifications/handler-registry'

let _clientBootstrapped = false
let _bootstrapPromise: Promise<void> | null = null

async function clientBootstrap(): Promise<void> {
  if (_clientBootstrapped) return
  if (_bootstrapPromise) return _bootstrapPromise

  _bootstrapPromise = (async () => {
    try {
      // Defer generated registry barrels to a dynamic import so each barrel
      // becomes its own lazy chunk in Turbopack. Routes that mount this
      // provider but never use injection/dashboard/notification registries
      // still get the chunks compiled, but no longer during initial page
      // parse — the first paint is no longer blocked on registering every
      // module's client widgets.
      const [
        injectionWidgets,
        injectionTables,
        enabledModuleIds,
        dashboardWidgets,
        notificationHandlers,
      ] = await Promise.all([
        import('@/.mercato/generated/injection-widgets.generated'),
        import('@/.mercato/generated/injection-tables.generated'),
        import('@/.mercato/generated/enabled-module-ids.generated'),
        import('@/.mercato/generated/dashboard-widgets.generated'),
        import('@/.mercato/generated/notification-handlers.generated'),
      ])

      registerInjectionWidgets(injectionWidgets.injectionWidgetEntries)
      registerCoreInjectionWidgets(injectionWidgets.injectionWidgetEntries)
      registerCoreInjectionTables(injectionTables.injectionTables)
      registerEnabledModuleIds(enabledModuleIds.enabledModuleIds)
      registerDashboardWidgets(dashboardWidgets.dashboardWidgetEntries)
      registerNotificationHandlers(notificationHandlers.notificationHandlerEntries)

      _clientBootstrapped = true
    } catch (err) {
      // A lazy registry chunk failed to load (e.g. a stale chunk after a
      // deploy). Clear the cached promise so the next render retries instead
      // of leaving every client registry empty forever — otherwise dashboard
      // widget cards would wait on registration indefinitely with no error.
      _bootstrapPromise = null
      console.error('[ClientBootstrap] Failed to register client registries; will retry on next render', err)
    }
  })()

  return _bootstrapPromise
}

export function ClientBootstrapProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    void clientBootstrap()
  }, [])

  // Fire-and-forget on the very first client render so any consumer that
  // reads registries during the same paint as this provider mounts still
  // sees them populated by microtask flush. The promise is cached.
  if (typeof window !== 'undefined' && !_clientBootstrapped) {
    void clientBootstrap()
  }

  return <>{children}</>
}
