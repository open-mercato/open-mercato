import { decodeEntities } from './entities'

export type HtmlToken =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'open'
      readonly name: string
      readonly attributes: ReadonlyMap<string, string>
      readonly selfClosing: boolean
    }
  | { readonly kind: 'close'; readonly name: string }

/**
 * Bounds memory for a pathological document. The tokenizer itself is linear and
 * cannot stall the event loop, so this is an allocation guard rather than the
 * ReDoS mitigation a regex-based extractor would need it to be.
 */
export const MAX_HTML_INPUT = 8 * 1024 * 1024

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const RAW_TEXT_ELEMENTS = new Set(['script', 'style'])

function isNameStart(character: string): boolean {
  return (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z')
}

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f'
}

type ParsedTag = {
  readonly name: string
  readonly attributes: Map<string, string>
  readonly selfClosing: boolean
  readonly end: number
}

/**
 * Reads one start tag beginning at the character after `<`. Quote-aware so an
 * attribute value containing `>` does not truncate the tag.
 */
function readStartTag(html: string, start: number): ParsedTag | null {
  let position = start
  while (position < html.length && !isWhitespace(html[position]) && html[position] !== '>' && html[position] !== '/') {
    position += 1
  }
  const name = html.slice(start, position).toLowerCase()
  if (name.length === 0) return null

  const attributes = new Map<string, string>()
  let selfClosing = false

  while (position < html.length) {
    while (position < html.length && isWhitespace(html[position])) position += 1
    if (position >= html.length) break
    if (html[position] === '>') {
      position += 1
      break
    }
    if (html[position] === '/') {
      selfClosing = true
      position += 1
      continue
    }

    const nameStart = position
    while (
      position < html.length &&
      !isWhitespace(html[position]) &&
      html[position] !== '=' &&
      html[position] !== '>' &&
      html[position] !== '/'
    ) {
      position += 1
    }
    const attributeName = html.slice(nameStart, position).toLowerCase()
    if (attributeName.length === 0) {
      position += 1
      continue
    }

    while (position < html.length && isWhitespace(html[position])) position += 1
    if (html[position] !== '=') {
      attributes.set(attributeName, '')
      continue
    }
    position += 1
    while (position < html.length && isWhitespace(html[position])) position += 1

    const quote = html[position]
    if (quote === '"' || quote === "'") {
      const valueStart = position + 1
      const valueEnd = html.indexOf(quote, valueStart)
      if (valueEnd === -1) {
        attributes.set(attributeName, decodeEntities(html.slice(valueStart)))
        position = html.length
        break
      }
      attributes.set(attributeName, decodeEntities(html.slice(valueStart, valueEnd)))
      position = valueEnd + 1
      continue
    }

    const valueStart = position
    while (position < html.length && !isWhitespace(html[position]) && html[position] !== '>') position += 1
    attributes.set(attributeName, decodeEntities(html.slice(valueStart, position)))
  }

  return { name, attributes, selfClosing: selfClosing || VOID_ELEMENTS.has(name), end: position }
}

/**
 * Single forward scan over HTML emitting structural tokens. Every advance is
 * driven by `indexOf` or a bounded character walk, so there is no backtracking
 * and runtime is linear in the input length.
 */
export function* tokenizeHtml(rawHtml: string): Generator<HtmlToken> {
  const html = rawHtml.length > MAX_HTML_INPUT ? rawHtml.slice(0, MAX_HTML_INPUT) : rawHtml
  // Lowercased once: searching for a raw-text close tag inside the loop would
  // otherwise copy the whole document per <script>/<style>.
  let lowerHtml: string | null = null
  let position = 0

  while (position < html.length) {
    const angle = html.indexOf('<', position)
    if (angle === -1) {
      const text = html.slice(position)
      if (text.length > 0) yield { kind: 'text', value: decodeEntities(text) }
      return
    }
    if (angle > position) {
      yield { kind: 'text', value: decodeEntities(html.slice(position, angle)) }
    }

    const next = html[angle + 1]

    if (next === '!') {
      if (html.startsWith('<!--', angle)) {
        const close = html.indexOf('-->', angle + 4)
        position = close === -1 ? html.length : close + 3
        continue
      }
      const close = html.indexOf('>', angle + 2)
      position = close === -1 ? html.length : close + 1
      continue
    }

    if (next === '/') {
      const close = html.indexOf('>', angle + 2)
      const end = close === -1 ? html.length : close
      const name = html.slice(angle + 2, end).trim().toLowerCase()
      if (name.length > 0) yield { kind: 'close', name }
      position = close === -1 ? html.length : close + 1
      continue
    }

    if (next === undefined || !isNameStart(next)) {
      yield { kind: 'text', value: '<' }
      position = angle + 1
      continue
    }

    const tag = readStartTag(html, angle + 1)
    if (tag === null) {
      yield { kind: 'text', value: '<' }
      position = angle + 1
      continue
    }
    yield { kind: 'open', name: tag.name, attributes: tag.attributes, selfClosing: tag.selfClosing }
    position = tag.end

    if (RAW_TEXT_ELEMENTS.has(tag.name) && !tag.selfClosing) {
      lowerHtml ??= html.toLowerCase()
      const close = lowerHtml.indexOf(`</${tag.name}`, position)
      position = close === -1 ? html.length : close
      continue
    }

    if (tag.selfClosing) yield { kind: 'close', name: tag.name }
  }
}
