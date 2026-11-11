/**
 * Rules about a segment's own definition, decided without a database.
 *
 * A segment is a named audience expression. The one structural rule worth enforcing is that a segment may
 * not be defined in terms of segments: nesting them invites a cycle, and a cycle in membership evaluation is
 * not a subtle bug — it is a stack overflow inside a dispatch, on a path that runs per customer.
 */

/** The subject-document key segment membership is published under. */
export const SEGMENTS_FIELD = 'segments'

/** Slug shape, so a segment can be referenced from an audience as a plain string. */
export const SEGMENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function isValidSegmentSlug(slug: string): boolean {
  return SEGMENT_SLUG_PATTERN.test(slug)
}

/**
 * Derives a slug from a name.
 *
 * Kept deliberately dumb — lower-case, non-alphanumerics to dashes, trimmed. A transliterating slugifier
 * would be nicer for non-Latin names and is not worth a dependency here, because the slug is an internal
 * reference and the NAME is what anybody reads.
 */
export function slugifySegmentName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug.length > 0 ? slug : 'segment'
}

type UnknownRecord = Record<string, unknown>

/**
 * Whether an expression mentions a field anywhere in its tree.
 *
 * Walks both the rule list and nested groups, whatever they are called: the condition expression shape comes
 * from `business_rules` and has been through more than one revision, so this reads every plausible child key
 * rather than assuming one. A false positive here refuses a valid segment; a false negative allows a cycle,
 * and only one of those is recoverable.
 */
export function expressionReferencesField(expression: unknown, field: string): boolean {
  if (!expression || typeof expression !== 'object') return false
  if (Array.isArray(expression)) {
    return expression.some((entry) => expressionReferencesField(entry, field))
  }

  const node = expression as UnknownRecord
  if (typeof node.field === 'string' && node.field === field) return true
  if (typeof node.field === 'string' && node.field.startsWith(`${field}.`)) return true

  for (const key of ['rules', 'conditions', 'children', 'groups', 'any', 'all']) {
    if (key in node && expressionReferencesField(node[key], field)) return true
  }
  return false
}

/** A segment definition may not reference segment membership — see the note at the top of this file. */
export function isSelfReferentialSegment(expression: unknown): boolean {
  return expressionReferencesField(expression, SEGMENTS_FIELD)
}
