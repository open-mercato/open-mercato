'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  UmesDevToolsData,
  UmesExtensionInfo,
  UmesComponentOverrideInfo,
} from '@open-mercato/shared/lib/umes/devtools-types'
import { getEnricherTimingEntries } from '@open-mercato/shared/lib/umes/enricher-timing'
import { getInterceptorActivityEntries } from '@open-mercato/shared/lib/umes/interceptor-activity'

const EMPTY_DATA: UmesDevToolsData = {
  extensions: [],
  conflicts: [],
  enricherTimings: [],
  interceptorActivity: [],
  eventFlow: [],
  componentReplacements: [],
}

const isDev = process.env.NODE_ENV === 'development'

export function useUmesDevTools(isActive = true): UmesDevToolsData & { refresh: () => void } {
  const [data, setData] = useState<UmesDevToolsData>(EMPTY_DATA)

  const refresh = useCallback(() => {
    if (!isDev) return
    setData(collectDevToolsData())
  }, [])

  useEffect(() => {
    if (!isDev || !isActive) return
    refresh()

    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [refresh, isActive])

  return { ...(isDev ? data : EMPTY_DATA), refresh }
}

function collectDevToolsData(): UmesDevToolsData {
  const extensions: UmesExtensionInfo[] = []
  const componentReplacements: UmesComponentOverrideInfo[] = []

  // Collect enricher data from global registry
  try {
    const enricherEntries = ((globalThis as Record<string, unknown>).__openMercatoResponseEnrichers__ ?? []) as Array<{
      moduleId: string
      enricher: {
        id: string
        targetEntity: string
        priority?: number
        timeout?: number
        critical?: boolean
        cache?: unknown
        queryEngine?: unknown
        features?: string[]
      }
    }>
    for (const entry of enricherEntries) {
      extensions.push({
        type: 'enricher',
        id: entry.enricher.id,
        moduleId: entry.moduleId,
        target: entry.enricher.targetEntity,
        priority: entry.enricher.priority ?? 0,
        features: entry.enricher.features,
        targetEntity: entry.enricher.targetEntity,
        timeout: entry.enricher.timeout,
        critical: entry.enricher.critical,
        hasCacheConfig: !!entry.enricher.cache,
        hasQueryEngineConfig: !!entry.enricher.queryEngine,
      })
    }
  } catch {
    // enricher registry not available on client
  }

  // Collect interceptor data from global registry
  try {
    const interceptorEntries = ((globalThis as Record<string, unknown>).__openMercatoApiInterceptors__ ?? []) as Array<{
      moduleId: string
      interceptor: {
        id: string
        targetRoute: string
        methods: string[]
        priority?: number
        features?: string[]
        before?: unknown
        after?: unknown
      }
    }>
    for (const entry of interceptorEntries) {
      extensions.push({
        type: 'interceptor',
        id: entry.interceptor.id,
        moduleId: entry.moduleId,
        target: entry.interceptor.targetRoute,
        priority: entry.interceptor.priority ?? 0,
        features: entry.interceptor.features,
        targetRoute: entry.interceptor.targetRoute,
        methods: entry.interceptor.methods,
        hasBefore: !!entry.interceptor.before,
        hasAfter: !!entry.interceptor.after,
      })
    }
  } catch {
    // interceptor registry not available on client
  }

  // Collect component overrides from global registry
  try {
    const globalState = (globalThis as Record<string, unknown>).__openMercatoComponentRegistry__ as {
      overrides?: Array<{
        target: { componentId: string }
        priority: number
        features?: string[]
        metadata?: { module?: string }
        replacement?: unknown
        wrapper?: unknown
        propsTransform?: unknown
      }>
    } | undefined
    if (globalState?.overrides) {
      for (const override of globalState.overrides) {
        const kind = override.replacement
          ? 'replacement' as const
          : override.wrapper
            ? 'wrapper' as const
            : 'propsTransform' as const
        const info: UmesComponentOverrideInfo = {
          type: 'component-override',
          id: `${override.metadata?.module ?? 'unknown'}.${override.target.componentId}`,
          moduleId: override.metadata?.module ?? 'unknown',
          target: override.target.componentId,
          priority: override.priority,
          features: override.features,
          componentId: override.target.componentId,
          overrideKind: kind,
        }
        extensions.push(info)
        componentReplacements.push(info)
      }
    }
  } catch {
    // component registry not available
  }

  // Collect injection widgets from global registry
  try {
    const tables = ((globalThis as Record<string, unknown>).__openMercatoCoreInjectionTables__ ?? []) as Array<{
      moduleId: string
      table: Record<string, unknown>
    }>
    for (const tableEntry of tables) {
      for (const [spotId, value] of Object.entries(tableEntry.table)) {
        const slots = Array.isArray(value) ? value : [value]
        for (const slot of slots) {
          const widgetId = typeof slot === 'string' ? slot : (slot as Record<string, unknown>)?.widgetId
          const priority = typeof slot === 'object' ? ((slot as Record<string, unknown>)?.priority as number) ?? 0 : 0
          if (widgetId) {
            extensions.push({
              type: 'injection-widget',
              id: widgetId as string,
              moduleId: tableEntry.moduleId,
              target: spotId,
              priority,
              spotId,
              hasEventHandlers: false,
            })
          }
        }
      }
    }
  } catch {
    // injection tables not available
  }

  return {
    extensions,
    conflicts: [],
    enricherTimings: getEnricherTimingEntries(),
    interceptorActivity: getInterceptorActivityEntries(),
    eventFlow: [],
    componentReplacements,
  }
}
