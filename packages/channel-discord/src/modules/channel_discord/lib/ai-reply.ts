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

// Signals that a message is trying to steer the model rather than ask a
// question (prompt injection). Always propose-only — a human sees the attempt
// before anything is sent.
const INJECTION_SIGNALS = [
  /\bignore\b[\s\S]{0,60}\b(instructions?|prompts?|rules?)\b/i,
  /\bdisregard\b/i,
  /\bsystem\s*prompt\b/i,
  /\bjailbreak/i,
  /\bdeveloper\s+mode\b/i,
  /\byou\s+are\s+now\b/i,
  /\bnew\s+instructions?\b/i,
  /\bpretend\s+(to\s+be|you)\b/i,
  /\bact\s+as\b/i,
  /\brole\s*-?\s*play\b/i,
  /^\s*(system|assistant)\s*:/im,
]

// The bot must never act on content it would have to fetch — a link is a
// second, unvetted instruction channel.
const LINK_SIGNAL = /\bhttps?:\/\/|\bwww\.|\bdiscord\.gg\//i

// Zero-width, bidi-override, and word-joiner characters have no place in a
// legitimate support question; their presence means someone is hiding content
// from pattern matching (e.g. `re​fund`).
const INVISIBLE_CHARS = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/

/**
 * Build the copy of the text that signals are matched against. Defeats the
 * cheap obfuscations of a regex gate: compatibility forms (`ｒｅｆｕｎｄ` →
 * `refund`, NFKC), invisible characters, markdown emphasis/spoilers splitting a
 * keyword (`**ref**und`, `||refund||`), and combining-mark zalgo (NFKD + strip).
 */
function normalizeForClassification(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
    .replace(/[`*_~|]/g, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .trim()
}

function matchSignal(signals: RegExp[], raw: string, normalized: string): RegExp | null {
  for (const signal of signals) {
    if (signal.test(raw) || signal.test(normalized)) return signal
  }
  return null
}

/**
 * Classify an inbound Discord message as "easy" (bot may answer directly) vs
 * "complex" (propose-only, human approves). A deliberately conservative
 * heuristic — when in doubt it returns `complex` so nothing risky auto-sends.
 *
 * Hardening note: signals are matched against a normalized copy as well as the
 * raw text, and injection/link/obfuscation attempts force `complex`. This is
 * defense-in-depth layering, not a proof — the real containment for anything
 * that slips through is downstream: propose-only for complex, `features: []`,
 * `isSuperAdmin: false`, `allowed_mentions: { parse: [] }`, and the audited
 * outbound path.
 */
export function classifyDiscordMessage(body: string): ClassificationResult {
  const text = (body ?? '').trim()
  if (text.length === 0) {
    return { tier: 'complex', confidence: 0, reason: 'empty-body' }
  }
  if (INVISIBLE_CHARS.test(text)) {
    return { tier: 'complex', confidence: 0.95, reason: 'obfuscation-suspect' }
  }
  const normalized = normalizeForClassification(text)
  const injection = matchSignal(INJECTION_SIGNALS, text, normalized)
  if (injection) {
    return { tier: 'complex', confidence: 0.95, reason: `injection-suspect:${injection.source}` }
  }
  if (LINK_SIGNAL.test(text) || LINK_SIGNAL.test(normalized)) {
    return { tier: 'complex', confidence: 0.9, reason: 'contains-link' }
  }
  const complexSignal = matchSignal(COMPLEX_SIGNALS, text, normalized)
  if (complexSignal) {
    return { tier: 'complex', confidence: 0.9, reason: `matched:${complexSignal.source}` }
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
