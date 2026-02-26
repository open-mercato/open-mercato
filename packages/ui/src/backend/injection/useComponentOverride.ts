'use client'

import * as React from 'react'
import type { ComponentType } from 'react'
import {
  registerComponent,
  getOverridesForComponent,
  isReplaceOverride,
  isWrapperOverride,
  isPropsTransformOverride,
} from '@open-mercato/shared/modules/widgets/component-registry'
import { useComponentOverrideContext } from './ComponentOverrideProvider'

/**
 * Auto-registers a component as replaceable and resolves any overrides.
 *
 * Used by DataTable, CrudForm, and ReplaceablePage to make themselves
 * overridable without manual registerComponent() calls.
 *
 * Convention-based component IDs:
 * - DataTable: `data-table:<tableId>` (e.g., `data-table:customers.people.list`)
 * - CrudForm:  `crud-form:<formId>`   (e.g., `crud-form:customers.people`)
 * - Page:      `page:<module>.<path>`  (e.g., `page:customers.people.detail`)
 * - Section:   `section:<module>.<name>` (e.g., `section:customers.notes`)
 *
 * @returns The override component if one exists, null otherwise
 */
export function useComponentOverride<TProps extends Record<string, unknown>>(
  componentId: string | undefined,
  OriginalComponent: ComponentType<TProps>,
  metadata?: { module?: string; description?: string },
): ComponentType<TProps> | null {
  const overrideContext = useComponentOverrideContext()

  // Auto-register on first render
  React.useEffect(() => {
    if (!componentId) return
    registerComponent({
      id: componentId,
      component: OriginalComponent as ComponentType<unknown>,
      metadata: {
        module: metadata?.module ?? componentId.split('.')[0] ?? 'unknown',
        description: metadata?.description ?? `Auto-registered: ${componentId}`,
      },
    })
  }, [componentId, OriginalComponent, metadata?.module, metadata?.description])

  return React.useMemo(() => {
    if (!componentId || !overrideContext) return null

    const overrides = overrideContext.getOverrides(componentId)
    const gated = overrides.filter((entry) => {
      const features = entry.override.features
      if (!features || features.length === 0) return true
      return features.every((f) => overrideContext.userFeatures.has(f))
    })

    if (gated.length === 0) return null

    // Check for replacement (highest priority wins)
    const replacements = gated.filter((e) => isReplaceOverride(e.override))
    if (replacements.length > 0) {
      const winner = replacements[replacements.length - 1]
      if (isReplaceOverride(winner.override)) {
        return winner.override.replacement as unknown as ComponentType<TProps>
      }
    }

    // Check for wrapper (compose from innermost to outermost)
    const wrappers = gated.filter((e) => isWrapperOverride(e.override))
    if (wrappers.length > 0) {
      let composed: ComponentType<Record<string, unknown>> = OriginalComponent as ComponentType<Record<string, unknown>>
      for (const entry of wrappers) {
        if (isWrapperOverride(entry.override)) {
          composed = entry.override.wrapper(composed)
        }
      }
      return composed as ComponentType<TProps>
    }

    // Check for props transform
    const transforms = gated.filter((e) => isPropsTransformOverride(e.override))
    if (transforms.length > 0) {
      const transformFns = transforms
        .map((e) => isPropsTransformOverride(e.override) ? e.override.propsTransform : null)
        .filter(Boolean) as Array<(props: Record<string, unknown>) => Record<string, unknown>>

      const TransformedComponent = (props: TProps) => {
        let transformedProps: Record<string, unknown> = { ...props }
        for (const fn of transformFns) {
          transformedProps = fn(transformedProps)
        }
        return React.createElement(OriginalComponent, transformedProps as TProps)
      }
      TransformedComponent.displayName = `PropsTransform(${componentId})`
      return TransformedComponent as ComponentType<TProps>
    }

    return null
  }, [componentId, overrideContext, OriginalComponent])
}
