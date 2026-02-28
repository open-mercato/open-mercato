import * as React from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { ZodType } from 'zod'
import { hasAllFeatures } from '../../security/features'

export type ComponentRegistryEntry<TProps = unknown> = {
  id: string
  component: ComponentType<TProps>
  metadata: {
    module: string
    description?: string
    propsSchema?: ZodType<TProps>
  }
}

export type ComponentOverride<TProps = unknown> = {
  target: { componentId: string }
  priority: number
  features?: string[]
  metadata?: {
    module?: string
  }
} & (
  | {
      replacement: LazyExoticComponent<ComponentType<TProps>> | ComponentType<TProps>
      propsSchema: ZodType<TProps>
    }
  | {
      wrapper: (Original: ComponentType<TProps>) => ComponentType<TProps>
    }
  | {
      propsTransform: (props: TProps) => TProps
    }
)

type RuntimeState = {
  components: Map<string, ComponentRegistryEntry>
  overrides: ComponentOverride[]
}

const GLOBAL_COMPONENT_REGISTRY_KEY = '__openMercatoComponentRegistry__'

function getState(): RuntimeState {
  const globalValue = (globalThis as Record<string, unknown>)[GLOBAL_COMPONENT_REGISTRY_KEY]
  if (globalValue && typeof globalValue === 'object') {
    const typed = globalValue as RuntimeState
    if (typed.components instanceof Map && Array.isArray(typed.overrides)) {
      return typed
    }
  }
  const initial: RuntimeState = {
    components: new Map<string, ComponentRegistryEntry>(),
    overrides: [],
  }
  ;(globalThis as Record<string, unknown>)[GLOBAL_COMPONENT_REGISTRY_KEY] = initial
  return initial
}

export function registerComponent<TProps = unknown>(entry: ComponentRegistryEntry<TProps>) {
  const state = getState()
  state.components.set(entry.id, entry as ComponentRegistryEntry)
}

export function registerComponentOverrides(overrides: ComponentOverride[]) {
  const state = getState()
  state.overrides = [...overrides]
}

export function getComponentEntry(componentId: string): ComponentRegistryEntry | null {
  const state = getState()
  return state.components.get(componentId) ?? null
}

export function getComponentOverrides(componentId: string, userFeatures?: readonly string[]): ComponentOverride[] {
  const state = getState()
  const relevant = state.overrides.filter((override) => {
    if (override.target.componentId !== componentId) return false
    if (override.features && override.features.length > 0) {
      if (!hasAllFeatures(userFeatures, override.features)) return false
    }
    return true
  })
  return relevant.sort((a, b) => a.priority - b.priority)
}

export function resolveRegisteredComponent<TProps>(
  componentId: string,
  fallback: ComponentType<TProps>,
  userFeatures?: readonly string[],
): ComponentType<TProps> {
  const overrides = getComponentOverrides(componentId, userFeatures)
  let resolved: ComponentType<TProps> = fallback
  for (const override of overrides) {
    if ('replacement' in override) {
      resolved = override.replacement as ComponentType<TProps>
      continue
    }
    if ('wrapper' in override) {
      resolved = override.wrapper(resolved as ComponentType<unknown>) as ComponentType<TProps>
      continue
    }
    if ('propsTransform' in override) {
      const transform = override.propsTransform as (props: TProps) => TProps
      const Current = resolved
      resolved = ((props: TProps) => {
        const transformed = transform(props)
        return React.createElement(Current as ComponentType<Record<string, unknown>>, transformed as Record<string, unknown>)
      }) as ComponentType<TProps>
    }
  }
  return resolved
}

export const ComponentReplacementHandles = {
  page: (path: string) => `page:${path}`,
  dataTable: (tableId: string) => `data-table:${tableId}`,
  crudForm: (entityId: string) => `crud-form:${entityId}`,
  section: (scope: string, sectionId: string) => `section:${scope}.${sectionId}`,
} as const
