"use client"
import * as React from 'react'
import type {
  InjectionSpotId,
  InjectionWidgetModule,
  WidgetInjectionEventHandlers,
  WidgetBeforeSaveResult,
} from '@open-mercato/shared/modules/widgets/injection'
import { loadInjectionWidgetsForSpot, type LoadedInjectionWidget } from '@open-mercato/core/modules/widgets/lib/injection'

export type InjectionSpotProps<TContext = unknown, TData = unknown> = {
  spotId: InjectionSpotId
  context: TContext
  data?: TData
  onDataChange?: (data: TData) => void
  disabled?: boolean
  onEvent?: (event: 'onLoad' | 'onBeforeSave' | 'onSave' | 'onAfterSave', widgetId: string) => void
  widgetsOverride?: LoadedWidget[]
}

type LoadedWidget = {
  widgetId: string
  module: InjectionWidgetModule<any, any>
  moduleId: string
  key: string
  placement?: LoadedInjectionWidget['placement']
}

export function useInjectionWidgets<TContext = unknown>(
  spotId: InjectionSpotId | null | undefined,
  options?: {
    context?: TContext
    triggerOnLoad?: boolean
    onEvent?: (event: 'onLoad', widgetId: string) => void
  }
) {
  const [widgets, setWidgets] = React.useState<LoadedWidget[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const loadedRef = React.useRef(false)

  React.useEffect(() => {
    if (!spotId) {
      setWidgets([])
      setLoading(false)
      setError(null)
      return
    }
    let mounted = true
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const loaded = await loadInjectionWidgetsForSpot(spotId)
        if (!mounted) return
        const widgetList: LoadedWidget[] = loaded.map((w) => ({
          widgetId: w.metadata.id,
          module: w,
          moduleId: w.moduleId,
          key: w.key,
          placement: w.placement,
        }))
        setWidgets(widgetList)
        
        // Trigger onLoad for all widgets
        if (!loadedRef.current && options?.triggerOnLoad) {
          loadedRef.current = true
          for (const widget of widgetList) {
            if (widget.module.eventHandlers?.onLoad) {
              try {
                await widget.module.eventHandlers.onLoad(options.context as TContext)
                options.onEvent?.('onLoad', widget.widgetId)
              } catch (err) {
                console.error(`[InjectionSpot] Error in onLoad for widget ${widget.widgetId}:`, err)
              }
            }
          }
        }
      } catch (err) {
        if (!mounted) return
        console.error(`[InjectionSpot] Failed to load widgets for spot ${spotId}:`, err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [spotId, options?.context, options?.triggerOnLoad, options?.onEvent])

  return { widgets, loading, error }
}

export function InjectionSpot<TContext = unknown, TData = unknown>({
  spotId,
  context,
  data,
  onDataChange,
  disabled,
  onEvent,
  widgetsOverride,
}: InjectionSpotProps<TContext, TData>) {
  const useSpotId = widgetsOverride ? null : spotId
  const { widgets, loading, error } = useInjectionWidgets<TContext>(useSpotId, {
    context,
    triggerOnLoad: !widgetsOverride,
    onEvent: onEvent ? (event, id) => onEvent(event, id) : undefined,
  })
  const effectiveWidgets = widgetsOverride ?? widgets
  const effectiveLoading = widgetsOverride ? false : loading
  const effectiveError = widgetsOverride ? null : error

  if (effectiveLoading) {
    return null
  }

  if (effectiveError) {
    console.error(`[InjectionSpot] Error loading widgets for spot ${spotId}:`, effectiveError)
    return null
  }

  if (effectiveWidgets.length === 0) {
    return null
  }

  return (
    <>
      {effectiveWidgets.map((widget) => {
        const { Widget } = widget.module
        return (
          <Widget
            key={widget.widgetId}
            context={context}
            data={data}
            onDataChange={onDataChange}
            disabled={disabled}
          />
        )
      })}
    </>
  )
}

/**
 * Hook to trigger injection widget events imperatively
 */
export function useInjectionSpotEvents<TContext = unknown, TData = unknown>(spotId: InjectionSpotId, prefetchedWidgets?: LoadedWidget[]) {
  const [widgets, setWidgets] = React.useState<LoadedWidget[]>([])

  React.useEffect(() => {
    if (prefetchedWidgets && prefetchedWidgets.length) {
      setWidgets(prefetchedWidgets)
      return
    }
    let mounted = true
    const load = async () => {
      try {
        const loaded = await loadInjectionWidgetsForSpot(spotId)
        if (!mounted) return
        setWidgets(
          loaded.map((w) => ({
            widgetId: w.metadata.id,
            module: w,
            moduleId: w.moduleId,
            key: w.key,
            placement: w.placement,
          }))
        )
      } catch (err) {
        console.error(`[useInjectionSpotEvents] Failed to load widgets for spot ${spotId}:`, err)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [spotId, prefetchedWidgets])

  const triggerEvent = React.useCallback(
    async (
      event: keyof WidgetInjectionEventHandlers<TContext, TData>,
      data: TData,
      context: TContext
    ): Promise<{ ok: boolean; message?: string; fieldErrors?: Record<string, string> }> => {
      const normalizeBeforeSave = (result: WidgetBeforeSaveResult): { ok: boolean; message?: string; fieldErrors?: Record<string, string> } => {
        if (result === false) return { ok: false }
        if (result === true || typeof result === 'undefined') return { ok: true }
        if (result && typeof result === 'object') {
          const ok = typeof result.ok === 'boolean' ? result.ok : true
          const message = typeof result.message === 'string' ? result.message : undefined
          const fieldErrors =
            result.fieldErrors && typeof result.fieldErrors === 'object'
              ? Object.fromEntries(
                  Object.entries(result.fieldErrors).map(([key, value]) => [key, String(value)]),
                )
              : undefined
          return { ok, message, fieldErrors }
        }
        return { ok: true }
      }

      for (const widget of widgets) {
        const handler = widget.module.eventHandlers?.[event]
        if (handler) {
          try {
            const result = await (handler as any)(data, context)
            if (event === 'onBeforeSave') {
              const normalized = normalizeBeforeSave(result as WidgetBeforeSaveResult)
              if (!normalized.ok) {
                console.log(`[useInjectionSpotEvents] Widget ${widget.widgetId} prevented ${event}`)
                return normalized
              }
            }
          } catch (err) {
            console.error(`[useInjectionSpotEvents] Error in ${event} for widget ${widget.widgetId}:`, err)
            if (event === 'onBeforeSave') {
              const message =
                err instanceof Error
                  ? err.message || 'Validation blocked'
                  : typeof err === 'string'
                    ? err
                    : undefined
              return { ok: false, message }
            }
          }
        }
      }
      return { ok: true }
    },
    [widgets]
  )

  return { triggerEvent, widgets }
}
