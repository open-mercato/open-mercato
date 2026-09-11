export type ModelSummary = {
  readonly url: string
  readonly title?: string
  readonly summary?: string
}

/**
 * The leading whitespace stays inside the capture group rather than being eaten
 * by a `\s*` prefix: `\s*` and `[\s\S]*?` can both match the same whitespace,
 * which makes an unterminated fence backtrack quadratically (CodeQL polynomial
 * ReDoS). The matched span is identical either way, and `JSON.parse` ignores
 * leading whitespace.
 */
const FENCE = /```(?:json)?([\s\S]*?)```/

function coerceSummaries(value: unknown): ModelSummary[] {
  if (!Array.isArray(value)) return []
  const summaries: ModelSummary[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (url.length === 0) continue
    summaries.push({
      url,
      ...(typeof record.title === 'string' && record.title.trim().length > 0
        ? { title: record.title.trim() }
        : {}),
      ...(typeof record.summary === 'string' && record.summary.trim().length > 0
        ? { summary: record.summary.trim() }
        : {}),
    })
  }
  return summaries
}

/**
 * Pulls the per-source summaries out of the model's reply. Best-effort by design:
 * the summaries only ever enrich URLs that the search tool actually returned, so
 * a malformed or absent block costs snippets, never correctness.
 */
export function parseModelSummaries(text: string): ModelSummary[] {
  if (text.trim().length === 0) return []

  const fenced = FENCE.exec(text)
  if (fenced) {
    try {
      return coerceSummaries(JSON.parse(fenced[1]))
    } catch {
      // fall through to the bare-array scan
    }
  }

  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    return coerceSummaries(JSON.parse(text.slice(start, end + 1)))
  } catch {
    return []
  }
}

/** Removes the machine-readable block so the prose answer reads naturally. */
export function stripSummaryBlock(text: string): string {
  const withoutFence = text.replace(FENCE, '').trim()
  if (withoutFence.length > 0) return withoutFence
  const start = text.indexOf('[')
  if (start <= 0) return ''
  return text.slice(0, start).trim()
}
