import type { ComponentType } from 'react'

export type DashboardWidgetSize = 'sm' | 'md' | 'lg'

export type DashboardWidgetMetadata = {
  id: string
  title: string
  description?: string
  subtitle?: string
  features?: string[]
  defaultSize?: DashboardWidgetSize
  defaultSettings?: unknown
  defaultEnabled?: boolean
  tags?: string[]
  category?: string
  icon?: string
}

export type DashboardLayoutItem = {
  id: string
  widgetId: string
  order: number
  priority?: number
  size?: DashboardWidgetSize
  settings?: unknown
}

export type DashboardWidgetRenderMode = 'view' | 'settings'

export type DashboardWidgetRenderContext = {
  userId: string
  tenantId?: string | null
  organizationId?: string | null
  userName?: string | null
  userEmail?: string | null
  userLabel?: string | null
}

export type DashboardWidgetComponentProps<TSettings = unknown> = {
  mode: DashboardWidgetRenderMode
  layout: DashboardLayoutItem
  settings: TSettings
  context: DashboardWidgetRenderContext
  onSettingsChange: (next: TSettings) => void
}

export type DashboardWidgetModule<TSettings = unknown> = {
  metadata: DashboardWidgetMetadata
  Widget: ComponentType<DashboardWidgetComponentProps<TSettings>>
  hydrateSettings?: (raw: unknown) => TSettings
  dehydrateSettings?: (settings: TSettings) => unknown
}

export type DashboardWidgetRenderProps<TSettings = unknown> = DashboardWidgetComponentProps<TSettings>
