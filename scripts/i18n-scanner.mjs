/**
 * Pure helpers for the i18n usage scanner.
 *
 * Extracted so `i18n-check-usage.ts` and its unit tests can share the same
 * detection logic without touching the filesystem.
 */

// Pattern 1: Direct t('key') / translate('key') calls.
// The `d` flag exposes per-group offsets so a multiline call can be reported at the
// line of its key argument rather than the line of the opening `t(`.
const DIRECT_CALL_PATTERN = /(?<![a-zA-Z_])(?:t|translate)\(\s*(['"])([a-zA-Z0-9_.]+)\1/dg

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

function buildLineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

function lineNumberAt(lineStarts, offset) {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (lineStarts[middle] <= offset) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return low + 1
}

/**
 * Scans the whole text rather than line by line, so a `t()` call whose key
 * argument sits on a following line is detected like a single-line one. The
 * patterns already allow whitespace between `t(` and the key; only the per-line
 * split prevented that whitespace from ever being a newline (#4666).
 *
 * `direct` marks refs that came from a real `t()` / `translate()` call. Only
 * those may be reported as missing keys — indirect matches (key-ish properties,
 * bare dotted literals) are counted as usage but are validated against known
 * keys, so an unknown literal there is just an ordinary string.
 */
export function scanText(text, allTranslationKeys, { file = '<inline>' } = {}) {
  const keySet = allTranslationKeys instanceof Set
    ? allTranslationKeys
    : new Set(allTranslationKeys)
  const prefixIndex = buildPrefixIndex(keySet)
  const lineStarts = buildLineStarts(text)
  const refs = []
  let dynamicCount = 0

  for (const match of text.matchAll(DIRECT_CALL_PATTERN)) {
    const keyOffset = match.indices?.[2]?.[0] ?? match.index
    refs.push({ key: match[2], file, line: lineNumberAt(lineStarts, keyOffset), direct: true })
  }

  for (const match of text.matchAll(KEY_PROPERTY_PATTERN)) {
    const candidate = match[2]
    if (keySet.has(candidate)) {
      refs.push({ key: candidate, file, line: lineNumberAt(lineStarts, match.index), direct: false })
    }
  }

  for (const match of text.matchAll(DOTTED_LITERAL_PATTERN)) {
    const candidate = match[2]
    if (keySet.has(candidate)) {
      refs.push({ key: candidate, file, line: lineNumberAt(lineStarts, match.index), direct: false })
    }
  }

  for (const match of text.matchAll(TEMPLATE_PREFIX_PATTERN)) {
    const prefix = match[1]
    const expanded = prefixIndex.get(prefix)
    if (!expanded) continue
    const line = lineNumberAt(lineStarts, match.index)
    for (const key of expanded) {
      refs.push({ key, file, line, direct: false })
    }
  }

  for (const _ of text.matchAll(DYNAMIC_CALL_PATTERN)) {
    dynamicCount++
  }

  return { refs, dynamicCount }
}
