'use client'

import * as React from 'react'
import type { ComponentType } from 'react'
import { getComponentEntry, getComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'

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

export function useRegisteredComponent<TProps>(
  componentId: string,
  fallback?: ComponentType<TProps>,
): ComponentType<TProps> {
  return React.useMemo(() => {
    const entry = getComponentEntry(componentId)
    const original = (entry?.component as ComponentType<TProps> | undefined) ?? fallback ?? null
    if (!original) {
      if (process.env.NODE_ENV !== 'production' && !fallback) {
        console.warn(`[UMES] Component "${componentId}" is not registered.`)
      }
      const Missing = () => null
      return Missing as ComponentType<TProps>
    }
    const overrides = getComponentOverrides(componentId)

    let replacement: ComponentType<TProps> | null = null
    let replacementOverride: (typeof overrides)[number] | null = null
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

    const Resolved = (props: TProps) => {
      const transformed = transforms.reduce((current, transform) => transform(current), props)
      const Fallback = React.createElement(original as React.ComponentType<any>, transformed as any)
      if (
        process.env.NODE_ENV !== 'production'
        && replacementOverride
        && 'replacement' in replacementOverride
      ) {
        const validation = replacementOverride.propsSchema.safeParse(transformed)
        if (!validation.success) {
          console.error(
            `[UMES] Props schema validation failed for replacement "${componentId}" from module "${replacementOverride.metadata?.module ?? 'unknown'}"`,
            validation.error.format(),
          )
          return Fallback
        }
      }
      return (
        <ReplacementErrorBoundary
          fallback={Fallback}
          onError={(error) => {
            const replacementModule = overrides.find((override) => 'replacement' in override)?.metadata?.module ?? 'unknown'
            console.error(`[UMES] Component replacement failed for "${componentId}" from module "${replacementModule}"`, error)
          }}
        >
          {React.createElement(wrapped as React.ComponentType<any>, transformed as any)}
        </ReplacementErrorBoundary>
      )
    }

    Resolved.displayName = `RegisteredComponent(${componentId})`
    return Resolved
  }, [componentId, fallback])
}

export default useRegisteredComponent
