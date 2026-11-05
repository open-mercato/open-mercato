export type UmesExtensionType =
  | 'enricher'
  | 'interceptor'
  | 'component-override'
  | 'injection-widget'
  | 'injection-data-widget'

export interface UmesExtensionPointInfo {
  type: UmesExtensionType
  id: string
  moduleId: string
  target: string
  priority: number
  features?: string[]
}

export interface UmesEnricherInfo extends UmesExtensionPointInfo {
  type: 'enricher'
  targetEntity: string
  timeout?: number
  critical?: boolean
  hasCacheConfig: boolean
  hasQueryEngineConfig: boolean
}

export interface UmesInterceptorInfo extends UmesExtensionPointInfo {
  type: 'interceptor'
  targetRoute: string
  methods: string[]
  hasBefore: boolean
  hasAfter: boolean
}

export interface UmesComponentOverrideInfo extends UmesExtensionPointInfo {
  type: 'component-override'
  componentId: string
  overrideKind: 'replacement' | 'wrapper' | 'propsTransform'
}

export interface UmesInjectionWidgetInfo extends UmesExtensionPointInfo {
  type: 'injection-widget' | 'injection-data-widget'
  spotId: string
  hasEventHandlers: boolean
}

export type UmesExtensionInfo =
  | UmesEnricherInfo
  | UmesInterceptorInfo
  | UmesComponentOverrideInfo
  | UmesInjectionWidgetInfo

export type ConflictSeverity = 'error' | 'warning'

export interface UmesConflict {
  severity: ConflictSeverity
  type: string
  message: string
  moduleIds: string[]
  target: string
  details?: Record<string, unknown>
}

export interface UmesConflictResult {
  errors: UmesConflict[]
  warnings: UmesConflict[]
}

export interface EnricherTimingEntry {
  enricherId: string
  moduleId: string
  targetEntity: string
  durationMs: number
  timestamp: number
}

export interface InterceptorActivityEntry {
  interceptorId: string
  moduleId: string
  route: string
  method: string
  result: 'allowed' | 'blocked' | 'modified'
  durationMs: number
  timestamp: number
  statusCode?: number
  message?: string
}

export interface EventFlowEntry {
  eventName: string
  widgetId: string
  moduleId: string
  result: 'allowed' | 'blocked' | 'error'
  timestamp: number
  durationMs?: number
}

export interface UmesDevToolsData {
  extensions: UmesExtensionInfo[]
  conflicts: UmesConflict[]
  enricherTimings: EnricherTimingEntry[]
  interceptorActivity: InterceptorActivityEntry[]
  eventFlow: EventFlowEntry[]
  componentReplacements: UmesComponentOverrideInfo[]
}

export interface EnricherResponseMeta {
  enrichedBy: string[]
}
