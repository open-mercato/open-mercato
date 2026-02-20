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
