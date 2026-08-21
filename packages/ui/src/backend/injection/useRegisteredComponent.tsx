'use client'

import * as React from 'react'
import type { ComponentType } from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { getComponentEntry, getComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'
import { useOverrideRegistryRevision, useOverrideUserFeatures } from './ComponentOverrideProvider'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('ui').child({ component: 'useRegisteredComponent' })

class ReplacementErrorBoundary extends React.Component<
  { fallback: React.ReactNode; onError: (error: unknown) => void; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; onError: (error: unknown) => void; children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: unknown): void {
    this.props.onError(error)
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

type Resolution<TProps> = {
  original: ComponentType<TProps> | null
  wrapped: ComponentType<TProps> | null
  transforms: Array<(props: TProps) => TProps>
  replacementOverride: ComponentOverride | null
  replacementModule: string
}

function resolveComponent<TProps>(
  componentId: string,
  fallback: ComponentType<TProps> | undefined,
  userFeatures: readonly string[],
): Resolution<TProps> {
  const entry = getComponentEntry(componentId)
  const original = (entry?.component as ComponentType<TProps> | undefined) ?? fallback ?? null
  if (!original) {
    if (process.env.NODE_ENV !== 'production' && !fallback) {
      logger.warn('Component is not registered', { componentId })
    }
    return { original: null, wrapped: null, transforms: [], replacementOverride: null, replacementModule: 'unknown' }
  }

  const overrides = getComponentOverrides(componentId, userFeatures)
  const replacementOverrides = overrides.filter((override) => 'replacement' in override)
  if (process.env.NODE_ENV !== 'production' && replacementOverrides.length > 1) {
    logger.warn('Multiple replacements registered; highest-priority replacement is applied', { componentId })
  }

  let replacement: ComponentType<TProps> | null = null
  let replacementOverride: ComponentOverride | null = null
  const wrappers: Array<(Original: ComponentType<TProps>) => ComponentType<TProps>> = []
  const transforms: Array<(props: TProps) => TProps> = []

  for (const override of overrides) {
    if ('replacement' in override) {
      replacement = override.replacement as ComponentType<TProps>
      replacementOverride = override
    }
    if ('wrapper' in override) wrappers.push(override.wrapper as (Original: ComponentType<TProps>) => ComponentType<TProps>)
    if ('propsTransform' in override) transforms.push(override.propsTransform as (props: TProps) => TProps)
  }

  const base = replacement ?? original
  const wrapped = wrappers.reduce<ComponentType<TProps>>((acc, wrapper) => wrapper(acc), base)

  return {
    original,
    wrapped,
    transforms,
    replacementOverride,
    replacementModule: replacementOverride?.metadata?.module ?? 'unknown',
  }
}

/**
 * The returned component's identity must depend only on `componentId` and
 * `fallback` — never on the override registry.
 *
 * Overrides arrive asynchronously: `ComponentOverridesBootstrap` dynamically
 * imports the generated override module and hands the provider a fresh array,
 * which bumps the registry revision some time after first paint. Resolving the
 * component in a `useMemo` keyed on that revision handed callers a brand-new
 * function on every bump, so React saw a different element type at that
 * position and unmounted the whole subtree — discarding its DOM and state. On
 * the login form that threw away credentials the user had already typed
 * (#5037), and the same hazard applied to every host of a registered section.
 *
 * Resolution therefore happens *inside* a stable component. When the revision
 * carries no override for this id, `wrapped` keeps its previous identity and
 * React reconciles in place; only a genuine replacement or wrapper swaps the
 * rendered type, where a remount is the correct behaviour.
 */
export function useRegisteredComponent<TProps>(
  componentId: string,
  fallback?: ComponentType<TProps>,
): ComponentType<TProps> {
  return React.useMemo(() => {
    const Registered = (props: TProps) => {
      const userFeatures = useOverrideUserFeatures()
      const overrideRevision = useOverrideRegistryRevision()
      const { original, wrapped, transforms, replacementOverride, replacementModule } = React.useMemo(
        () => resolveComponent<TProps>(componentId, fallback, userFeatures),
        [overrideRevision, userFeatures],
      )

      if (!original || !wrapped) return null

      const transformed = transforms.reduce((current, transform) => transform(current), props)
      const Fallback = React.createElement(original as React.ComponentType<Record<string, unknown>>, transformed as Record<string, unknown>)
      if (
        process.env.NODE_ENV !== 'production'
        && replacementOverride
        && 'replacement' in replacementOverride
      ) {
        const validation = replacementOverride.propsSchema.safeParse(transformed)
        if (!validation.success) {
          logger.error('Props schema validation failed for replacement', { componentId, module: replacementModule, issues: validation.error.format() })
          return Fallback
        }
      }
      return (
        <ReplacementErrorBoundary
          fallback={Fallback}
          onError={(error) => {
            logger.error('Component replacement failed', { componentId, module: replacementModule, err: error })
          }}
        >
          {React.createElement(wrapped as React.ComponentType<Record<string, unknown>>, transformed as Record<string, unknown>)}
        </ReplacementErrorBoundary>
      )
    }

    Registered.displayName = `RegisteredComponent(${componentId})`
    return Registered
  }, [componentId, fallback])
}

export default useRegisteredComponent
