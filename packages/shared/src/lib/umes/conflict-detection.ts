import type { UmesConflict, UmesConflictResult } from './devtools-types'

export interface ComponentOverrideInput {
  moduleId: string
  componentId: string
  priority: number
}

export interface InterceptorInput {
  moduleId: string
  id: string
  targetRoute: string
  methods: string[]
  priority: number
}

export interface InjectionTableInput {
  moduleId: string
  spotId: string
  widgetId: string
  dependsOn?: string[]
}

export interface GatedExtensionInput {
  moduleId: string
  extensionId: string
  features: string[]
}

export interface ConflictDetectionInput {
  componentOverrides?: ComponentOverrideInput[]
  interceptors?: InterceptorInput[]
  injectionTables?: InjectionTableInput[]
  gatedExtensions?: GatedExtensionInput[]
  declaredFeatures?: Set<string>
}

export function detectComponentOverrideConflicts(
  overrides: ComponentOverrideInput[],
): UmesConflict[] {
  const conflicts: UmesConflict[] = []
  const byComponentAndPriority = new Map<string, ComponentOverrideInput[]>()

  for (const override of overrides) {
    const key = `${override.componentId}\0${override.priority}`
    const existing = byComponentAndPriority.get(key)
    if (existing) {
      existing.push(override)
    } else {
      byComponentAndPriority.set(key, [override])
    }
  }

  for (const [, entries] of byComponentAndPriority) {
    if (entries.length > 1) {
      const moduleIds = [...new Set(entries.map((e) => e.moduleId))]
      if (moduleIds.length > 1) {
        conflicts.push({
          severity: 'error',
          type: 'duplicate-component-override',
          message: `Conflict: modules ${moduleIds.join(' and ')} both replace component "${entries[0].componentId}" at priority ${entries[0].priority}`,
          moduleIds,
          target: entries[0].componentId,
          details: { priority: entries[0].priority },
        })
      }
    }
  }

  return conflicts
}

export function detectInterceptorConflicts(
  interceptors: InterceptorInput[],
): UmesConflict[] {
  const conflicts: UmesConflict[] = []
  const byRouteMethodPriority = new Map<string, InterceptorInput[]>()

  for (const interceptor of interceptors) {
    for (const method of interceptor.methods) {
      const key = `${interceptor.targetRoute}\0${method}\0${interceptor.priority}`
      const existing = byRouteMethodPriority.get(key)
      if (existing) {
        existing.push(interceptor)
      } else {
        byRouteMethodPriority.set(key, [interceptor])
      }
    }
  }

  for (const [key, entries] of byRouteMethodPriority) {
    if (entries.length > 1) {
      const [route, method] = key.split('\0')
      const moduleIds = [...new Set(entries.map((e) => e.moduleId))]
      if (moduleIds.length > 1) {
        conflicts.push({
          severity: 'warning',
          type: 'duplicate-interceptor-priority',
          message: `Multiple interceptors on ${method.toUpperCase()} ${route} at priority ${entries[0].priority}: ${moduleIds.join(', ')}`,
          moduleIds,
          target: `${method.toUpperCase()} ${route}`,
          details: { priority: entries[0].priority, method, route },
        })
      }
    }
  }

  return conflicts
}

export function detectCircularWidgetDependencies(
  tables: InjectionTableInput[],
): UmesConflict[] {
  const conflicts: UmesConflict[] = []
  const graph = new Map<string, string[]>()

  for (const entry of tables) {
    if (entry.dependsOn && entry.dependsOn.length > 0) {
      const existing = graph.get(entry.widgetId) ?? []
      existing.push(...entry.dependsOn)
      graph.set(entry.widgetId, existing)
    }
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(node: string, path: string[]): string[] | null {
    if (inStack.has(node)) {
      return [...path, node]
    }
    if (visited.has(node)) {
      return null
    }

    visited.add(node)
    inStack.add(node)

    const deps = graph.get(node) ?? []
    for (const dep of deps) {
      const cycle = dfs(dep, [...path, node])
      if (cycle) return cycle
    }

    inStack.delete(node)
    return null
  }

  for (const widgetId of graph.keys()) {
    if (!visited.has(widgetId)) {
      const cycle = dfs(widgetId, [])
      if (cycle) {
        const cycleStart = cycle[cycle.length - 1]
        const cycleStartIdx = cycle.indexOf(cycleStart)
        const cyclePath = cycle.slice(cycleStartIdx)

        conflicts.push({
          severity: 'error',
          type: 'circular-widget-dependency',
          message: `Circular widget dependency: ${cyclePath.join(' -> ')}`,
          moduleIds: [],
          target: cyclePath.join(' -> '),
        })
        break
      }
    }
  }

  return conflicts
}

export function detectMissingFeatureDeclarations(
  gatedExtensions: GatedExtensionInput[],
  declaredFeatures: Set<string>,
): UmesConflict[] {
  const conflicts: UmesConflict[] = []

  for (const ext of gatedExtensions) {
    for (const feature of ext.features) {
      if (!declaredFeatures.has(feature)) {
        conflicts.push({
          severity: 'warning',
          type: 'missing-feature-declaration',
          message: `Extension "${ext.extensionId}" in module "${ext.moduleId}" references undeclared feature "${feature}"`,
          moduleIds: [ext.moduleId],
          target: ext.extensionId,
          details: { feature },
        })
      }
    }
  }

  return conflicts
}

export function detectConflicts(input: ConflictDetectionInput): UmesConflictResult {
  const allConflicts: UmesConflict[] = []

  if (input.componentOverrides) {
    allConflicts.push(...detectComponentOverrideConflicts(input.componentOverrides))
  }

  if (input.interceptors) {
    allConflicts.push(...detectInterceptorConflicts(input.interceptors))
  }

  if (input.injectionTables) {
    allConflicts.push(...detectCircularWidgetDependencies(input.injectionTables))
  }

  if (input.gatedExtensions && input.declaredFeatures) {
    allConflicts.push(
      ...detectMissingFeatureDeclarations(input.gatedExtensions, input.declaredFeatures),
    )
  }

  return {
    errors: allConflicts.filter((c) => c.severity === 'error'),
    warnings: allConflicts.filter((c) => c.severity === 'warning'),
  }
}
