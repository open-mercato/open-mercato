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
  const baseTokens = splitTokens(text, cfg.minTokenLength)
  const expanded = baseTokens.flatMap((token) => expandToken(token, cfg))
  const unique = Array.from(new Set(expanded))
  const tokens = unique.filter((token) => token.length >= cfg.minTokenLength)
  const hashes = tokens.map((token) => hashToken(token, cfg))
  return { tokens, hashes }
}
