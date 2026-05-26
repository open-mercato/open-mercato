/**
 * Pure helpers for the i18n usage scanner.
 *
 * Extracted so `i18n-check-usage.ts` and its unit tests can share the same
 * detection logic without touching the filesystem.
 */

// Pattern 1: Direct t('key') / translate('key') calls.
const DIRECT_CALL_PATTERN = /(?<![a-zA-Z_])(?:t|translate)\(\s*(['"])([a-zA-Z0-9_.]+)\1/g

// Pattern 2a: Indirect key properties — labelKey: 'key', titleKey: 'key', etc.
const KEY_PROPERTY_PATTERN = /[a-zA-Z]*[Kk]ey['"]?\s*[:=]\s*(['"])([a-zA-Z0-9_.]+)\1/g

// Pattern 2b: Any dotted string literal — catches ternary branches, array/object data,
// and other indirect passes that are not direct t() calls. Only counted when the
// literal exactly equals a known translation key.
const DOTTED_LITERAL_PATTERN = /(['"])([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\1/g

// Pattern 3: Template-literal calls with a static prefix — e.g.
//   t(`module.entity.status.${row.status}`)
// The captured prefix is treated as potentially referencing any known key
// that starts with `${prefix}.`.
const TEMPLATE_PREFIX_PATTERN = /(?<![a-zA-Z_])(?:t|translate)\(\s*`([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\.\$\{/g

// Pattern 4: Detect dynamic t() calls for counting (variable args, template literals, etc.).
const DYNAMIC_CALL_PATTERN = /(?<![a-zA-Z_])(?:t|translate)\(\s*(?!['"])[a-zA-Z`{]/g

export function buildPrefixIndex(allTranslationKeys) {
  const index = new Map()
  for (const key of allTranslationKeys) {
    const segments = key.split('.')
    for (let i = 1; i < segments.length; i++) {
      const prefix = segments.slice(0, i).join('.')
      const bucket = index.get(prefix)
      if (bucket) {
        bucket.push(key)
      } else {
        index.set(prefix, [key])
      }
    }
  }
  return index
}

export function scanText(text, allTranslationKeys, { file = '<inline>' } = {}) {
  const keySet = allTranslationKeys instanceof Set
    ? allTranslationKeys
    : new Set(allTranslationKeys)
  const prefixIndex = buildPrefixIndex(keySet)
  const lines = text.split('\n')
  const refs = []
  let dynamicCount = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1

    for (const match of line.matchAll(DIRECT_CALL_PATTERN)) {
      refs.push({ key: match[2], file, line: lineNumber })
    }

    for (const match of line.matchAll(KEY_PROPERTY_PATTERN)) {
      const candidate = match[2]
      if (keySet.has(candidate)) {
        refs.push({ key: candidate, file, line: lineNumber })
      }
    }

    for (const match of line.matchAll(DOTTED_LITERAL_PATTERN)) {
      const candidate = match[2]
      if (keySet.has(candidate)) {
        refs.push({ key: candidate, file, line: lineNumber })
      }
    }

    for (const match of line.matchAll(TEMPLATE_PREFIX_PATTERN)) {
      const prefix = match[1]
      const expanded = prefixIndex.get(prefix)
      if (!expanded) continue
      for (const key of expanded) {
        refs.push({ key, file, line: lineNumber })
      }
    }

    for (const _ of line.matchAll(DYNAMIC_CALL_PATTERN)) {
      dynamicCount++
    }
  }

  return { refs, dynamicCount }
}
