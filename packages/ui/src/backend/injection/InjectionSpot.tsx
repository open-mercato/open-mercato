"use client"
import * as React from 'react'
import type {
  InjectionSpotId,
  InjectionWidgetModule,
  WidgetInjectionEventHandlers,
  WidgetBeforeDeleteResult,
  WidgetBeforeSaveResult,
  FieldChangeResult,
  NavigateGuardResult,
} from '@open-mercato/shared/modules/widgets/injection'
import {
  getInjectionRegistryVersion,
  loadInjectionWidgetsForSpot,
  subscribeToInjectionRegistryChanges,
  type LoadedInjectionWidget,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '../BackendChromeProvider'
import { getWidgetSharedState } from './WidgetSharedState'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('ui').child({ component: 'InjectionSpot' })

export type InjectionSpotProps<TContext = unknown, TData = unknown> = {
  spotId: InjectionSpotId
  context: TContext
  data?: TData
  onDataChange?: (data: TData) => void
  disabled?: boolean
  onEvent?: (
    event: keyof WidgetInjectionEventHandlers<TContext, TData>,
    widgetId: string,
  ) => void
  widgetsOverride?: LoadedWidget[]
}

/**
 * Transformer events use pipeline dispatch: output of widget N becomes input of widget N+1.
 */
const TRANSFORMER_EVENTS = new Set<string>([
  'transformFormData',
  'transformDisplayData',
  'transformValidation',
])

type LoadedWidget = {
  widgetId: string
  module: InjectionWidgetModule<any, any>
  moduleId: string
  key: string
  placement?: LoadedInjectionWidget['placement']
}

export type LoadedInjectionSpotWidget = LoadedWidget

function toLoadedWidget(widget: LoadedInjectionWidget): LoadedWidget {
  return {
    widgetId: widget.metadata.id,
    module: widget,
    moduleId: widget.moduleId,
    key: widget.key,
    placement: widget.placement,
  }
}

function hasGrantedWidgetFeatures(
  widget: LoadedWidget,
  grantedFeatures: string[],
  hasBackendChromePayload: boolean,
): boolean {
  if (!hasBackendChromePayload) return true
  const features = widget.module.metadata.features ?? []
  return features.length === 0 || hasAllFeatures(grantedFeatures, features)
}

function filterWidgetsByGrantedFeatures(
  widgets: LoadedWidget[],
  grantedFeatures: string[],
  hasBackendChromePayload: boolean,
): LoadedWidget[] {
  return widgets.filter((widget) => hasGrantedWidgetFeatures(widget, grantedFeatures, hasBackendChromePayload))
}

function areSameLoadedWidgets(current: LoadedWidget[], next: LoadedWidget[]): boolean {
  if (current.length !== next.length) return false
  return current.every((widget, index) => {
    const nextWidget = next[index]
    return (
      nextWidget !== undefined &&
      widget.widgetId === nextWidget.widgetId &&
      widget.moduleId === nextWidget.moduleId &&
      widget.key === nextWidget.key &&
      widget.module === nextWidget.module
    )
  })
}

function setWidgetsIfChanged(
  setWidgets: React.Dispatch<React.SetStateAction<LoadedWidget[]>>,
  next: LoadedWidget[],
) {
  setWidgets((current) => (areSameLoadedWidgets(current, next) ? current : next))
}

function injectSharedStateIntoContext<TContext>(context: TContext, moduleId: string): TContext {
  const sharedState = getWidgetSharedState(moduleId)
  if (typeof context === 'object' && context !== null && !Array.isArray(context)) {
    return {
      ...(context as Record<string, unknown>),
      sharedState,
    } as TContext
  }
  return {
    value: context,
    sharedState,
  } as TContext
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
  const [registryVersion, setRegistryVersion] = React.useState(() => getInjectionRegistryVersion())
  const loadedWidgetIdsRef = React.useRef(new Set<string>())
  const contextRef = React.useRef(options?.context)
  const triggerOnLoadRef = React.useRef(options?.triggerOnLoad)
  const onEventRef = React.useRef(options?.onEvent)
  const { payload, isReady: backendChromeReady } = useBackendChrome()
  const grantedFeatureList = React.useMemo(
    () => payload?.grantedFeatures ?? [],
    [payload?.grantedFeatures],
  )
  const hasBackendChromePayload = payload !== null

  React.useEffect(() => {
    contextRef.current = options?.context
    triggerOnLoadRef.current = options?.triggerOnLoad
    onEventRef.current = options?.onEvent
  })

  React.useEffect(() => {
    return subscribeToInjectionRegistryChanges(() => {
      setRegistryVersion(getInjectionRegistryVersion())
    })
  }, [])

  React.useEffect(() => {
    if (!spotId) {
      setWidgets([])
      setLoading(false)
      setError(null)
      return
    }
    if (!backendChromeReady) {
      setLoading(true)
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
        const widgetList = filterWidgetsByGrantedFeatures(
          loaded.map(toLoadedWidget),
          grantedFeatureList,
          hasBackendChromePayload,
        )
        setWidgets(widgetList)

        // Trigger onLoad for all widgets
        if (triggerOnLoadRef.current) {
          for (const widget of widgetList) {
            if (loadedWidgetIdsRef.current.has(widget.widgetId)) continue
            loadedWidgetIdsRef.current.add(widget.widgetId)
            if (widget.module.eventHandlers?.onLoad) {
              try {
                const widgetContext = injectSharedStateIntoContext(contextRef.current as TContext, widget.moduleId)
                await widget.module.eventHandlers.onLoad(widgetContext)
                onEventRef.current?.('onLoad', widget.widgetId)
              } catch (err) {
                logger.error('Error in onLoad for widget', { widgetId: widget.widgetId, err })
              }
            }
          }
        }
      } catch (err) {
        if (!mounted) return
        logger.error('Failed to load widgets for spot', { spotId, err })
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
    // context/triggerOnLoad/onEvent are read from refs so only a real registry-version bump reloads the spot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotId, registryVersion, backendChromeReady, grantedFeatureList, hasBackendChromePayload])

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
  const hasWidgetsOverride = widgetsOverride !== undefined
  const useSpotId = hasWidgetsOverride ? null : spotId
  const onEventRef = React.useRef(onEvent)
  React.useEffect(() => {
    onEventRef.current = onEvent
  })
  const hasOnEvent = Boolean(onEvent)
  const stableOnEvent = React.useMemo(
    () => (hasOnEvent ? (event: 'onLoad', id: string) => onEventRef.current?.(event, id) : undefined),
    [hasOnEvent],
  )
  const { widgets, loading, error } = useInjectionWidgets<TContext>(useSpotId, {
    context,
    triggerOnLoad: !hasWidgetsOverride,
    onEvent: stableOnEvent,
  })
  const { payload: overrideFeaturePayload, isReady: overrideBackendChromeReady } = useBackendChrome()
  const overrideGrantedFeatureList = React.useMemo(
    () => overrideFeaturePayload?.grantedFeatures ?? [],
    [overrideFeaturePayload?.grantedFeatures],
  )
  const overrideHasBackendChromePayload = overrideFeaturePayload !== null
  const filteredWidgetsOverride = React.useMemo(
    () =>
      widgetsOverride === undefined
        ? undefined
        : filterWidgetsByGrantedFeatures(
            widgetsOverride,
            overrideGrantedFeatureList,
            overrideHasBackendChromePayload,
          ),
    [widgetsOverride, overrideGrantedFeatureList, overrideHasBackendChromePayload],
  )
  const effectiveWidgets = hasWidgetsOverride
    ? (overrideBackendChromeReady ? filteredWidgetsOverride ?? [] : [])
    : widgets
  const effectiveLoading = hasWidgetsOverride ? !overrideBackendChromeReady : loading
  const effectiveError = hasWidgetsOverride ? null : error

  if (effectiveLoading && effectiveWidgets.length === 0) {
    return null
  }

  if (effectiveError) {
    logger.error('Error loading widgets for spot', { spotId, err: effectiveError })
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
            context={injectSharedStateIntoContext(context, widget.moduleId)}
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
  const [registryVersion, setRegistryVersion] = React.useState(() => getInjectionRegistryVersion())
  const { payload, isReady: backendChromeReady } = useBackendChrome()
  const grantedFeatureList = React.useMemo(
    () => payload?.grantedFeatures ?? [],
    [payload?.grantedFeatures],
  )
  const hasBackendChromePayload = payload !== null

  React.useEffect(() => {
    return subscribeToInjectionRegistryChanges(() => {
      setRegistryVersion(getInjectionRegistryVersion())
    })
  }, [])

  React.useEffect(() => {
    if (!backendChromeReady) {
      setWidgetsIfChanged(setWidgets, [])
      return
    }
    if (prefetchedWidgets !== undefined) {
      setWidgetsIfChanged(
        setWidgets,
        filterWidgetsByGrantedFeatures(prefetchedWidgets, grantedFeatureList, hasBackendChromePayload),
      )
      return
    }
    let mounted = true
    const load = async () => {
      try {
        const loaded = await loadInjectionWidgetsForSpot(spotId)
        if (!mounted) return
        setWidgetsIfChanged(
          setWidgets,
          filterWidgetsByGrantedFeatures(
            loaded.map(toLoadedWidget),
            grantedFeatureList,
            hasBackendChromePayload,
          )
        )
      } catch (err) {
        logger.error('Failed to load widgets for spot', { hook: 'useInjectionSpotEvents', spotId, err })
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [spotId, prefetchedWidgets, registryVersion, backendChromeReady, grantedFeatureList, hasBackendChromePayload])

  const triggerEvent = React.useCallback(
    async (
      event: keyof WidgetInjectionEventHandlers<TContext, TData>,
      data: TData,
      context: TContext,
      meta?: {
        error?: unknown
        fieldId?: string
        fieldValue?: unknown
        originalData?: TData
        target?: unknown
        visible?: boolean
        appEvent?: unknown
      }
    ): Promise<{
      ok: boolean
      message?: string
      fieldErrors?: Record<string, string>
      requestHeaders?: Record<string, string>
      details?: unknown
      data?: TData
      applyToForm?: boolean
      fieldChange?: {
        value?: unknown
        sideEffects?: Record<string, unknown>
        messages?: Array<{ text: string; severity: 'info' | 'warning' | 'error' }>
      }
    }> => {
      const normalizeBeforeSave = (
        result: WidgetBeforeSaveResult,
      ): { ok: boolean; message?: string; fieldErrors?: Record<string, string>; requestHeaders?: Record<string, string>; details?: unknown } => {
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
          const requestHeaders =
            result.requestHeaders && typeof result.requestHeaders === 'object'
              ? Object.fromEntries(
                  Object.entries(result.requestHeaders).map(([key, value]) => [key, String(value)]),
                )
              : undefined
          return { ok, message, fieldErrors, requestHeaders, details: result.details }
        }
        return { ok: true }
      }

      const normalizeBeforeDelete = (
        result: WidgetBeforeDeleteResult,
      ): { ok: boolean; message?: string; fieldErrors?: Record<string, string>; requestHeaders?: Record<string, string>; details?: unknown } => {
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
          const requestHeaders =
            result.requestHeaders && typeof result.requestHeaders === 'object'
              ? Object.fromEntries(
                  Object.entries(result.requestHeaders).map(([key, value]) => [key, String(value)]),
                )
              : undefined
          return { ok, message, fieldErrors, requestHeaders, details: result.details }
        }
        return { ok: true }
      }

      // --- Transformer events: pipeline dispatch ---
      // Output of widget N becomes input of widget N+1
      if (TRANSFORMER_EVENTS.has(event)) {
        let pipelineData = data
        let applyToForm = false
        for (const widget of widgets) {
          const handler = widget.module.eventHandlers?.[event]
          if (!handler) continue
          try {
            const widgetContext = injectSharedStateIntoContext(context, widget.moduleId)
            let handlerResult: unknown
            if (event === 'transformValidation') {
              handlerResult = await (handler as any)(pipelineData, meta?.originalData ?? data, widgetContext)
            } else {
              handlerResult = await (handler as any)(pipelineData, widgetContext)
            }
            if (
              event === 'transformFormData' &&
              handlerResult !== null &&
              typeof handlerResult === 'object' &&
              'applyToForm' in handlerResult &&
              (handlerResult as { applyToForm: unknown }).applyToForm === true &&
              'data' in handlerResult
            ) {
              pipelineData = (handlerResult as { data: TData }).data
              applyToForm = true
            } else {
              pipelineData = handlerResult as TData
            }
          } catch (err) {
            logger.error('Error in event handler for widget', { hook: 'useInjectionSpotEvents', event, widgetId: widget.widgetId, err })
          }
        }
        return { ok: true, data: pipelineData, applyToForm }
      }

      // --- Action events: sequential dispatch ---
      const mergedRequestHeaders: Record<string, string> = {}
      let hasRequestHeaders = false
      let fieldValue = meta?.fieldValue
      let fieldSideEffects: Record<string, unknown> | undefined
      let fieldMessages: Array<{ text: string; severity: 'info' | 'warning' | 'error' }> | undefined

      for (const widget of widgets) {
        const eventHandlers = widget.module.eventHandlers
        // Check operation filter — skip widget if current operation is filtered out
        const operationFilter = eventHandlers?.filter?.operations
        if (operationFilter) {
          const currentOperation = (context as Record<string, unknown>)?.operation as string | undefined
          if (currentOperation && !operationFilter.includes(currentOperation as 'create' | 'update' | 'delete')) {
            continue
          }
        }
        let handler = eventHandlers?.[event]
        // Delete-to-save fallback chain
        if (!handler && event === 'onBeforeDelete') handler = eventHandlers?.onBeforeSave as typeof handler
        if (!handler && event === 'onDelete') handler = eventHandlers?.onSave as typeof handler
        if (!handler && event === 'onAfterDelete') handler = eventHandlers?.onAfterSave as typeof handler
        if (handler) {
          try {
            const widgetContext = injectSharedStateIntoContext(context, widget.moduleId)
            const result =
              event === 'onDeleteError'
                ? await (handler as any)(data, widgetContext, meta?.error)
                : event === 'onFieldChange'
                  ? await (handler as any)(meta?.fieldId, fieldValue, data, widgetContext)
                  : event === 'onBeforeNavigate'
                    ? await (handler as any)(meta?.target, widgetContext)
                    : event === 'onVisibilityChange'
                      ? await (handler as any)(meta?.visible, widgetContext)
                      : event === 'onAppEvent'
                        ? await (handler as any)(meta?.appEvent, widgetContext)
                        : await (handler as any)(data, widgetContext)
            if (event === 'onBeforeSave') {
              const normalized = normalizeBeforeSave(result as WidgetBeforeSaveResult)
              if (!normalized.ok) {
                logger.info('Widget prevented event', { hook: 'useInjectionSpotEvents', widgetId: widget.widgetId, event })
                return normalized
              }
              if (normalized.requestHeaders && Object.keys(normalized.requestHeaders).length > 0) {
                Object.assign(mergedRequestHeaders, normalized.requestHeaders)
                hasRequestHeaders = true
              }
            }
            if (event === 'onBeforeDelete') {
              const normalized = normalizeBeforeDelete(result as WidgetBeforeDeleteResult)
              if (!normalized.ok) {
                logger.info('Widget prevented event', { hook: 'useInjectionSpotEvents', widgetId: widget.widgetId, event })
                return normalized
              }
              if (normalized.requestHeaders && Object.keys(normalized.requestHeaders).length > 0) {
                Object.assign(mergedRequestHeaders, normalized.requestHeaders)
                hasRequestHeaders = true
              }
            }
            if (event === 'onBeforeNavigate') {
              const navResult = result as NavigateGuardResult | undefined
              if (navResult && navResult.ok === false) {
                return { ok: false, message: navResult.message }
              }
            }
            if (event === 'onFieldChange') {
              const changeResult = result as FieldChangeResult | void
              if (changeResult?.value !== undefined) {
                fieldValue = changeResult.value
              }
              if (changeResult?.sideEffects && typeof changeResult.sideEffects === 'object') {
                fieldSideEffects = { ...(fieldSideEffects ?? {}), ...changeResult.sideEffects }
              }
              if (changeResult?.message?.text) {
                fieldMessages = [...(fieldMessages ?? []), changeResult.message]
              }
            }
          } catch (err) {
            logger.error('Error in event handler for widget', { hook: 'useInjectionSpotEvents', event, widgetId: widget.widgetId, err })
            if (event === 'onBeforeSave' || event === 'onBeforeDelete' || event === 'onBeforeNavigate') {
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
      if ((event === 'onBeforeSave' || event === 'onBeforeDelete') && hasRequestHeaders) {
        return { ok: true, requestHeaders: mergedRequestHeaders }
      }
      if (event === 'onFieldChange') {
        return {
          ok: true,
          fieldChange: {
            value: fieldValue,
            sideEffects: fieldSideEffects,
            messages: fieldMessages,
          },
        }
      }
      return { ok: true }
    },
    [widgets]
  )

  return { triggerEvent, widgets }
}
