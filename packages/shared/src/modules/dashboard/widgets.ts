import React, { type ComponentType } from 'react'

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
  supportsRefresh?: boolean
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
  refreshToken: number
  onRefreshStateChange?: (refreshing: boolean) => void
}

export type DashboardWidgetModule<TSettings = unknown> = {
  metadata: DashboardWidgetMetadata
  Widget: ComponentType<DashboardWidgetComponentProps<TSettings>>
  hydrateSettings?: (raw: unknown) => TSettings
  dehydrateSettings?: (settings: TSettings) => unknown
}

export type DashboardWidgetRenderProps<TSettings = unknown> = DashboardWidgetComponentProps<TSettings>

type DashboardWidgetLoader<TSettings> = () => Promise<
  | { default: ComponentType<DashboardWidgetComponentProps<TSettings>> }
  | ComponentType<DashboardWidgetComponentProps<TSettings>>
>

export function lazyDashboardWidget<TSettings>(
  loader: DashboardWidgetLoader<TSettings>,
): ComponentType<DashboardWidgetComponentProps<TSettings>> {
  let cached: ComponentType<DashboardWidgetComponentProps<TSettings>> | null = null
  let pending: Promise<void> | null = null

  const load = () => {
    if (cached) return Promise.resolve()
    if (!pending) {
      pending = loader()
        .then((mod) => {
          cached = (mod as { default?: ComponentType<DashboardWidgetComponentProps<TSettings>> }).default ??
            (mod as ComponentType<DashboardWidgetComponentProps<TSettings>>)
        })
        .catch((err) => {
          pending = null
          throw err
        })
    }
    return pending
  }

  const LazyWidget: ComponentType<DashboardWidgetComponentProps<TSettings>> = (props) => {
    const [, setTick] = React.useState(0)
    React.useEffect(() => {
      let cancelled = false
      void load()
        .then(() => {
          if (!cancelled) setTick((value) => value + 1)
        })
        .catch((err) => {
          if (!cancelled) {
            try {
              console.error('Failed to load dashboard widget component', err)
            } catch {}
            setTick((value) => value + 1)
          }
        })
      return () => {
        cancelled = true
      }
    }, [])
    if (!cached) return null
    return React.createElement(cached, props)
  }

  return LazyWidget
}
