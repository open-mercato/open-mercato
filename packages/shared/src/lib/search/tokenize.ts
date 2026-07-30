import crypto from 'crypto'
import { resolveSearchConfig, type SearchConfig } from './config'

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

function expandToken(token: string, config: SearchConfig): string[] {
  if (!config.enablePartials) return [token]
  const results: string[] = []
  for (let i = config.minTokenLength; i <= token.length; i += 1) {
    results.push(token.slice(0, i))
  }
  return results
}

export function hashToken(token: string, config?: SearchConfig): string {
  const cfg = config ?? resolveSearchConfig()
  return crypto.createHash(cfg.hashAlgorithm).update(token).digest('hex')
}

export function tokenizeText(text: string, config?: SearchConfig): TokenizationResult {
  const cfg = config ?? resolveSearchConfig()
  // #4681: truncate oversized field text before tokenizing so a single large
  // field (e.g. a long email body) cannot explode into tens of thousands of
  // partial-prefix tokens.
  const bounded = cfg.maxFieldChars > 0 && text.length > cfg.maxFieldChars
    ? text.slice(0, cfg.maxFieldChars)
    : text
  const baseTokens = splitTokens(bounded, cfg.minTokenLength)
  const expanded = baseTokens.flatMap((token) => expandToken(token, cfg))
  const unique = Array.from(new Set(expanded))
  const eligible = unique.filter((token) => token.length >= cfg.minTokenLength)
  // Cap tokens per field to keep the search_tokens fan-out bounded per record.
  const tokens = cfg.maxTokensPerField > 0 && eligible.length > cfg.maxTokensPerField
    ? eligible.slice(0, cfg.maxTokensPerField)
    : eligible
  const hashes = tokens.map((token) => hashToken(token, cfg))
  return { tokens, hashes }
}
