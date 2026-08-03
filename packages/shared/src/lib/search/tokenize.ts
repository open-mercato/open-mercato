import crypto from 'crypto'
import { resolveSearchConfig, resolveSearchTokenLimits, type SearchConfig } from './config'

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

function appendExpandedToken(
  token: string,
  config: SearchConfig,
  seen: Set<string>,
  tokens: string[],
  limit: number,
): void {
  const append = (candidate: string): boolean => {
    if (seen.has(candidate)) return tokens.length < limit
    seen.add(candidate)
    tokens.push(candidate)
    return tokens.length < limit
  }

  if (!config.enablePartials) {
    append(token)
    return
  }

  for (let length = config.minTokenLength; length <= token.length; length += 1) {
    if (!append(token.slice(0, length))) return
  }
}

export function hashToken(token: string, config?: SearchConfig): string {
  const cfg = config ?? resolveSearchConfig()
  return crypto.createHash(cfg.hashAlgorithm).update(token).digest('hex')
}

export function tokenizeText(text: string, config?: SearchConfig): TokenizationResult {
  const cfg = config ?? resolveSearchConfig()
  const limits = resolveSearchTokenLimits(cfg)
  const boundedText = limits.maxFieldChars > 0 ? text.slice(0, limits.maxFieldChars) : text
  const tokenLimit = limits.maxTokensPerField > 0 ? limits.maxTokensPerField : Number.POSITIVE_INFINITY
  const seen = new Set<string>()
  const tokens: string[] = []

  for (const token of splitTokens(boundedText, cfg.minTokenLength)) {
    if (tokens.length >= tokenLimit) break
    appendExpandedToken(token, cfg, seen, tokens, tokenLimit)
  }

  const hashes = tokens.map((token) => hashToken(token, cfg))
  return { tokens, hashes }
}
