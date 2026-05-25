"use client"

import * as React from 'react'
import { registerCoreInjectionWidgets, registerCoreInjectionTables, registerEnabledModuleIds } from '@open-mercato/core/modules/widgets/lib/injection'
import { registerInjectionWidgets } from '@open-mercato/ui/backend/injection/widgetRegistry'
import { registerDashboardWidgets } from '@open-mercato/ui/backend/dashboard/widgetRegistry'
import { registerNotificationHandlers } from '@open-mercato/shared/lib/notifications/handler-registry'

let clientBootstrapPromise: Promise<void> | null = null
let clientBootstrapped = false

async function clientBootstrap() {
  if (clientBootstrapped) return
  if (clientBootstrapPromise) return clientBootstrapPromise

  clientBootstrapPromise = Promise.all([
    import('@/.mercato/generated/injection-widgets.generated'),
    import('@/.mercato/generated/injection-tables.generated'),
    import('@/.mercato/generated/enabled-module-ids.generated'),
    import('@/.mercato/generated/dashboard-widgets.generated'),
    import('@/.mercato/generated/notification-handlers.generated'),
    // Side-effect: registers translatable fields for client-side TranslationManager.
    import('@/.mercato/generated/translations-fields.generated'),
    // Side-effect: configures message UI component and object type registries on the client.
    import('@/.mercato/generated/messages.client.generated'),
    // Side-effect: registers provider-owned payment renderer widgets on the client.
    import('@/.mercato/generated/payments.client.generated'),
  ]).then(([
    { injectionWidgetEntries },
    { injectionTables },
    { enabledModuleIds },
    { dashboardWidgetEntries },
    { notificationHandlerEntries },
  ]) => {
    // Register injection widgets.
    registerInjectionWidgets(injectionWidgetEntries)
    registerCoreInjectionWidgets(injectionWidgetEntries)
    registerCoreInjectionTables(injectionTables)
    registerEnabledModuleIds(enabledModuleIds)

    // Register dashboard widgets.
    registerDashboardWidgets(dashboardWidgetEntries)

    // Register notification handlers for client-side reactive effects.
    registerNotificationHandlers(notificationHandlerEntries)

    clientBootstrapped = true
  }).catch((error) => {
    clientBootstrapPromise = null
    throw error
  })

  return clientBootstrapPromise
}

export function ClientBootstrapProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    void clientBootstrap()
  }, [])

  return <>{children}</>
}

export const __clientBootstrapForTests = clientBootstrap

export function __resetClientBootstrapForTests() {
  clientBootstrapPromise = null
  clientBootstrapped = false
}
