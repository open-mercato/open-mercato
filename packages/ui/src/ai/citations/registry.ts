export const AI_CITATIONS_COMPONENT_ID = 'ai_assistant:citations'

export interface AiCitationRef {
  kind: string
  ref: string
  label?: string
  version?: string
  quote?: string
  locator?: string
  href?: string
  steps?: string[]
}

export interface AiCitationsPartPayload {
  citations: AiCitationRef[]
  title?: string
}

export interface ResolvedCitationStep {
  id: string
  text: string
}

export interface ResolvedCitation {
  title: string
  href?: string
  steps?: ResolvedCitationStep[]
}

export type CitationResolverResult = ResolvedCitation | null | undefined

export type CitationResolver = (
  citation: AiCitationRef,
) => CitationResolverResult | Promise<CitationResolverResult>

type CitationResolverStore = Map<string, CitationResolver>

const CITATION_RESOLVERS_GLOBAL_KEY = '__openMercatoAiCitationResolvers'

function getStore(): CitationResolverStore {
  const scope = globalThis as typeof globalThis & {
    [CITATION_RESOLVERS_GLOBAL_KEY]?: CitationResolverStore
  }
  if (!scope[CITATION_RESOLVERS_GLOBAL_KEY]) {
    scope[CITATION_RESOLVERS_GLOBAL_KEY] = new Map()
  }
  return scope[CITATION_RESOLVERS_GLOBAL_KEY]
}

function hasControlOrWhitespace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  }
  return /[\s\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/.test(value)
}

export function isSafeCitationHref(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (hasControlOrWhitespace(value)) return false
  if (value.includes('\\')) return false
  if (value.startsWith('/')) return !value.startsWith('//')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (!parsed.hostname) return false
  return value.toLowerCase().startsWith(`${parsed.protocol}//`)
}

export function isExternalCitationHref(href: string): boolean {
  return !href.startsWith('/')
}

export function registerCitationResolver(kind: string, resolver: CitationResolver): void {
  if (!kind) throw new Error('[internal] registerCitationResolver requires a non-empty kind')
  getStore().set(kind, resolver)
}

export function unregisterCitationResolver(kind: string): void {
  getStore().delete(kind)
}

export function getCitationResolver(kind: string): CitationResolver | null {
  return getStore().get(kind) ?? null
}

export function listCitationResolverKinds(): string[] {
  return Array.from(getStore().keys())
}

export function resetCitationResolversForTests(): void {
  getStore().clear()
}

export function fallbackCitation(citation: AiCitationRef): ResolvedCitation {
  const label = typeof citation.label === 'string' ? citation.label.trim() : ''
  const resolved: ResolvedCitation = { title: label || citation.ref }
  if (isSafeCitationHref(citation.href)) resolved.href = citation.href
  return resolved
}

function sanitizeResolved(
  result: CitationResolverResult,
  citation: AiCitationRef,
): ResolvedCitation {
  const fallback = fallbackCitation(citation)
  if (!result || typeof result !== 'object') return fallback
  const title = typeof result.title === 'string' && result.title.trim() ? result.title.trim() : fallback.title
  const resolved: ResolvedCitation = { title }
  if (isSafeCitationHref(result.href)) {
    resolved.href = result.href
  } else if (result.href === undefined && fallback.href) {
    resolved.href = fallback.href
  }
  if (Array.isArray(result.steps)) {
    const steps = result.steps.filter(
      (step): step is ResolvedCitationStep =>
        Boolean(step) && typeof step.id === 'string' && typeof step.text === 'string',
    )
    if (steps.length > 0) resolved.steps = steps
  }
  return resolved
}

export async function resolveCitation(citation: AiCitationRef): Promise<ResolvedCitation> {
  const resolver = getCitationResolver(citation.kind)
  if (!resolver) return fallbackCitation(citation)
  try {
    const result = await resolver(citation)
    return sanitizeResolved(result, citation)
  } catch {
    return fallbackCitation(citation)
  }
}
