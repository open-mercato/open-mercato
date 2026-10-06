import { createHash } from 'node:crypto'
import { detectAttachmentMimeType, getAttachmentExtension } from './security'
import {
  readVectorImageRecord,
  type VectorImageRecord,
  VECTOR_IMAGE_MIME_TYPE,
  VECTOR_IMAGE_POLICY_VERSION,
  VECTOR_IMAGE_SANITIZER,
} from './vector-image-record'

export {
  hasVectorImageRecord,
  readVectorImageRecord,
  VECTOR_IMAGE_METADATA_KEY,
  VECTOR_IMAGE_MIME_TYPE,
  VECTOR_IMAGE_POLICY_VERSION,
  VECTOR_IMAGE_SANITIZER,
  type VectorImageRecord,
} from './vector-image-record'

export const VECTOR_IMAGE_MAX_BYTES = 1024 * 1024
export const VECTOR_IMAGE_MAX_ELEMENTS = 5_000
export const VECTOR_IMAGE_MAX_ATTRIBUTES_PER_ELEMENT = 64
export const VECTOR_IMAGE_MAX_ATTRIBUTES = 25_000
export const VECTOR_IMAGE_MAX_DEPTH = 64
export const VECTOR_IMAGE_MAX_USE_INSTANCES = 10_000
export const VECTOR_IMAGE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
export const DEFAULT_ATTACHMENT_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox"

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'

const RENDERING_ELEMENT_NAMESPACES = new Set([SVG_NAMESPACE, XHTML_NAMESPACE, MATHML_NAMESPACE])
const KEPT_ATTRIBUTE_NAMESPACES = new Set([XLINK_NAMESPACE, XML_NAMESPACE])
const KEPT_NAMESPACE_DECLARATIONS = new Set([SVG_NAMESPACE, XLINK_NAMESPACE])
const ANIMATION_ELEMENTS = new Set(['animate', 'animatecolor', 'animatemotion', 'animatetransform', 'set'])
const RASTER_DATA_URI_ELEMENTS = new Set(['image', 'feimage'])
const CSS_PARSED_ATTRIBUTES = new Set([
  'style',
  'fill',
  'stroke',
  'clip-path',
  'mask',
  'filter',
  'marker',
  'marker-start',
  'marker-mid',
  'marker-end',
  'cursor',
])
const CSS_STRING_URL_FUNCTIONS = new Set(['image', 'image-set', 'cross-fade', 'element', 'src', 'attr'])
const CSS_ACTIVE_FUNCTIONS = new Set(['expression'])
const CSS_ACTIVE_IDENTIFIERS = new Set(['behavior', '-moz-binding', 'javascript', 'vbscript'])
const RASTER_DATA_URI_PATTERN = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i
const ACTIVE_SCHEME_PATTERN = /^(?:javascript|vbscript|data):/i
const DTD_DECLARATION_PATTERN = /<!(?:ENTITY|ATTLIST|ELEMENT|NOTATION)/i
const DOCTYPE_PATTERN = /<!DOCTYPE/gi
const VENDOR_PREFIX_PATTERN = /^-[a-z0-9]+-/

const NODE_ELEMENT = 1
const NODE_CDATA_SECTION = 4
const NODE_PROCESSING_INSTRUCTION = 7
const NODE_COMMENT = 8
const NODE_DOCUMENT_TYPE = 10

export type VectorImageRejectionCode =
  | 'vector_image_too_large'
  | 'vector_image_malformed'
  | 'vector_image_entity_declaration'
  | 'vector_image_too_complex'
  | 'vector_image_unsafe_content'
  | 'vector_image_external_reference'
  | 'vector_image_sanitizer_unavailable'

export type VectorImageRemovalKind = 'inert' | 'active_content' | 'external_reference'

export type VectorImageRemoval = {
  kind: VectorImageRemovalKind
  target: string
}

export type VectorImageSanitizeResult =
  | { ok: true; buffer: Buffer; removals: VectorImageRemoval[]; sanitizerVersion: string }
  | { ok: false; code: VectorImageRejectionCode; removals: VectorImageRemoval[] }

export type PreparedVectorImage =
  | { ok: true; buffer: Buffer; record: VectorImageRecord; removals: VectorImageRemoval[] }
  | { ok: false; code: VectorImageRejectionCode; removals: VectorImageRemoval[] }

type DomNode = {
  nodeType: number
  nodeName: string
  parentNode: DomNode | null
  firstChild: DomNode | null
  lastChild: DomNode | null
  previousSibling: DomNode | null
  nextSibling: DomNode | null
  textContent: string | null
  removeChild(child: DomNode): unknown
  appendChild(child: DomNode): unknown
}

type DomAttribute = {
  name: string
  localName: string
  namespaceURI: string | null
  value: string
}

type DomAttributeList = {
  length: number
  item(index: number): DomAttribute | null
}

type DomElement = DomNode & {
  localName: string
  namespaceURI: string | null
  attributes: DomAttributeList
  getAttribute(name: string): string | null
  removeAttributeNode(attribute: DomAttribute): unknown
}

type DomDocument = DomNode & {
  documentElement: DomElement | null
  createTextNode(text: string): DomNode
  getElementsByTagName(name: string): { length: number }
}

type DomWindow = {
  DOMParser: new () => { parseFromString(text: string, type: string): DomDocument }
  XMLSerializer: new () => { serializeToString(node: DomNode): string }
  close(): void
}

type PurifyRemovedEntry = { element?: DomNode; attribute?: DomAttribute | null; from?: DomNode }

type PurifyInstance = {
  version: string
  removed: PurifyRemovedEntry[]
  sanitize(dirty: DomNode, config: Record<string, unknown>): unknown
}

type SanitizerRuntime = {
  createWindow(): DomWindow
  createPurify(window: DomWindow): PurifyInstance
}

let runtimePromise: Promise<SanitizerRuntime> | null = null

async function loadSanitizerRuntime(): Promise<SanitizerRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async (): Promise<SanitizerRuntime> => {
      const [{ JSDOM }, purifyModule] = await Promise.all([import('jsdom'), import('dompurify')])
      const createPurify = (purifyModule.default ?? purifyModule) as unknown as (window: unknown) => PurifyInstance
      return {
        createWindow: () => new JSDOM('').window as unknown as DomWindow,
        createPurify: (window: DomWindow) => createPurify(window),
      }
    })().catch((error) => {
      runtimePromise = null
      throw error
    })
  }
  return runtimePromise
}

export function isVectorImageUploadCandidate(
  buffer: Buffer,
  fileName: string,
  declaredMimeType: string | null | undefined,
): boolean {
  const extension = getAttachmentExtension(fileName)
  if (extension === 'svg') return true
  if (extension) return false
  const declared = String(declaredMimeType ?? '').trim().toLowerCase()
  if (declared === VECTOR_IMAGE_MIME_TYPE) return true
  return detectAttachmentMimeType(buffer, fileName, null) === VECTOR_IMAGE_MIME_TYPE
}

function decodeUtf8(buffer: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

/**
 * Refuses any DTD declaration and any DOCTYPE carrying an internal subset.
 * Quoted public/system identifiers are skipped as strings, so a `>` or `[`
 * inside them can neither end the DOCTYPE early nor hide the subset.
 */
export function hasDtdDeclarations(text: string): boolean {
  if (DTD_DECLARATION_PATTERN.test(text)) return true
  DOCTYPE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DOCTYPE_PATTERN.exec(text))) {
    let quote: string | null = null
    let index = match.index + match[0].length
    for (; index < text.length; index += 1) {
      const character = text[index]
      if (quote) {
        if (character === quote) quote = null
        continue
      }
      if (character === '"' || character === "'") {
        quote = character
        continue
      }
      if (character === '[') return true
      if (character === '>') break
    }
    DOCTYPE_PATTERN.lastIndex = Math.max(index, match.index + 1)
  }
  return false
}

function isElement(node: DomNode): node is DomElement {
  return node.nodeType === NODE_ELEMENT
}

/**
 * Pre-order walk over `firstChild`/`nextSibling` links. jsdom's live
 * `children`/`childNodes` collections are proxies whose indexed access is
 * linear, so copying them per node makes a flat 10,000-element document
 * quadratic. The visitor may remove the node it is given; returning false
 * skips that node's subtree.
 */
function walk(root: DomNode, visit: (node: DomNode, depth: number) => boolean): void {
  const nodes: DomNode[] = [root]
  const depths: number[] = [0]
  while (nodes.length) {
    const node = nodes.pop()!
    const depth = depths.pop()!
    if (!visit(node, depth)) continue
    for (let child = node.lastChild; child; child = child.previousSibling) {
      nodes.push(child)
      depths.push(depth + 1)
    }
  }
}

function attributesOf(element: DomElement): DomAttribute[] {
  const list = element.attributes
  const attributes: DomAttribute[] = []
  for (let index = 0; index < list.length; index += 1) {
    const attribute = list.item(index)
    if (attribute) attributes.push(attribute)
  }
  return attributes
}

/**
 * Bounds the work the later passes can be made to do. Element count and depth
 * bound every traversal; attributes are bounded per element as well as in
 * total because jsdom removes and re-sets an attribute in time linear in the
 * element's attribute count, and DOMPurify touches every attribute, so a
 * single element with tens of thousands of attributes is quadratic.
 */
function exceedsComplexityBounds(root: DomElement): boolean {
  let elements = 0
  let attributes = 0
  let exceeded = false
  walk(root, (node, level) => {
    if (exceeded || !isElement(node)) return false
    elements += 1
    const own = node.attributes.length
    attributes += own
    exceeded = elements > VECTOR_IMAGE_MAX_ELEMENTS
      || level + 1 > VECTOR_IMAGE_MAX_DEPTH
      || own > VECTOR_IMAGE_MAX_ATTRIBUTES_PER_ELEMENT
      || attributes > VECTOR_IMAGE_MAX_ATTRIBUTES
    return !exceeded
  })
  return exceeded
}

function removeNode(node: DomNode): void {
  node.parentNode?.removeChild(node)
}

function normaliseUrlValue(value: string): string {
  let normalised = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code > 0x20 && code !== 0x7f) normalised += character
  }
  return normalised
}

function hasRasterSignature(mimeType: string, base64: string): boolean {
  const bytes = Buffer.from(base64.replace(/\s+/g, ''), 'base64')
  return detectAttachmentMimeType(bytes, null, null) === mimeType.toLowerCase()
}

function isAllowedRasterDataUri(value: string): boolean {
  const match = RASTER_DATA_URI_PATTERN.exec(value.trim())
  if (!match) return false
  return hasRasterSignature(match[1]!, match[2]!)
}

function classifyReference(value: string, allowRasterData: boolean): VectorImageRemovalKind | null {
  const trimmed = value.trim()
  if (/^#[^\s#]+$/.test(trimmed)) return null
  if (allowRasterData && isAllowedRasterDataUri(trimmed)) return null
  if (ACTIVE_SCHEME_PATTERN.test(normaliseUrlValue(trimmed))) return 'active_content'
  return 'external_reference'
}

function isCssWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f'
}

function isCssNameCharacter(code: number): boolean {
  return (code >= 0x61 && code <= 0x7a)
    || (code >= 0x41 && code <= 0x5a)
    || (code >= 0x30 && code <= 0x39)
    || code === 0x2d
    || code === 0x5f
    || code >= 0x80
}

function readCssName(css: string, start: number): number {
  let end = start
  while (end < css.length && isCssNameCharacter(css.charCodeAt(end))) end += 1
  return end
}

/**
 * Classifies a stylesheet or a CSS-parsed attribute value by tokenising it the
 * way CSS Syntax Level 3 does: comments, quoted strings and `url(` tokens are
 * recognised as tokens, so a comment opener inside a string cannot hide what
 * follows it and a comment inside an unquoted `url(` stays part of the URL.
 *
 * Deliberately stricter than a browser: any escape (`\`), any string ended by
 * a newline or by the end of the stylesheet, any unterminated comment or
 * `url(` token and any malformed unquoted URL are refused as active content,
 * because each is a way to make two parsers disagree and logos need none.
 */
export function inspectVectorImageCss(css: string): VectorImageRemovalKind | null {
  let verdict: VectorImageRemovalKind | null = null
  let urlStringExpected = false
  let index = 0
  while (index < css.length) {
    const character = css[index]!
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2)
      if (end < 0) return 'active_content'
      index = end + 2
      continue
    }
    if (character === '\\') return 'active_content'
    if (character === '"' || character === "'") {
      let end = index + 1
      while (end < css.length && css[end] !== character) {
        const inner = css[end]
        if (inner === '\\' || inner === '\n' || inner === '\r' || inner === '\f') return 'active_content'
        end += 1
      }
      if (end >= css.length) return 'active_content'
      if (urlStringExpected) {
        const kind = classifyReference(css.slice(index + 1, end), true)
        if (kind === 'active_content') return kind
        verdict = verdict ?? kind
        urlStringExpected = false
      }
      index = end + 1
      continue
    }
    if (isCssWhitespace(character)) {
      index += 1
      continue
    }
    urlStringExpected = false
    if (character === '@') {
      const end = readCssName(css, index + 1)
      if (css.slice(index + 1, end).toLowerCase() === 'import') verdict = verdict ?? 'external_reference'
      index = Math.max(end, index + 1)
      continue
    }
    if (isCssNameCharacter(css.charCodeAt(index))) {
      const end = readCssName(css, index)
      const name = css.slice(index, end).toLowerCase()
      if (css[end] !== '(') {
        if (CSS_ACTIVE_IDENTIFIERS.has(name)) return 'active_content'
        index = end
        continue
      }
      const functionName = name.replace(VENDOR_PREFIX_PATTERN, '')
      if (functionName === 'url') {
        let start = end + 1
        while (isCssWhitespace(css[start])) start += 1
        if (css[start] === '"' || css[start] === "'") {
          urlStringExpected = true
          index = start
          continue
        }
        let close = start
        while (close < css.length && css[close] !== ')') {
          const inner = css[close]!
          if (inner === '"' || inner === "'" || inner === '(' || inner === '\\') return 'active_content'
          close += 1
        }
        if (close >= css.length) return 'active_content'
        const target = css.slice(start, close).trim()
        if (/\s/.test(target)) return 'active_content'
        const kind = classifyReference(target, true)
        if (kind === 'active_content') return kind
        verdict = verdict ?? kind
        index = close + 1
        continue
      }
      if (CSS_ACTIVE_FUNCTIONS.has(functionName)) return 'active_content'
      if (CSS_STRING_URL_FUNCTIONS.has(functionName)) verdict = verdict ?? 'external_reference'
      index = end + 1
      continue
    }
    index += 1
  }
  return verdict
}

function describeElement(node: DomNode): string {
  return `element:${node.nodeName}`
}

function describeAttribute(attribute: DomAttribute, owner?: DomNode | null): string {
  return owner ? `attribute:${owner.nodeName}@${attribute.name}` : `attribute:${attribute.name}`
}

function containsRenderingElement(element: DomElement): boolean {
  let found = false
  walk(element, (node) => {
    if (found || !isElement(node)) return false
    if (node !== element && RENDERING_ELEMENT_NAMESPACES.has(node.namespaceURI ?? '')) found = true
    return !found
  })
  return found
}

function isStyleElement(element: DomElement): boolean {
  return element.namespaceURI === SVG_NAMESPACE && element.localName === 'style'
}

/**
 * Design tools wrap stylesheets in CDATA, which DOMPurify drops as a node.
 * The CDATA text becomes an ordinary text node so the stylesheet survives
 * sanitisation and is still inspected by the CSS policy afterwards.
 */
function flattenStyleCdata(document: DomDocument, style: DomElement): void {
  let hasCdata = false
  for (let child = style.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === NODE_CDATA_SECTION) hasCdata = true
  }
  if (!hasCdata) return
  const text = style.textContent ?? ''
  while (style.firstChild) style.removeChild(style.firstChild)
  style.appendChild(document.createTextNode(text))
}

function prepareForPurify(document: DomDocument, removals: VectorImageRemoval[]): void {
  walk(document, (node) => {
    if (node === document) return true
    if (node.nodeType === NODE_COMMENT || node.nodeType === NODE_DOCUMENT_TYPE) {
      removals.push({ kind: 'inert', target: node.nodeType === NODE_COMMENT ? 'comment' : 'doctype' })
      removeNode(node)
      return false
    }
    if (node.nodeType === NODE_PROCESSING_INSTRUCTION) {
      const isStylesheet = node.nodeName.toLowerCase() === 'xml-stylesheet'
      removals.push({
        kind: isStylesheet ? 'external_reference' : 'inert',
        target: `processing-instruction:${node.nodeName}`,
      })
      removeNode(node)
      return false
    }
    if (!isElement(node)) return false
    const namespace = node.namespaceURI ?? ''
    const isForeign = !RENDERING_ELEMENT_NAMESPACES.has(namespace)
    const isMetadata = namespace === SVG_NAMESPACE && node.localName === 'metadata'
    if (isForeign || isMetadata) {
      removals.push({
        kind: containsRenderingElement(node) ? 'active_content' : 'inert',
        target: describeElement(node),
      })
      removeNode(node)
      return false
    }
    for (const attribute of attributesOf(node)) {
      const attributeNamespace = attribute.namespaceURI
      if (attributeNamespace === null || KEPT_ATTRIBUTE_NAMESPACES.has(attributeNamespace)) continue
      if (attributeNamespace === XMLNS_NAMESPACE) {
        if (KEPT_NAMESPACE_DECLARATIONS.has(attribute.value)) continue
      } else {
        removals.push({ kind: 'inert', target: describeAttribute(attribute, node) })
      }
      node.removeAttributeNode(attribute)
    }
    if (isStyleElement(node)) {
      flattenStyleCdata(document, node)
      return false
    }
    return true
  })
}

function isHrefAttribute(attribute: DomAttribute): boolean {
  if (attribute.localName.toLowerCase() !== 'href') return false
  return attribute.namespaceURI === null || attribute.namespaceURI === XLINK_NAMESPACE
}

function looksLikeReference(value: string): boolean {
  return /url\s*\(|:/i.test(value)
}

function classifyPurifyRemoval(entry: PurifyRemovedEntry): VectorImageRemoval {
  if (entry.attribute) {
    const name = entry.attribute.name.toLowerCase()
    const isHandler = /^on/.test(entry.attribute.localName.toLowerCase())
    const isLink = name.endsWith('href') || name === 'src' || name === 'style'
    const inert = !isHandler && !isLink && !looksLikeReference(entry.attribute.value ?? '')
    return { kind: inert ? 'inert' : 'active_content', target: describeAttribute(entry.attribute, entry.from) }
  }
  return { kind: 'active_content', target: entry.element ? describeElement(entry.element) : 'element' }
}

function inspectAttribute(tag: string, attribute: DomAttribute): VectorImageRemovalKind | null {
  if (isHrefAttribute(attribute)) return classifyReference(attribute.value, RASTER_DATA_URI_ELEMENTS.has(tag))
  if (attribute.namespaceURI !== null) return null
  const name = attribute.localName.toLowerCase()
  if (CSS_PARSED_ATTRIBUTES.has(name) || /url\s*\(/i.test(attribute.value)) {
    return inspectVectorImageCss(attribute.value)
  }
  return null
}

function applyReferencePolicy(root: DomElement, removals: VectorImageRemoval[]): void {
  walk(root, (node) => {
    if (!isElement(node)) return false
    const tag = node.localName.toLowerCase()
    if (ANIMATION_ELEMENTS.has(tag)) {
      const target = (node.getAttribute('attributeName') ?? '').trim().toLowerCase()
      if (target === 'href' || target.endsWith(':href')) {
        removals.push({ kind: 'active_content', target: describeElement(node) })
        removeNode(node)
        return false
      }
    }
    if (tag === 'style') {
      const verdict = inspectVectorImageCss(node.textContent ?? '')
      if (verdict) {
        removals.push({ kind: verdict, target: describeElement(node) })
        removeNode(node)
        return false
      }
    }
    for (const attribute of attributesOf(node)) {
      const verdict = inspectAttribute(tag, attribute)
      if (!verdict) continue
      removals.push({ kind: verdict, target: describeAttribute(attribute, node) })
      node.removeAttributeNode(attribute)
    }
    return true
  })
}

function referencedId(element: DomElement): string | null {
  for (const attribute of attributesOf(element)) {
    if (!isHrefAttribute(attribute)) continue
    const value = attribute.value.trim()
    if (value.startsWith('#')) return value.slice(1)
  }
  return null
}

function firstIndexAtLeast(values: number[], minimum: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (values[middle]! < minimum) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Counts how many element instances in-document `<use>` references expand to
 * at render time. One pre-order pass records each element's pre-order range,
 * so the `<use>` elements inside a referenced subtree are a contiguous slice
 * of the pre-order list, and each referenced subtree is expanded once
 * (memoised). A reference cycle counts as unbounded.
 */
function exceedsUseExpansion(root: DomElement): boolean {
  const byId = new Map<string, DomElement>()
  const rangeStart = new Map<DomElement, number>()
  const rangeEnd = new Map<DomElement, number>()
  const usePositions: number[] = []
  const useElements: DomElement[] = []
  const open: Array<{ element: DomElement; depth: number }> = []
  let position = 0
  walk(root, (node, depth) => {
    if (!isElement(node)) return false
    while (open.length && open[open.length - 1]!.depth >= depth) rangeEnd.set(open.pop()!.element, position)
    rangeStart.set(node, position)
    open.push({ element: node, depth })
    const id = node.getAttribute('id')
    if (id && !byId.has(id)) byId.set(id, node)
    if (node.localName === 'use') {
      usePositions.push(position)
      useElements.push(node)
    }
    position += 1
    return true
  })
  while (open.length) rangeEnd.set(open.pop()!.element, position)

  const memo = new Map<DomElement, number>()
  const visiting = new Set<DomElement>()
  const expand = (element: DomElement): number => {
    const cached = memo.get(element)
    if (cached !== undefined) return cached
    if (visiting.has(element)) return Number.POSITIVE_INFINITY
    visiting.add(element)
    const first = firstIndexAtLeast(usePositions, rangeStart.get(element)!)
    const end = rangeEnd.get(element)!
    let total = 0
    for (let index = first; index < useElements.length && usePositions[index]! < end; index += 1) {
      const targetId = referencedId(useElements[index]!)
      const target = targetId ? byId.get(targetId) : undefined
      total += 1 + (target ? expand(target) : 0)
      if (total > VECTOR_IMAGE_MAX_USE_INSTANCES) break
    }
    visiting.delete(element)
    memo.set(element, total)
    return total
  }
  return expand(root) > VECTOR_IMAGE_MAX_USE_INSTANCES
}

function parseError(document: DomDocument): boolean {
  return document.getElementsByTagName('parsererror').length > 0
}

/**
 * Sanitises an SVG document with DOMPurify's SVG profile on a fresh jsdom
 * window, then applies the vector-image reference and CSS policy. Always
 * returns a document free of the removed content when it can parse the input;
 * the caller decides from `removals` whether that document may be stored.
 */
export async function sanitizeVectorImage(buffer: Buffer): Promise<VectorImageSanitizeResult> {
  const removals: VectorImageRemoval[] = []
  if (buffer.length > VECTOR_IMAGE_MAX_BYTES) return { ok: false, code: 'vector_image_too_large', removals }
  const text = decodeUtf8(buffer)
  if (text === null) return { ok: false, code: 'vector_image_malformed', removals }
  if (hasDtdDeclarations(text)) return { ok: false, code: 'vector_image_entity_declaration', removals }

  let runtime: SanitizerRuntime
  try {
    runtime = await loadSanitizerRuntime()
  } catch {
    return { ok: false, code: 'vector_image_sanitizer_unavailable', removals }
  }

  const window = runtime.createWindow()
  try {
    let document: DomDocument
    try {
      document = new window.DOMParser().parseFromString(text, VECTOR_IMAGE_MIME_TYPE)
    } catch {
      return { ok: false, code: 'vector_image_malformed', removals }
    }
    const root = document.documentElement
    if (!root || parseError(document) || root.namespaceURI !== SVG_NAMESPACE || root.localName !== 'svg') {
      return { ok: false, code: 'vector_image_malformed', removals }
    }
    if (exceedsComplexityBounds(root)) return { ok: false, code: 'vector_image_too_complex', removals }

    prepareForPurify(document, removals)

    const purify = runtime.createPurify(window)
    purify.sanitize(root, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['use'],
      ADD_DATA_URI_TAGS: ['feimage'],
      KEEP_CONTENT: false,
      IN_PLACE: true,
    })
    for (const entry of purify.removed) removals.push(classifyPurifyRemoval(entry))

    applyReferencePolicy(root, removals)

    if (exceedsUseExpansion(root)) return { ok: false, code: 'vector_image_too_complex', removals }

    const serialised = Buffer.from(new window.XMLSerializer().serializeToString(root), 'utf8')
    if (serialised.length > VECTOR_IMAGE_MAX_BYTES) return { ok: false, code: 'vector_image_too_large', removals }
    return { ok: true, buffer: serialised, removals, sanitizerVersion: purify.version }
  } finally {
    window.close()
  }
}

export function hashVectorImage(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Upload policy on top of `sanitizeVectorImage`: the sanitised document is
 * stored only when every removal was inert (comments, editor metadata,
 * non-rendering foreign elements). Anything else means the stored file would
 * differ from what the user uploaded, so it is rejected with a reason.
 */
export async function prepareVectorImageUpload(buffer: Buffer, now: Date = new Date()): Promise<PreparedVectorImage> {
  const result = await sanitizeVectorImage(buffer)
  if (!result.ok) return result
  if (result.removals.some((removal) => removal.kind === 'active_content')) {
    return { ok: false, code: 'vector_image_unsafe_content', removals: result.removals }
  }
  if (result.removals.some((removal) => removal.kind === 'external_reference')) {
    return { ok: false, code: 'vector_image_external_reference', removals: result.removals }
  }
  return {
    ok: true,
    buffer: result.buffer,
    removals: result.removals,
    record: {
      sanitizer: VECTOR_IMAGE_SANITIZER,
      sanitizerVersion: result.sanitizerVersion,
      policyVersion: VECTOR_IMAGE_POLICY_VERSION,
      sha256: hashVectorImage(result.buffer),
      sanitizedAt: now.toISOString(),
    },
  }
}

/**
 * True only for an attachment stored through the sanitised vector path whose
 * bytes still match the digest recorded at upload. Every other SVG-typed row
 * keeps the download-only treatment.
 */
export function isTrustedVectorImage(
  attachment: { mimeType?: string | null; storageMetadata?: unknown },
  buffer: Buffer,
): boolean {
  if (String(attachment.mimeType ?? '').trim().toLowerCase() !== VECTOR_IMAGE_MIME_TYPE) return false
  const record = readVectorImageRecord(attachment.storageMetadata)
  if (!record) return false
  return hashVectorImage(buffer) === record.sha256
}
