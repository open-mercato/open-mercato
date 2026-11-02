import { defaultFieldTypeRegistry } from '../../../../../schema/field-type-registry'
import { listLayoutCatalogEntries } from '../../../../../schema/layout-catalog'
import type { PaletteEntry } from '../types'

/**
 * Source-of-truth allowlist for the "Survey & Contact" palette section
 * (`.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * Phase B seeds `email`, `phone`, `website`. Phases C–F extend this set with
 * `address`, `nps`, `opinion_scale`, `ranking`, `matrix` — each phase adds
 * its key to this single Set; `buildPaletteEntries` automatically picks the
 * change up. Survey entries remain `category: 'input'` in the registry
 * (the palette grouping is purely a UI affordance — `resolvePaletteId`
 * still resolves them as `kind: 'input'`).
 */
export const SURVEY_TYPE_KEYS: ReadonlySet<string> = new Set<string>([
  'email',
  'phone',
  'website',
  // Tier-2 Phase C — composite address (Decision 1).
  'address',
  // Tier-2 Phase D — survey scales (Decision 2 — NPS as distinct type).
  'nps',
  'opinion_scale',
  // Tier-2 Phase E — drag-to-rank list (Decision 4 — partial allowed by default).
  'ranking',
  // Tier-2 Phase F — matrix / Likert grid (Decision 5 — per-row multiple opt-in).
  'matrix',
])

/**
 * Builds the static palette entry list. Layout primitives come from
 * `layoutCatalog` (Phase C — sibling registry of palette-only entries).
 * Layout-categorized field types from the registry (currently `info_block`)
 * get a `layout:field:<key>` id so the canvas DnD wiring can distinguish
 * them from layout primitives without inspecting the registry again.
 *
 * The `survey` bucket carries Tier-2 input types (Phase B+); they share the
 * `category: 'input'` semantics with the `input` bucket — only the palette
 * grouping differs.
 */
export function buildPaletteEntries(): {
  input: PaletteEntry[]
  survey: PaletteEntry[]
  layout: PaletteEntry[]
} {
  const input: PaletteEntry[] = []
  const survey: PaletteEntry[] = []
  const layout: PaletteEntry[] = listLayoutCatalogEntries().map((entry) => ({
    id: `layout:${entry.id}`,
    category: 'layout' as const,
    iconName: entry.icon,
    displayNameKey: entry.displayNameKey,
  }))
  for (const key of defaultFieldTypeRegistry.keys()) {
    const spec = defaultFieldTypeRegistry.get(key)
    if (!spec) continue
    const category = spec.category ?? 'input'
    const entry: PaletteEntry = {
      id: category === 'layout' ? `layout:field:${key}` : key,
      category,
      iconName: spec.icon ?? 'square',
      displayNameKey: spec.displayNameKey ?? `forms.studio.palette.${category}.${key}`,
      fieldTypeKey: key,
    }
    if (category === 'layout') {
      layout.push(entry)
    } else if (SURVEY_TYPE_KEYS.has(key)) {
      survey.push(entry)
    } else {
      input.push(entry)
    }
  }
  return { input, survey, layout }
}

export type ResolvedPaletteId =
  | { kind: 'input'; typeKey: string }
  | { kind: 'layout-field'; typeKey: string }
  | { kind: 'layout-primitive'; layoutKind: 'page' | 'section' | 'ending' }
  | { kind: 'unknown' }

/**
 * Decodes a palette draggable id (without the `palette:` prefix) into a
 * structured shape. The canvas `onDragEnd` uses this to dispatch into the
 * right helper. Phase B does not touch this function — survey entries
 * still resolve as `kind: 'input'`.
 */
export function resolvePaletteId(rawId: string): ResolvedPaletteId {
  if (!rawId) return { kind: 'unknown' }
  if (rawId.startsWith('layout:field:')) {
    return { kind: 'layout-field', typeKey: rawId.slice('layout:field:'.length) }
  }
  if (rawId.startsWith('layout:')) {
    const layoutId = rawId.slice('layout:'.length)
    if (layoutId === 'page' || layoutId === 'section' || layoutId === 'ending') {
      return { kind: 'layout-primitive', layoutKind: layoutId }
    }
    return { kind: 'unknown' }
  }
  return { kind: 'input', typeKey: rawId }
}
