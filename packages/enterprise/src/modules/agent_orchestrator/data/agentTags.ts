/**
 * Operator-authored agent tags.
 *
 * Agents are code/file-defined and global, so the tenant's own taxonomy has
 * nowhere to live but `agent_settings.tags` — keyed by agent id, which is also
 * why a tag survives an agent that is not in the live registry.
 *
 * Kept free of server imports (like `data/agentIcons.ts`) so the validator, the
 * API routes, the tag editor and the registry filter all normalize identically:
 * a tag typed as `Sales Ops` and one typed as ` sales   ops ` MUST compare
 * equal, otherwise filtering silently misses rows.
 */

export const AGENT_TAG_MAX_LENGTH = 32
export const AGENT_TAGS_MAX_COUNT = 20

/** Trim, collapse inner whitespace, lowercase, and cap to the stored length. */
export function normalizeAgentTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, AGENT_TAG_MAX_LENGTH)
}

/**
 * Normalize a whole tag list: drops blanks, dedupes (first occurrence wins so
 * the operator's ordering survives) and caps the count.
 */
export function normalizeAgentTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const tag = normalizeAgentTag(entry)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= AGENT_TAGS_MAX_COUNT) break
  }
  return tags
}
