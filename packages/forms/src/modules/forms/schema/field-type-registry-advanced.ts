import type { ComponentType } from 'react'
import {
  FieldTypeRegistry,
  defaultFieldTypeRegistry,
  type FieldTypeSpec,
} from './field-type-registry'

/**
 * Phase 3 — vertical-extension demo.
 *
 * The Forms module ships ONE demo vertical type — `demo.rating_stars` — to
 * exercise the registry's `register(...)` extension surface and to anchor
 * the regression test that an unregistered type fails compile (R-3-1
 * regression test). Real vertical types (`dental.tooth_chart`, etc.) live
 * in consumer modules (e.g. `packages/dentalos`); they follow this same
 * pattern.
 *
 * The pattern:
 *   1. Define a `FieldTypeSpec` with `validator` + `defaultUiSchema` +
 *      `exportAdapter` (renderer can be `null` and attached later via
 *      `setRenderer`).
 *   2. Register it on the singleton or a private registry at module
 *      bootstrap: `registry.register('module.type_key', spec)`.
 *   3. The compiler will recognize it and forms can reference it via
 *      `x-om-type: "module.type_key"`.
 */

export const DEMO_RATING_STARS_TYPE_KEY = 'demo.rating_stars' as const
export const DEMO_RATING_STARS_DEFAULT_MAX = 5

export const demoRatingStarsSpec: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'Expected an integer star count.'
    const min = typeof fieldNode['x-om-min'] === 'number' ? (fieldNode['x-om-min'] as number) : 1
    const max =
      typeof fieldNode['x-om-max'] === 'number'
        ? (fieldNode['x-om-max'] as number)
        : DEMO_RATING_STARS_DEFAULT_MAX
    if (value < min || value > max) {
      return `Rating must be between ${min} and ${max} (inclusive).`
    }
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'stars' },
  exportAdapter: (value) =>
    typeof value === 'number' && Number.isInteger(value) ? `${value} ★` : '',
}

export function registerVerticalDemoTypes(
  registry: FieldTypeRegistry = defaultFieldTypeRegistry,
  ratingStarsRenderer: ComponentType<unknown> | null = null,
): void {
  registry.register(DEMO_RATING_STARS_TYPE_KEY, demoRatingStarsSpec)
  if (ratingStarsRenderer) {
    registry.setRenderer(DEMO_RATING_STARS_TYPE_KEY, ratingStarsRenderer)
  }
}
