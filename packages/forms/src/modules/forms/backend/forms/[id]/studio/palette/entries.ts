import { defaultFieldTypeRegistry } from '../../../../../schema/field-type-registry'
import { listLayoutCatalogEntries } from '../../../../../schema/layout-catalog'
import type { PaletteEntry } from '../types'

/**
 * Builds the static palette entry list. Layout primitives come from
 * `layoutCatalog` (Phase C — sibling registry of palette-only entries).
 * Layout-categorized field types from the registry (currently `info_block`)
 * get a `layout:field:<key>` id so the canvas DnD wiring can distinguish
 * them from layout primitives without inspecting the registry again.
 */
export function buildPaletteEntries(): { input: PaletteEntry[]; layout: PaletteEntry[] } {
  const input: PaletteEntry[] = []
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
    if (category === 'layout') layout.push(entry)
    else input.push(entry)
  }
  return { input, layout }
}

export type ResolvedPaletteId =
  | { kind: 'input'; typeKey: string }
  | { kind: 'layout-field'; typeKey: string }
  | { kind: 'layout-primitive'; layoutKind: 'page' | 'section' | 'ending' }
  | { kind: 'unknown' }

/**
 * Decodes a palette draggable id (without the `palette:` prefix) into a
 * structured shape. The canvas `onDragEnd` uses this to dispatch into the
 * right helper.
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
