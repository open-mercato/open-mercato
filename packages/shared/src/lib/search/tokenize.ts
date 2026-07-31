import crypto from 'crypto'
import { resolveSearchConfig, resolveTokenCaps, type SearchConfig } from './config'

export type TokenizationResult = {
  tokens: string[]
  hashes: string[]
}

function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[%_]/g, ' ')
    .toLowerCase()
}

function splitTokens(text: string, minLength: number): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= minLength)
}

// #4681: expand prefixes into the shared collector while honoring a running
// budget so a single very long token cannot materialize tens of thousands of
// progressively larger strings before a post-hoc slice. Returns false when the
// per-field budget is exhausted so the caller can stop early.
function collectExpandedTokens(
  token: string,
  config: SearchConfig,
  minTokenLength: number,
  seen: Set<string>,
  out: string[],
  remainingBudget: number,
): number {
  if (remainingBudget <= 0) return 0
  let added = 0
  const push = (candidate: string): boolean => {
    if (candidate.length < minTokenLength) return true
    if (seen.has(candidate)) return true
    seen.add(candidate)
    out.push(candidate)
    added += 1
    return added < remainingBudget
  }
  if (!config.enablePartials) {
    push(token)
    return added
  }
  for (let i = minTokenLength; i <= token.length; i += 1) {
    if (!push(token.slice(0, i))) break
  }
  return added
}

export function hashToken(token: string, config?: SearchConfig): string {
  const cfg = config ?? resolveSearchConfig()
  return crypto.createHash(cfg.hashAlgorithm).update(token).digest('hex')
}

export function tokenizeText(text: string, config?: SearchConfig): TokenizationResult {
  const cfg = config ?? resolveSearchConfig()
  const caps = resolveTokenCaps(cfg)
  // #4681: truncate oversized field text before tokenizing so a single large
  // field (e.g. a long email body) cannot explode into tens of thousands of
  // partial-prefix tokens.
  const bounded = caps.maxFieldChars > 0 && text.length > caps.maxFieldChars
    ? text.slice(0, caps.maxFieldChars)
    : text
  const baseTokens = splitTokens(bounded, cfg.minTokenLength)
  const fieldBudget = caps.maxTokensPerField > 0 ? caps.maxTokensPerField : Number.POSITIVE_INFINITY
  const seen = new Set<string>()
  const tokens: string[] = []
  let remaining = fieldBudget
  for (const token of baseTokens) {
    if (remaining <= 0) break
    remaining -= collectExpandedTokens(token, cfg, cfg.minTokenLength, seen, tokens, remaining)
  }
  const hashes = tokens.map((token) => hashToken(token, cfg))
  return { tokens, hashes }
}
