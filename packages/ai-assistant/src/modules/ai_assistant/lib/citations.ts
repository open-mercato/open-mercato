import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { McpToolContext } from './types'

const logger = createLogger('ai_assistant').child({ component: 'citations' })

export const AI_CITATIONS_COMPONENT_ID = 'ai_assistant:citations'
export const AI_CITATIONS_MAX_PER_CALL = 20

function hasControlOrWhitespace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  }
  return /[\s\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/.test(value)
}

export function isSafeHref(value: unknown): boolean {
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

export const aiCitationSchema = z.object({
  kind: z.string().regex(/^[a-z0-9_.:-]{1,64}$/),
  ref: z.string().min(1).max(512),
  label: z.string().max(200).optional(),
  version: z.string().max(64).optional(),
  quote: z.string().max(1000).optional(),
  locator: z.string().max(200).optional(),
  href: z.string().max(2048).refine(isSafeHref, { message: 'Unsafe citation href' }).optional(),
  steps: z.array(z.string().max(64)).max(20).optional(),
})

export type AiCitation = z.infer<typeof aiCitationSchema>

export interface AiCitationsPartPayload {
  citations: AiCitation[]
  title?: string
}

export interface EmitCitationsOptions {
  title?: string
}

function citationKey(citation: AiCitation): string {
  return JSON.stringify([citation.kind, citation.ref, citation.locator ?? null])
}

export function normalizeCitations(citations: readonly unknown[]): AiCitation[] {
  const accepted: AiCitation[] = []
  const seen = new Set<string>()
  let invalid = 0
  for (const candidate of citations) {
    const parsed = aiCitationSchema.safeParse(candidate)
    if (!parsed.success) {
      invalid += 1
      continue
    }
    const key = citationKey(parsed.data)
    if (seen.has(key)) continue
    seen.add(key)
    accepted.push(parsed.data)
  }
  if (invalid > 0) logger.warn('Dropped invalid citations', { invalid })
  if (accepted.length > AI_CITATIONS_MAX_PER_CALL) {
    logger.warn('Citations capped per call', {
      emitted: accepted.length,
      cap: AI_CITATIONS_MAX_PER_CALL,
    })
    return accepted.slice(0, AI_CITATIONS_MAX_PER_CALL)
  }
  return accepted
}

export function emitCitations(
  ctx: Pick<McpToolContext, 'uiParts'> | null | undefined,
  citations: readonly unknown[],
  options: EmitCitationsOptions = {},
): AiCitation[] {
  const accepted = normalizeCitations(Array.isArray(citations) ? citations : [])
  if (accepted.length === 0 || !ctx?.uiParts) return accepted
  const title = typeof options.title === 'string' ? options.title.trim().slice(0, 200) : ''
  const payload: AiCitationsPartPayload = title ? { citations: accepted, title } : { citations: accepted }
  ctx.uiParts.enqueue({ componentId: AI_CITATIONS_COMPONENT_ID, payload })
  return accepted
}
