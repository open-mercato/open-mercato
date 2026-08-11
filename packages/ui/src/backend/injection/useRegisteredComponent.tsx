'use client'

import * as React from 'react'
import type { ComponentType } from 'react'
import { getComponentEntry, getComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
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

type ResolutionPlan<TProps> = {
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

function emptyPlan<TProps>(): ResolutionPlan<TProps> {
  return { original: null, wrapped: null, transforms: [], replacementOverride: null, replacementModule: 'unknown' }
}

function resolvePlan<TProps>(
  componentId: string,
  fallback: ComponentType<TProps> | undefined,
  userFeatures: readonly string[],
): ResolutionPlan<TProps> {
  const entry = getComponentEntry(componentId)
  const original = (entry?.component as ComponentType<TProps> | undefined) ?? fallback ?? null
  if (!original) {
    if (process.env.NODE_ENV !== 'production' && !fallback) {
      logger.warn('Component is not registered', { componentId })
    }
    return emptyPlan<TProps>()
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
 * Creates the component the hook hands back. Its identity is created once per
 * componentId and never changes afterwards: resolution happens inside its own
 * render, so a late override registration or a resolved feature grant makes the
 * subtree re-render instead of remounting. Remounting discards the state of
 * every input below this point, which is how typed credentials used to vanish
 * from the login form (issue #5037).
 */
function createRegisteredComponent<TProps>(
  componentId: string,
  fallbackRef: React.MutableRefObject<ComponentType<TProps> | undefined>,
): ComponentType<TProps> {
  const Registered = (props: TProps) => {
    const userFeatures = useOverrideUserFeatures()
    const overrideRevision = useOverrideRegistryRevision()
    const fallback = fallbackRef.current
    const plan = React.useMemo(
      () => resolvePlan<TProps>(componentId, fallback, userFeatures),
      [fallback, overrideRevision, userFeatures],
    )

    if (!plan.original || !plan.wrapped) return null

    const transformed = plan.transforms.reduce((current, transform) => transform(current), props)
    const Fallback = React.createElement(
      plan.original as React.ComponentType<Record<string, unknown>>,
      transformed as Record<string, unknown>,
    )

    if (
      process.env.NODE_ENV !== 'production'
      && plan.replacementOverride
      && 'replacement' in plan.replacementOverride
    ) {
      const validation = plan.replacementOverride.propsSchema.safeParse(transformed)
      if (!validation.success) {
        logger.error('Props schema validation failed for replacement', { componentId, module: plan.replacementModule, issues: validation.error.format() })
        return Fallback
      }
    }

    return (
      <ReplacementErrorBoundary
        fallback={Fallback}
        onError={(error) => {
          logger.error('Component replacement failed', { componentId, module: plan.replacementModule, err: error })
        }}
      >
        {React.createElement(plan.wrapped as React.ComponentType<Record<string, unknown>>, transformed as Record<string, unknown>)}
      </ReplacementErrorBoundary>
    )
  }

  Registered.displayName = `RegisteredComponent(${componentId})`
  return Registered
}

export function useRegisteredComponent<TProps>(
  componentId: string,
  fallback?: ComponentType<TProps>,
): ComponentType<TProps> {
  const fallbackRef = React.useRef<ComponentType<TProps> | undefined>(fallback)
  fallbackRef.current = fallback

  const resolved = React.useRef<{ componentId: string; Component: ComponentType<TProps> } | null>(null)
  if (!resolved.current || resolved.current.componentId !== componentId) {
    resolved.current = { componentId, Component: createRegisteredComponent<TProps>(componentId, fallbackRef) }
  }
  return resolved.current.Component
}

export default useRegisteredComponent
