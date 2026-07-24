type ZodIssueLite = {
  path?: Array<string | number>
  message?: string
}

type ApiErrorBody = {
  error?: string
  details?: ZodIssueLite[]
}

// Collection segments in a definition path, mapped to the label an operator
// recognizes from the editor. Indexes are rendered 1-based.
const COLLECTION_LABELS: Record<string, string> = {
  steps: 'step',
  transitions: 'transition',
  activities: 'activity',
  triggers: 'trigger',
  preConditions: 'pre-condition',
}

/**
 * Turn a raw Zod path into something an operator can act on:
 * `steps.2.activities.0.config.endpoint` → `step 3 › activity 1 › config.endpoint`.
 *
 * The raw dotted path reads as internal JSON and gives no hint which node to
 * open in the visual editor (#4232).
 */
export function humanizeDefinitionIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (!path.length) return 'definition'
  const parts: string[] = []
  let pending: string | null = null

  for (const rawSegment of path) {
    // Zod types issue paths as PropertyKey; symbols can't appear in JSON data
    // but narrow defensively rather than casting.
    const segment = typeof rawSegment === 'symbol' ? rawSegment.toString() : rawSegment
    if (typeof segment === 'number') {
      parts.push(pending ? `${pending} ${segment + 1}` : `#${segment + 1}`)
      pending = null
      continue
    }
    const label = COLLECTION_LABELS[segment]
    if (label) {
      if (pending) parts.push(pending)
      pending = label
      continue
    }
    if (pending) {
      parts.push(pending)
      pending = null
    }
    parts.push(segment)
  }
  if (pending) parts.push(pending)

  const [head, ...rest] = parts
  if (!rest.length) return head
  // Keep trailing field names dotted (config.endpoint), collections chevroned.
  const grouped: string[] = [head]
  for (const part of rest) {
    const isIndexed = /\s\d+$/.test(part) || part.startsWith('#')
    if (!isIndexed && grouped.length > 0 && !/\s\d+$/.test(grouped[grouped.length - 1]) && !grouped[grouped.length - 1].startsWith('#')) {
      grouped[grouped.length - 1] = `${grouped[grouped.length - 1]}.${part}`
      continue
    }
    grouped.push(part)
  }
  return grouped.join(' › ')
}

/**
 * Format an API validation error body into a user-readable message.
 *
 * The workflow definitions API returns `{ error: 'Validation failed', details: ZodIssue[] }`
 * for schema failures. The generic `error` string is useless to the user — the actionable
 * information lives in `details[0].path` and `details[0].message`. This helper mirrors the
 * visual editor's `Schema error: <path> - <message>` format so both editors surface the
 * same diagnostic.
 */
export function formatWorkflowValidationError(
  body: ApiErrorBody | null | undefined,
  fallback: string,
): string {
  const issue = body?.details?.[0]
  if (issue?.message) {
    const path = (issue.path ?? []).join('.')
    return path ? `${path} - ${issue.message}` : issue.message
  }
  return body?.error || fallback
}
