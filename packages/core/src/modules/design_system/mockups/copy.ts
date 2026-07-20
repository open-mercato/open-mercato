import { z } from 'zod'
import { collectLeaves, type MockupDocument } from './schema'

/**
 * Companion copy files (spec 2026-07-05-ds-live-mockup-composer.md, Phase 2 —
 * `om-ux-copy`): `<slug>.copy.json` beside the mockup carries ready i18n keys
 * with en/pl/es/de values for every text-bearing compose prop. Keys are
 * deterministic from block id + prop path so re-runs are stable diffs; on
 * implementation the keys migrate into module i18n files.
 *
 * The renderer prefers copy-file values when present: the detail GET returns
 * the copy document and the stage overrides matching string props for the
 * active locale.
 */

export const COPY_LOCALES = ['en', 'pl', 'es', 'de'] as const
export type CopyLocale = (typeof COPY_LOCALES)[number]

const copyValues = z
  .object({ en: z.string(), pl: z.string(), es: z.string(), de: z.string() })
  .strict()

export const copyFileSchema = z
  .object({
    version: z.literal(1),
    keys: z.record(z.string().regex(/^mockup\.[a-z0-9-]+\.[^.]+(\.[^.]+)+$/), copyValues),
  })
  .strict()
export type MockupCopyFile = z.infer<typeof copyFileSchema>

/** Deterministic key: `mockup.<slug>.<blockId>.<propPath>` (path segments dot-joined). */
export function copyKeyFor(slug: string, blockId: string, propPath: string[]): string {
  return `mockup.${slug}.${blockId}.${propPath.join('.')}`
}

export type TextPropRef = {
  blockId: string
  propPath: string[]
  value: string
  key: string
}

/**
 * Every text-bearing compose prop in the document — string-valued props,
 * including nested object props, in tree order. This is the exact set a copy
 * file must cover (the copy-coverage test pins it for the golden fixture).
 */
export function collectTextProps(document: MockupDocument): TextPropRef[] {
  const refs: TextPropRef[] = []
  const walk = (blockId: string, path: string[], value: unknown): void => {
    if (typeof value === 'string') {
      refs.push({ blockId, propPath: path, value, key: copyKeyFor(document.slug, blockId, path) })
      return
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      for (const key of Object.keys(record).sort()) walk(blockId, [...path, key], record[key])
    }
  }
  for (const leaf of collectLeaves(document.root)) {
    if (leaf.type !== 'block' || !leaf.props) continue
    for (const key of Object.keys(leaf.props).sort()) walk(leaf.id, [key], leaf.props[key])
  }
  return refs
}

/** The deterministic key set a copy pass must emit for this document. */
export function expectedCopyKeys(document: MockupDocument): string[] {
  return collectTextProps(document).map((ref) => ref.key)
}

/**
 * Per-block string-prop overrides for one locale — the stage merges these
 * over the committed sample props at render time.
 */
export function copyOverridesFor(
  document: MockupDocument,
  copyFile: MockupCopyFile,
  locale: string,
): Record<string, Array<{ propPath: string[]; value: string }>> {
  const pick: CopyLocale = (COPY_LOCALES as readonly string[]).includes(locale)
    ? (locale as CopyLocale)
    : 'en'
  const overrides: Record<string, Array<{ propPath: string[]; value: string }>> = {}
  for (const ref of collectTextProps(document)) {
    const values = copyFile.keys[ref.key]
    if (!values) continue
    const list = overrides[ref.blockId] ?? []
    list.push({ propPath: ref.propPath, value: values[pick] })
    overrides[ref.blockId] = list
  }
  return overrides
}

/** Applies one block's overrides to its props (immutably). */
export function applyCopyOverrides(
  props: Record<string, unknown>,
  overrides: Array<{ propPath: string[]; value: string }>,
): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(props)) as Record<string, unknown>
  for (const override of overrides) {
    let cursor: Record<string, unknown> = next
    let valid = true
    for (const segment of override.propPath.slice(0, -1)) {
      const child = cursor[segment]
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        valid = false
        break
      }
      cursor = child as Record<string, unknown>
    }
    if (!valid) continue
    const lastKey = override.propPath[override.propPath.length - 1]
    if (typeof cursor[lastKey] === 'string') cursor[lastKey] = override.value
  }
  return next
}
