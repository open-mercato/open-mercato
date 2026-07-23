import { discordChannelStateSchema, type DiscordChannelState } from './credentials'

/**
 * AI auto-reply helpers (SPEC 2026-06-19 § AI bot wiring).
 *
 * `ai_assistant` is an OPTIONAL peer. This module never statically imports it;
 * the subscriber resolves it softly via DI (`mcpToolRegistry`) and, only when it
 * is present AND per-channel auto-reply is enabled, dynamically imports
 * `runAiAgentText`. When the peer is absent the subscriber no-ops and the channel
 * still works as a plain inbox (module-decoupling contract).
 */

export type ReplyTier = 'easy' | 'complex'

export interface ClassificationResult {
  tier: ReplyTier
  confidence: number
  reason: string
}

// Signals that a message needs a human (mutations, escalation, sensitive topics).
// The bot never auto-answers these — it proposes for approval instead (SPEC-056
// easy-vs-complex tiering).
const COMPLEX_SIGNALS = [
  /\brefund\b/i,
  /\bcancel\b/i,
  /\binvoice\b/i,
  /\bchargeback\b/i,
  /\bcomplain/i,
  /\bescalat/i,
  /\blegal\b/i,
  /\bhuman\b/i,
  /\bagent\b/i,
  /\bmanager\b/i,
  /\border\b/i,
  /\bpayment\b/i,
  /\bprice\b/i,
  /\bdiscount\b/i,
]

/**
 * Classify an inbound Discord message as "easy" (bot may answer directly) vs
 * "complex" (propose-only, human approves). A deliberately conservative
 * heuristic — when in doubt it returns `complex` so nothing risky auto-sends.
 */
export function classifyDiscordMessage(body: string): ClassificationResult {
  const text = (body ?? '').trim()
  if (text.length === 0) {
    return { tier: 'complex', confidence: 0, reason: 'empty-body' }
  }
  for (const signal of COMPLEX_SIGNALS) {
    if (signal.test(text)) {
      return { tier: 'complex', confidence: 0.9, reason: `matched:${signal.source}` }
    }
  }
  // Long messages or multi-question threads are more likely to need nuance.
  const questionCount = (text.match(/\?/g) ?? []).length
  if (text.length > 600 || questionCount > 2) {
    return { tier: 'complex', confidence: 0.6, reason: 'long-or-multi-question' }
  }
  return { tier: 'easy', confidence: 0.8, reason: 'short-simple' }
}

/** Per-channel AI auto-reply is OFF unless explicitly enabled on channel state. */
export function isAiAutoReplyEnabled(channelState: unknown): boolean {
  const parsed = discordChannelStateSchema.safeParse(channelState ?? {})
  return parsed.success ? Boolean(parsed.data.aiAutoReplyEnabled) : false
}

export function resolveAiAgentId(channelState: unknown): string | undefined {
  const parsed = discordChannelStateSchema.safeParse(channelState ?? {})
  return parsed.success ? parsed.data.aiAgentId : undefined
}

export interface SubscriberResolver {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
}

/**
 * Soft presence check for the `ai_assistant` module. The module registers
 * `mcpToolRegistry` in DI, so a successful resolve means the peer is active.
 * Returns `false` (no-op) when it is absent — never throws.
 */
export function isAiAssistantAvailable(ctx: SubscriberResolver): boolean {
  const resolver =
    typeof ctx?.resolve === 'function'
      ? ctx.resolve
      : ctx?.container?.resolve
        ? ctx.container.resolve.bind(ctx.container)
        : null
  if (!resolver) return false
  try {
    return Boolean(resolver('mcpToolRegistry'))
  } catch {
    return false
  }
}

export type { DiscordChannelState }
