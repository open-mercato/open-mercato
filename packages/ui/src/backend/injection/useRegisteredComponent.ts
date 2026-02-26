'use client'

/**
 * Hook to resolve a registered component, applying any overrides.
 *
 * Resolution order:
 * 1. Check for replacement overrides (highest priority wins)
 * 2. Check for wrapper overrides (compose from innermost to outermost)
 * 3. Check for propsTransform overrides (chain transforms)
 * 4. Fall back to original registered component
 *
 * Error boundary: replacement/wrapper components are wrapped in React.ErrorBoundary.
 * On crash, falls back to original component and logs error.
 *
 * Dev mode: validates props against propsSchema on every render (replacement mode).
 * Production: validation skipped for performance.
 *
 * Feature gating: overrides with features[] are only applied when user has features.
 * (Uses ComponentOverrideProvider context for feature set)
 */

import * as React from 'react'
import type { ComponentType } from 'react'
import type {
  ComponentOverrideRegistryEntry,
  ComponentRegistryEntry,
  ReplaceOverride,
  WrapperOverride,
  PropsTransformOverride,
} from '@open-mercato/shared/modules/widgets/component-registry'
import {
  getRegisteredComponent,
  isReplaceOverride,
  isWrapperOverride,
  isPropsTransformOverride,
} from '@open-mercato/shared/modules/widgets/component-registry'
import { useComponentOverrideContext } from './ComponentOverrideProvider'

type ErrorBoundaryProps = {
  fallback: ComponentType<Record<string, unknown>>
  componentId: string
  children: React.ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
}

class ComponentOverrideErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[ComponentOverride] Override for "${this.props.componentId}" crashed, falling back to original.`,
      error,
      errorInfo,
    )
  }

  render() {
    if (this.state.hasError) {
      const Fallback = this.props.fallback
      return React.createElement(Fallback, {})
    }
    return this.props.children
  }
}

function hasAllFeatures(required: string[] | undefined, userFeatures: Set<string>): boolean {
  if (!required || required.length === 0) return true
  return required.every((f) => userFeatures.has(f))
}

function filterOverridesByFeatures(
  overrides: ComponentOverrideRegistryEntry[],
  userFeatures: Set<string>,
): ComponentOverrideRegistryEntry[] {
  return overrides.filter((entry) => hasAllFeatures(entry.override.features, userFeatures))
}

type ResolvedComponent<TProps = Record<string, unknown>> = {
  Component: ComponentType<TProps>
  overrideSource: 'original' | 'replacement' | 'wrapper' | 'props-transform'
  overrideModuleId?: string
}

/**
 * Resolve a registered component with all applicable overrides applied.
 *
 * Returns the resolved component, the type of override applied, and the module
 * that provided the override. Falls back to the original component when no
 * overrides match or when used outside ComponentOverrideProvider.
 */
export function useRegisteredComponent<TProps extends Record<string, unknown> = Record<string, unknown>>(
  componentId: string,
): ResolvedComponent<TProps> | null {
  const overrideContext = useComponentOverrideContext()

  return React.useMemo(() => {
    const entry = getRegisteredComponent(componentId) as ComponentRegistryEntry<TProps> | null
    if (!entry) return null

    const originalComponent = entry.component

    if (!overrideContext) {
      return {
        Component: originalComponent,
        overrideSource: 'original' as const,
      }
    }

    const allOverrides = overrideContext.getOverrides(componentId)
    const gatedOverrides = filterOverridesByFeatures(allOverrides, overrideContext.userFeatures)

    if (gatedOverrides.length === 0) {
      return {
        Component: originalComponent,
        overrideSource: 'original' as const,
      }
    }

    const replacements: Array<{ entry: ComponentOverrideRegistryEntry; override: ReplaceOverride }> = []
    const wrappers: Array<{ entry: ComponentOverrideRegistryEntry; override: WrapperOverride }> = []
    const propsTransforms: Array<{ entry: ComponentOverrideRegistryEntry; override: PropsTransformOverride }> = []

    for (const overrideEntry of gatedOverrides) {
      if (isReplaceOverride(overrideEntry.override)) {
        replacements.push({ entry: overrideEntry, override: overrideEntry.override })
      } else if (isWrapperOverride(overrideEntry.override)) {
        wrappers.push({ entry: overrideEntry, override: overrideEntry.override })
      } else if (isPropsTransformOverride(overrideEntry.override)) {
        propsTransforms.push({ entry: overrideEntry, override: overrideEntry.override })
      }
    }

    // 1. Replacement: highest priority wins
    if (replacements.length > 0) {
      const winner = replacements[replacements.length - 1]
      const ReplacementComponent = winner.override.replacement as unknown as ComponentType<TProps>
      const schema = winner.override.propsSchema

      const WrappedReplacement = React.forwardRef<unknown, TProps>(function ReplacementWithBoundary(props, ref) {
        if (process.env.NODE_ENV === 'development' && schema) {
          const result = schema.safeParse(props)
          if (!result.success) {
            console.warn(
              `[ComponentOverride] Props validation failed for replacement of "${componentId}" by module "${winner.entry.moduleId}":`,
              result.error.format(),
            )
          }
        }

        return React.createElement(
          ComponentOverrideErrorBoundary as any,
          {
            fallback: originalComponent as ComponentType<Record<string, unknown>>,
            componentId,
            children: React.createElement(ReplacementComponent, { ...props, ref }),
          },
        )
      }) as unknown as ComponentType<TProps>

      WrappedReplacement.displayName = `Replacement(${componentId})`

      return {
        Component: WrappedReplacement,
        overrideSource: 'replacement' as const,
        overrideModuleId: winner.entry.moduleId,
      }
    }

    // 2. Wrappers: compose from lowest priority (innermost) to highest (outermost)
    // Overrides are already sorted ascending by priority from the registry
    if (wrappers.length > 0) {
      let composed: ComponentType<Record<string, unknown>> = originalComponent as ComponentType<Record<string, unknown>>
      let lastModuleId = wrappers[0].entry.moduleId

      for (const { entry: wrapperEntry, override } of wrappers) {
        const inner = composed
        composed = override.wrapper(inner)
        lastModuleId = wrapperEntry.moduleId
      }

      const Composed = composed as ComponentType<TProps>

      const WrappedComposed = React.forwardRef<unknown, TProps>(function WrapperWithBoundary(props, ref) {
        return React.createElement(
          ComponentOverrideErrorBoundary as any,
          {
            fallback: originalComponent as ComponentType<Record<string, unknown>>,
            componentId,
            children: React.createElement(Composed, { ...props, ref }),
          },
        )
      }) as unknown as ComponentType<TProps>

      WrappedComposed.displayName = `Wrapped(${componentId})`

      return {
        Component: WrappedComposed,
        overrideSource: 'wrapper' as const,
        overrideModuleId: lastModuleId,
      }
    }

    // 3. PropsTransform: chain transforms, then render original
    if (propsTransforms.length > 0) {
      const transforms = propsTransforms.map((pt) => pt.override.propsTransform)
      const lastModuleId = propsTransforms[propsTransforms.length - 1].entry.moduleId

      const TransformedComponent = React.forwardRef<unknown, TProps>(function PropsTransformWrapper(props, ref) {
        let transformedProps: Record<string, unknown> = { ...props }
        for (const transform of transforms) {
          transformedProps = transform(transformedProps)
        }
        return React.createElement(originalComponent as ComponentType<Record<string, unknown>>, {
          ...transformedProps,
          ref,
        })
      }) as unknown as ComponentType<TProps>

      TransformedComponent.displayName = `PropsTransform(${componentId})`

      return {
        Component: TransformedComponent,
        overrideSource: 'props-transform' as const,
        overrideModuleId: lastModuleId,
      }
    }

    return {
      Component: originalComponent,
      overrideSource: 'original' as const,
    }
  }, [componentId, overrideContext])
}
