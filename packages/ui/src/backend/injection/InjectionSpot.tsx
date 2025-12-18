"use client"
import * as React from 'react'
import type { InjectionSpotId, InjectionWidgetModule, WidgetInjectionEventHandlers } from '@open-mercato/shared/modules/widgets/injection'
import { loadInjectionWidgetsForSpot } from '@open-mercato/core/modules/widgets/lib/injection'

export type InjectionSpotProps<TContext = unknown, TData = unknown> = {
  spotId: InjectionSpotId
  context: TContext
  data?: TData
  onDataChange?: (data: TData) => void
  disabled?: boolean
  onEvent?: (event: 'onLoad' | 'onBeforeSave' | 'onSave' | 'onAfterSave', widgetId: string) => void
}

type LoadedWidget = {
  widgetId: string
  module: InjectionWidgetModule<any, any>
  moduleId: string
  key: string
}

export function InjectionSpot<TContext = unknown, TData = unknown>({
  spotId,
  context,
  data,
  onDataChange,
  disabled,
  onEvent,
}: InjectionSpotProps<TContext, TData>) {
  const [widgets, setWidgets] = React.useState<LoadedWidget[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const loadedRef = React.useRef(false)

  React.useEffect(() => {
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
        }))
        setWidgets(widgetList)
        
        // Trigger onLoad for all widgets
        if (!loadedRef.current) {
          loadedRef.current = true
          for (const widget of widgetList) {
            if (widget.module.eventHandlers?.onLoad) {
              try {
                await widget.module.eventHandlers.onLoad(context)
                onEvent?.('onLoad', widget.widgetId)
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
  }, [spotId, context, onEvent])

  if (loading) {
    return null
  }

  if (error) {
    console.error(`[InjectionSpot] Error loading widgets for spot ${spotId}:`, error)
    return null
  }

  if (widgets.length === 0) {
    return null
  }

  return (
    <>
      {widgets.map((widget) => {
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
export function useInjectionSpotEvents<TContext = unknown, TData = unknown>(spotId: InjectionSpotId) {
  const [widgets, setWidgets] = React.useState<LoadedWidget[]>([])

  React.useEffect(() => {
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
  }, [spotId])

  const triggerEvent = React.useCallback(
    async (
      event: keyof WidgetInjectionEventHandlers<TContext, TData>,
      data: TData,
      context: TContext
    ): Promise<boolean> => {
      for (const widget of widgets) {
        const handler = widget.module.eventHandlers?.[event]
        if (handler) {
          try {
            const result = await (handler as any)(data, context)
            // If onBeforeSave returns false, prevent the action
            if (event === 'onBeforeSave' && result === false) {
              console.log(`[useInjectionSpotEvents] Widget ${widget.widgetId} prevented ${event}`)
              return false
            }
          } catch (err) {
            console.error(`[useInjectionSpotEvents] Error in ${event} for widget ${widget.widgetId}:`, err)
            // For onBeforeSave, treat errors as preventing the action
            if (event === 'onBeforeSave') {
              return false
            }
          }
        }
      }
      return true
    },
    [widgets]
  )

  return { triggerEvent, widgets }
}
