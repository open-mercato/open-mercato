import {
  AI_CITATIONS_COMPONENT_ID,
  type AiCitationRef,
  type AiCitationsPartPayload,
} from './registry'

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readCitation(value: unknown): AiCitationRef | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const kind = readOptionalString(record.kind)
  const ref = readOptionalString(record.ref)
  if (!kind || !ref) return null
  const citation: AiCitationRef = { kind, ref }
  const label = readOptionalString(record.label)
  if (label) citation.label = label
  const version = readOptionalString(record.version)
  if (version) citation.version = version
  const quote = readOptionalString(record.quote)
  if (quote) citation.quote = quote
  const locator = readOptionalString(record.locator)
  if (locator) citation.locator = locator
  const href = readOptionalString(record.href)
  if (href) citation.href = href
  if (Array.isArray(record.steps)) {
    const steps = record.steps.filter((step): step is string => typeof step === 'string')
    if (steps.length > 0) citation.steps = steps
  }
  return citation
}

function citationKey(citation: AiCitationRef): string {
  return JSON.stringify([citation.kind, citation.ref, citation.locator ?? null])
}

export function readCitationsPayload(payload: unknown): AiCitationsPartPayload {
  if (!payload || typeof payload !== 'object') return { citations: [] }
  const record = payload as Record<string, unknown>
  const source = Array.isArray(record.citations) ? record.citations : []
  const citations: AiCitationRef[] = []
  const seen = new Set<string>()
  for (const candidate of source) {
    const citation = readCitation(candidate)
    if (!citation) continue
    const key = citationKey(citation)
    if (seen.has(key)) continue
    seen.add(key)
    citations.push(citation)
  }
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  return title ? { citations, title } : { citations }
}

export interface MergeableAiUiPart {
  componentId: string
  payload?: unknown
}

export function mergeConsecutiveCitationParts<T extends MergeableAiUiPart>(parts: readonly T[]): T[] {
  const merged: T[] = []
  for (const part of parts) {
    const previous = merged[merged.length - 1]
    if (
      part.componentId !== AI_CITATIONS_COMPONENT_ID ||
      !previous ||
      previous.componentId !== AI_CITATIONS_COMPONENT_ID
    ) {
      merged.push(part)
      continue
    }
    const left = readCitationsPayload(previous.payload)
    const right = readCitationsPayload(part.payload)
    const combined = readCitationsPayload({
      citations: [...left.citations, ...right.citations],
      title: left.title ?? right.title,
    })
    merged[merged.length - 1] = { ...previous, payload: combined }
  }
  return merged
}
