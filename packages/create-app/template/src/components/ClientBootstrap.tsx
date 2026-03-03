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
// Side-effect: registers translatable fields for client-side TranslationManager
import '@/.mercato/generated/translations-fields.generated'
import { getMessageUiComponentRegistry } from '@/.mercato/generated/messages.client.generated'
import { configureMessageUiComponentRegistry } from '@open-mercato/core/modules/messages/components/utils/typeUiRegistry'

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

  // Configure message UI components from generated client registry.
  configureMessageUiComponentRegistry(getMessageUiComponentRegistry())
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
