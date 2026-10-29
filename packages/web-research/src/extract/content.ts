import { BLOCK_ELEMENTS, NON_CONTENT_ELEMENTS, normalizeWhitespace } from './text'
import { tokenizeHtml } from './tokenizer'

const CANDIDATE_ELEMENTS = new Set(['article', 'main', 'section', 'div', 'td', 'body'])
const SEMANTIC_BONUS = new Set(['article', 'main'])

const NEGATIVE_HINT =
  /(^|[\s_-])(nav|navigation|menu|sidebar|side-bar|footer|masthead|comment|share|social|advert|promo|banner|cookie|consent|related|breadcrumb|pagination|widget|newsletter|subscribe)([\s_-]|$)/i
const POSITIVE_HINT = /(^|[\s_-])(article|content|post|story|entry|body-?text|main)([\s_-]|$)/i

/** Below this a candidate is treated as chrome rather than an article. */
const MIN_CONTENT_CHARS = 200

type BestRange = {
  readonly startPart: number
  readonly endPart: number
  readonly score: number
}

type Frame = {
  readonly name: string
  readonly startPart: number
  readonly hintScore: number
  textLength: number
  linkTextLength: number
  paragraphs: number
}

function hintScoreOf(attributes: ReadonlyMap<string, string>): number {
  const descriptor = `${attributes.get('class') ?? ''} ${attributes.get('id') ?? ''} ${attributes.get('role') ?? ''}`
  if (descriptor.trim().length === 0) return 0
  let score = 0
  if (NEGATIVE_HINT.test(descriptor)) score -= 600
  if (POSITIVE_HINT.test(descriptor)) score += 300
  return score
}

function scoreOf(frame: Frame): number {
  const semantic = SEMANTIC_BONUS.has(frame.name) ? 400 : 0
  return frame.textLength - 2 * frame.linkTextLength + 25 * frame.paragraphs + frame.hintScore + semantic
}

/**
 * Picks the subtree that reads like the article, using text-to-link density plus
 * paragraph count and class/id hints. Counters are accumulated during the single
 * tokenizer pass and only the winning range is materialized, so the scan stays
 * linear in time and the output allocates once.
 */
export function extractMainContent(html: string): string {
  const parts: string[] = []
  const stack: Frame[] = []
  const best: { current: BestRange | null } = { current: null }
  let linkDepth = 0
  let skipName: string | null = null
  let skipDepth = 0

  const closeFrame = (): void => {
    const frame = stack.pop()
    if (!frame) return
    const score = scoreOf(frame)
    if (frame.textLength >= MIN_CONTENT_CHARS && (best.current === null || score > best.current.score)) {
      best.current = { startPart: frame.startPart, endPart: parts.length, score }
    }
    const parent = stack[stack.length - 1]
    if (parent) {
      parent.textLength += frame.textLength
      parent.linkTextLength += frame.linkTextLength
      parent.paragraphs += frame.paragraphs
    }
  }

  for (const token of tokenizeHtml(html)) {
    if (token.kind === 'open') {
      if (skipName !== null) {
        if (token.name === skipName) skipDepth += 1
        continue
      }
      if (NON_CONTENT_ELEMENTS.has(token.name)) {
        skipName = token.name
        skipDepth = 1
        continue
      }
      if (BLOCK_ELEMENTS.has(token.name)) parts.push('\n')
      if (token.name === 'a') linkDepth += 1
      if (token.name === 'p') {
        const frame = stack[stack.length - 1]
        if (frame) frame.paragraphs += 1
      }
      if (CANDIDATE_ELEMENTS.has(token.name) && !token.selfClosing) {
        stack.push({
          name: token.name,
          startPart: parts.length,
          hintScore: hintScoreOf(token.attributes),
          textLength: 0,
          linkTextLength: 0,
          paragraphs: 0,
        })
      }
      continue
    }

    if (token.kind === 'close') {
      if (skipName !== null) {
        if (token.name === skipName) {
          skipDepth -= 1
          if (skipDepth <= 0) skipName = null
        }
        continue
      }
      if (BLOCK_ELEMENTS.has(token.name)) parts.push('\n')
      if (token.name === 'a' && linkDepth > 0) linkDepth -= 1
      if (CANDIDATE_ELEMENTS.has(token.name)) {
        // Unbalanced markup is common; only unwind to the nearest matching frame.
        const index = stack.findLastIndex((frame) => frame.name === token.name)
        if (index !== -1) {
          while (stack.length > index) closeFrame()
        }
      }
      continue
    }

    if (skipName !== null) continue
    parts.push(token.value)
    const frame = stack[stack.length - 1]
    if (!frame) continue
    const length = token.value.trim().length
    frame.textLength += length
    if (linkDepth > 0) frame.linkTextLength += length
  }

  while (stack.length > 0) closeFrame()

  const winner = best.current
  const selected = winner === null ? parts : parts.slice(winner.startPart, winner.endPart)
  return normalizeWhitespace(selected.join(''))
}
