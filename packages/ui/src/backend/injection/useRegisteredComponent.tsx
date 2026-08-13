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

/**
 * Calling a wrapper override returns a fresh component every time, which would
 * reintroduce the identity churn this hook exists to avoid. Memoizing per
 * (wrapper, wrapped component) pair keeps the composed component referentially
 * stable for as long as both inputs are.
 */
const composedWrappers = new WeakMap<object, WeakMap<object, unknown>>()

function applyWrapper<TProps>(
  wrapper: (Original: ComponentType<TProps>) => ComponentType<TProps>,
  Base: ComponentType<TProps>,
): ComponentType<TProps> {
  let byBase = composedWrappers.get(wrapper as unknown as object)
  if (!byBase) {
    byBase = new WeakMap<object, unknown>()
    composedWrappers.set(wrapper as unknown as object, byBase)
  }
  const cached = byBase.get(Base as unknown as object)
  if (cached) return cached as ComponentType<TProps>
  const composed = wrapper(Base)
  byBase.set(Base as unknown as object, composed)
  return composed
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
  const wrapped = wrappers.reduce<ComponentType<TProps>>((acc, wrapper) => applyWrapper(wrapper, acc), base)

  return {
    original,
    wrapped,
    transforms,
    replacementOverride,
    replacementModule: replacementOverride?.metadata?.module ?? 'unknown',
  }
}

/**
 * The returned component's identity must depend only on `componentId` — never
 * on the override registry, and never on the `fallback` a caller happens to
 * pass on this render.
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
 *
 * The identity is held in a ref rather than a `useMemo`, because `useMemo` is a
 * performance hint React is free to discard, and identity here is a correctness
 * requirement rather than an optimisation. `fallback` is read through a ref for
 * the same reason: a host that builds its fallback inline would otherwise swap
 * the component this hook hands back on every render. That still cannot save a
 * subtree rendered *through* such a fallback — the fallback itself is then the
 * element type, and only the host can stabilise it — but it keeps the churn
 * from spreading to hosts whose id does resolve to a registered component.
 */
export function useRegisteredComponent<TProps>(
  componentId: string,
  fallback?: ComponentType<TProps>,
): ComponentType<TProps> {
  const fallbackRef = React.useRef<ComponentType<TProps> | undefined>(fallback)
  fallbackRef.current = fallback

  const registered = React.useRef<{ componentId: string; Component: ComponentType<TProps> } | null>(null)
  if (!registered.current || registered.current.componentId !== componentId) {
    const Registered = (props: TProps) => {
      const userFeatures = useOverrideUserFeatures()
      const overrideRevision = useOverrideRegistryRevision()
      const currentFallback = fallbackRef.current
      const { original, wrapped, transforms, replacementOverride, replacementModule } = React.useMemo(
        () => resolveComponent<TProps>(componentId, currentFallback, userFeatures),
        [currentFallback, overrideRevision, userFeatures],
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
    registered.current = { componentId, Component: Registered }
  }

  return registered.current.Component
}

export default useRegisteredComponent
