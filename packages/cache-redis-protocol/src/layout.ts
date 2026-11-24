export const RESP_LAYOUT_VERSION = 1
export const RESP_KEY_ROOT = 'om'

const GLOB_SPECIAL_CHARACTERS = /[*?[\]\\]/g
const NAMESPACE_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/

export type RespKeyLayout = {
  namespace: string
  /** `om:{<namespace>}:` — the `{...}` hash tag pins every key of a namespace to one cluster slot. */
  prefix: string
  valuePrefix: string
  tagPrefix: string
  valueKey(physicalKey: string): string
  tagKey(tag: string): string
  physicalKeyFromValueKey(valueKey: string): string | null
  /** SCAN MATCH pattern covering every value key whose physical key starts with the literal part of `pattern`. */
  valueScanPattern(pattern?: string): string
  tagScanPattern(): string
}

export function escapeRespGlob(literal: string): string {
  return literal.replace(GLOB_SPECIAL_CHARACTERS, (character) => `\\${character}`)
}

export function literalPatternPrefix(pattern: string | undefined): string {
  if (!pattern) return ''
  const wildcard = pattern.search(/[*?]/)
  return wildcard < 0 ? pattern : pattern.slice(0, wildcard)
}

export function buildRespKeyLayout(namespace: string): RespKeyLayout {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error('[internal] RESP cache namespace must be 1-64 characters of letters, digits, ".", "_" or "-"')
  }
  const prefix = `${RESP_KEY_ROOT}:{${namespace}}:`
  const valuePrefix = `${prefix}v:`
  const tagPrefix = `${prefix}t:`
  return {
    namespace,
    prefix,
    valuePrefix,
    tagPrefix,
    valueKey: (physicalKey) => `${valuePrefix}${physicalKey}`,
    tagKey: (tag) => `${tagPrefix}${tag}`,
    physicalKeyFromValueKey: (valueKey) => (valueKey.startsWith(valuePrefix) ? valueKey.slice(valuePrefix.length) : null),
    valueScanPattern: (pattern) => `${escapeRespGlob(valuePrefix)}${escapeRespGlob(literalPatternPrefix(pattern))}*`,
    tagScanPattern: () => `${escapeRespGlob(tagPrefix)}*`,
  }
}
