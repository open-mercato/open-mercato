"use client"

import * as React from 'react'
import { injectionWidgetEntries } from '@/.mercato/generated/injection-widgets.generated'
// Side-effect: registers translatable fields for client-side TranslationManager
import '@/.mercato/generated/translations-fields.generated'
import { injectionTables } from '@/.mercato/generated/injection-tables.generated'
import { registerCoreInjectionWidgets, registerCoreInjectionTables } from '@open-mercato/core/modules/widgets/lib/injection'
import { registerInjectionWidgets } from '@open-mercato/ui/backend/injection/widgetRegistry'
import { dashboardWidgetEntries } from '@/.mercato/generated/dashboard-widgets.generated'
import { registerDashboardWidgets } from '@open-mercato/ui/backend/dashboard/widgetRegistry'
import { notificationHandlerEntries } from '@/.mercato/generated/notification-handlers.generated'
import { registerNotificationHandlers } from '@open-mercato/shared/lib/notifications/handler-registry'
// Side-effect: registers translatable fields for client-side TranslationManager
import '@/.mercato/generated/translations-fields.generated'
// Side-effect: configures message UI component and object type registries on the client.
import '@/.mercato/generated/messages.client.generated'

let _clientBootstrapped = false

function clientBootstrap() {
  if (_clientBootstrapped) return
  _clientBootstrapped = true

  // Register injection widgets
  registerInjectionWidgets(injectionWidgetEntries)
  registerCoreInjectionWidgets(injectionWidgetEntries)
  registerCoreInjectionTables(injectionTables)

  // Register dashboard widgets
  registerDashboardWidgets(dashboardWidgetEntries)

  // Register notification handlers for client-side reactive effects
  registerNotificationHandlers(notificationHandlerEntries)
}

export function ClientBootstrapProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    clientBootstrap()
  }, [])

  // Also bootstrap synchronously on first render for SSR hydration
  if (typeof window !== 'undefined' && !_clientBootstrapped) {
    clientBootstrap()
  }

  return <>{children}</>
}
