"use client"

import * as React from 'react'
import { GripVertical, LayoutGrid, Loader2, Palette, RefreshCw, Settings2, Trash2, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistry'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type {
  DashboardLayoutItem,
  DashboardWidgetAccent,
  DashboardWidgetComponentProps,
  DashboardWidgetMetadata,
  DashboardWidgetModule,
  DashboardWidgetRenderContext,
  DashboardWidgetSize,
} from '@open-mercato/shared/modules/dashboard/widgets'
import type { DashboardSortableHandle } from './GridLayout'

const logger = createLogger('ui').child({ component: 'DashboardWidgetCardV2' })

export type DashboardWidgetCatalogItem = Omit<DashboardWidgetMetadata, 'description'> & {
  description?: string | null
  defaultSize?: DashboardWidgetSize
  defaultEnabled?: boolean
  defaultSettings?: unknown
  features?: string[]
  moduleId?: string
  icon?: string | null
  loaderKey: string
}

type WidgetCardV2Props = {
  layout: DashboardLayoutItem
  meta: DashboardWidgetCatalogItem
  title: string
  description?: string | null
  widgetModule: DashboardWidgetModule<any> | null
  loading: boolean
  loadError?: string | null
  context: DashboardWidgetRenderContext
  editing: boolean
  settingsOpen: boolean
  refreshToken: number
  dragHandle: DashboardSortableHandle
  dragging?: boolean
  onRetry: () => void
  onRemove: () => void
  onSizeChange: (size: DashboardWidgetSize) => void
  onAccentChange: (accent: DashboardWidgetAccent | undefined) => void
  onSettingsChange: (next: unknown) => void
  onToggleSettings: () => void
  onEditWizard?: () => void
}

type ErrorBoundaryProps = {
  children: React.ReactNode
  errorLabel: string
  retryLabel: string
  resetKey: number
  onRetry: () => void
}

type ErrorBoundaryState = { hasError: boolean }

class WidgetErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  componentDidCatch(error: unknown) {
    logger.error('Dashboard widget render failed', { err: error })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <ErrorMessage
        label={this.props.errorLabel}
        action={(
          <Button type="button" variant="outline" size="sm" onClick={this.props.onRetry}>
            {this.props.retryLabel}
          </Button>
        )}
      />
    )
  }
}

const SIZE_OPTIONS: DashboardWidgetSize[] = ['sm', 'md', 'lg', 'full']
const ACCENT_OPTIONS: DashboardWidgetAccent[] = ['neutral', 'info', 'success', 'warning', 'error', 'brand']

// Ambient identity: a faint surface wash + accent border, anchored by a solid
// icon tile in the header (see ACCENT_SWATCH). Kept subtle so the value stays
// the loudest thing on the card; absent accent renders the neutral card as before.
const ACCENT_CLASS: Record<DashboardWidgetAccent, string> = {
  neutral: 'border-status-neutral-border bg-status-neutral-bg/40',
  info: 'border-status-info-border bg-status-info-bg/40',
  success: 'border-status-success-border bg-status-success-bg/40',
  warning: 'border-status-warning-border bg-status-warning-bg/40',
  error: 'border-status-error-border bg-status-error-bg/40',
  brand: 'border-brand-violet/40 bg-brand-violet/5',
}

const ACCENT_SWATCH: Record<DashboardWidgetAccent, string> = {
  neutral: 'bg-status-neutral-icon',
  info: 'bg-status-info-icon',
  success: 'bg-status-success-icon',
  warning: 'bg-status-warning-icon',
  error: 'bg-status-error-icon',
  brand: 'bg-brand-violet',
}

function WidgetAccentIcon({ name, className }: { name?: string | null; className?: string }) {
  const Resolved = resolveRegisteredLucideIcon(name ?? undefined) ?? LayoutGrid
  return <Resolved className={className} aria-hidden="true" />
}

export function WidgetCardV2({
  layout,
  meta,
  title,
  description,
  widgetModule,
  loading,
  loadError,
  context,
  editing,
  settingsOpen,
  refreshToken,
  dragHandle,
  dragging,
  onRetry,
  onRemove,
  onSizeChange,
  onAccentChange,
  onSettingsChange,
  onToggleSettings,
  onEditWizard,
}: WidgetCardV2Props) {
  const t = useT()
  const [localRefreshToken, setLocalRefreshToken] = React.useState(0)
  const [refreshing, setRefreshing] = React.useState(false)
  const [renderResetKey, setRenderResetKey] = React.useState(0)

  React.useEffect(() => {
    if (!meta.supportsRefresh || settingsOpen || loading || loadError) setRefreshing(false)
  }, [loadError, loading, meta.supportsRefresh, settingsOpen])

  const hydratedSettings = React.useMemo(() => {
    const raw = layout.settings ?? meta.defaultSettings ?? null
    if (!widgetModule?.hydrateSettings) return raw
    try {
      return widgetModule.hydrateSettings(raw)
    } catch (err) {
      logger.warn('Failed to hydrate dashboard widget settings', { err })
      return raw
    }
  }, [layout.settings, meta.defaultSettings, widgetModule])

  const handleSettingsChange = React.useCallback((next: unknown) => {
    let raw = next
    if (widgetModule?.dehydrateSettings) {
      try {
        raw = widgetModule.dehydrateSettings(next as never)
      } catch (err) {
        logger.warn('Failed to dehydrate dashboard widget settings', { err })
      }
    }
    onSettingsChange(raw)
  }, [onSettingsChange, widgetModule])

  const handleRetry = React.useCallback(() => {
    setRenderResetKey((value) => value + 1)
    onRetry()
  }, [onRetry])

  const triggerRefresh = React.useCallback(() => {
    if (loading || loadError) return
    setRefreshing(true)
    setLocalRefreshToken((value) => value + 1)
  }, [loadError, loading])

  const WidgetComponent = widgetModule?.Widget as React.ComponentType<DashboardWidgetComponentProps<any>> | undefined
  const mode = settingsOpen ? 'settings' : 'view'
  const dragAttributes = dragHandle.attributes as React.ButtonHTMLAttributes<HTMLButtonElement>
  const dragListeners = dragHandle.listeners as React.ButtonHTMLAttributes<HTMLButtonElement> | undefined

  return (
    <section
      className={cn(
        'flex h-full min-h-40 flex-col rounded-xl border border-border bg-card p-4 shadow-sm',
        layout.accent && ACCENT_CLASS[layout.accent],
        dragging && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {layout.accent ? (
            <span className={cn('flex size-8 flex-none items-center justify-center rounded-lg text-white', ACCENT_SWATCH[layout.accent])}>
              <WidgetAccentIcon name={meta.icon} className="size-4" />
            </span>
          ) : null}
          <div className="min-w-0 space-y-1">
            <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
            {description ? <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {editing ? (
            <>
              <IconButton
                ref={dragHandle.setActivatorNodeRef as React.Ref<HTMLButtonElement>}
                type="button"
                variant="ghost"
                size="sm"
                className="cursor-grab touch-none active:cursor-grabbing"
                aria-label={t('dashboard.v2.dragWidget')}
                {...dragAttributes}
                {...dragListeners}
              >
                <GripVertical className="size-4" />
              </IconButton>
              <SizeMenu size={layout.size ?? meta.defaultSize ?? 'md'} onSizeChange={onSizeChange} />
              <ColorMenu accent={layout.accent} onAccentChange={onAccentChange} />
              <IconButton
                type="button"
                variant={settingsOpen && !onEditWizard ? 'outline' : 'ghost'}
                size="sm"
                onClick={onEditWizard ?? onToggleSettings}
                aria-label={t('dashboard.v2.widgetSettings')}
              >
                {onEditWizard ? <Settings2 className="size-4" /> : settingsOpen ? <X className="size-4" /> : <Settings2 className="size-4" />}
              </IconButton>
              <IconButton type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={t('dashboard.v2.removeWidget')}>
                <Trash2 className="size-4" />
              </IconButton>
            </>
          ) : meta.supportsRefresh ? (
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              disabled={refreshing || loading || !!loadError}
              onClick={triggerRefresh}
              aria-label={t('dashboard.v2.refreshAll')}
            >
              {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </IconButton>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        {loading ? (
          <WidgetSkeleton />
        ) : loadError || !WidgetComponent ? (
          <ErrorMessage
            label={loadError ?? t('dashboard.v2.widgetLoadFailed')}
            action={<Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('dashboard.v2.refreshAll')}</Button>}
          />
        ) : (
          <WidgetErrorBoundary
            errorLabel={t('dashboard.v2.widgetLoadFailed')}
            retryLabel={t('dashboard.v2.refreshAll')}
            resetKey={renderResetKey + refreshToken + localRefreshToken}
            onRetry={handleRetry}
          >
            <React.Suspense fallback={<WidgetSkeleton />}>
              <WidgetComponent
                mode={mode}
                layout={layout}
                settings={hydratedSettings}
                context={context}
                onSettingsChange={handleSettingsChange}
                refreshToken={refreshToken + localRefreshToken}
                onRefreshStateChange={setRefreshing}
              />
            </React.Suspense>
          </WidgetErrorBoundary>
        )}
      </div>
    </section>
  )
}

function SizeMenu({ size, onSizeChange }: { size: DashboardWidgetSize; onSizeChange: (size: DashboardWidgetSize) => void }) {
  const t = useT()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {t('dashboard.v2.sizeLabel')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1">
        <div className="space-y-1">
          {SIZE_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={option === size ? 'secondary' : 'ghost'}
              size="sm"
              className="w-full justify-start"
              onClick={() => onSizeChange(option)}
            >
              {t(`dashboard.v2.size.${option}`)}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ColorMenu({
  accent,
  onAccentChange,
}: {
  accent?: DashboardWidgetAccent
  onAccentChange: (accent: DashboardWidgetAccent | undefined) => void
}) {
  const t = useT()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton type="button" variant="ghost" size="sm" aria-label={t('dashboard.v2.accent.label')}>
          <Palette className="size-4" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 space-y-2 p-2">
        <Button
          type="button"
          variant={accent ? 'ghost' : 'secondary'}
          size="sm"
          className="w-full justify-start"
          onClick={() => onAccentChange(undefined)}
        >
          {t('dashboard.v2.accent.none')}
        </Button>
        <div className="grid grid-cols-6 gap-1">
          {ACCENT_OPTIONS.map((option) => (
            <IconButton
              key={option}
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t(`dashboard.v2.accent.${option}`)}
              className={cn(accent === option && 'ring-2 ring-ring')}
              onClick={() => onAccentChange(option)}
            >
              <span className={cn('size-4 rounded-full', ACCENT_SWATCH[option])} aria-hidden="true" />
            </IconButton>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function WidgetSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="h-6 w-24 animate-pulse rounded-md bg-muted" />
      <div className="h-16 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" />
    </div>
  )
}
