import crypto from 'crypto'
import { resolveSearchConfig, resolveSearchTokenLimits, type SearchConfig } from './config'

export type TokenizationResult = {
  tokens: string[]
  hashes: string[]
}

/**
 * Latin letters that NFKD leaves intact because they are atomic codepoints rather than a
 * base letter plus a combining mark. Stripping combining marks therefore never folds them
 * to ASCII, and `splitTokens` then consumes them as separators \u2014 truncating `\u0141ukasz` to
 * `ukasz` and cutting `Za\u017c\u00f3\u0142\u0107` down to `zazo`. Because the same tokenizer runs at index
 * time and at query time, such a record becomes unreachable from every spelling. Only
 * characters with a single unambiguous ASCII fold belong here; anything language-dependent
 * must stay out.
 *
 * `normalizeText` applies this fold AFTER NFKD and mark stripping, and the order is
 * load-bearing: folding first would miss the characters that decompose *into* one of these
 * letters, such as `\u01ff` (U+01FF \u2192 `\u00f8` + U+0301), `\u01fd` (U+01FD), `\u01e3` (U+01E3) and `\u210f` (U+210F).
 * The letters below have no decomposition of their own, so NFKD passes them through
 * untouched and they still fold correctly in this position.
 */
const NON_DECOMPOSING_FOLDS: Record<string, string | undefined> = {
  '\u0142': 'l',
  '\u0141': 'L',
  '\u00f8': 'o',
  '\u00d8': 'O',
  '\u0111': 'd',
  '\u0110': 'D',
  '\u0127': 'h',
  '\u0126': 'H',
  '\u0131': 'i',
  '\u00e6': 'ae',
  '\u00c6': 'AE',
  '\u0153': 'oe',
  '\u0152': 'OE',
  '\u00df': 'ss',
  '\u1e9e': 'SS',
}

const NON_DECOMPOSING_PATTERN = new RegExp(
  `[${Object.keys(NON_DECOMPOSING_FOLDS)
    .join('')
    .replace(/[\\\]^-]/g, '\\$&')}]`,
  'g',
)

function foldNonDecomposingLetters(text: string): string {
  return text.replace(NON_DECOMPOSING_PATTERN, (char) => NON_DECOMPOSING_FOLDS[char] ?? char)
}

function normalizeText(text: string): string {
  return foldNonDecomposingLetters(text.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))
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
