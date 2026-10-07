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
export const VECTOR_IMAGE_MAX_ELEMENTS = 2_000
export const VECTOR_IMAGE_MAX_ATTRIBUTES_PER_ELEMENT = 64
export const VECTOR_IMAGE_MAX_ATTRIBUTES = 6_000
export const VECTOR_IMAGE_MAX_DEPTH = 64
export const VECTOR_IMAGE_MAX_NODES = 4_000
export const VECTOR_IMAGE_MAX_MARKUP = 4_000
export const VECTOR_IMAGE_MAX_RENDERED_ELEMENTS = 50_000
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
const REFERENCED_ATTRIBUTES = new Set(['id', 'name', 'class', 'attributename'])
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
const RASTER_DATA_URI_PATTERN = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\t\n\f\r ]+)$/i
const ACTIVE_SCHEME_PATTERN = /^(?:javascript|vbscript|data):/i
const DTD_DECLARATION_PATTERN = /<!(?:ENTITY|ATTLIST|ELEMENT|NOTATION)/i
const VENDOR_PREFIX_PATTERN = /^-[a-z0-9]+-/
const PAINTED_ELEMENTS = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'textpath'])
const MARKABLE_ELEMENTS = new Set(['path', 'line', 'polyline', 'polygon'])
const NON_INHERITED_REFERENCE_PROPERTIES = new Set(['clip-path', 'mask', 'filter'])
const STYLESHEET_GROUPING_RULES = new Set(['media', 'supports', 'layer', 'container', 'scope', 'document', '-moz-document', 'starting-style'])
const SELECTOR_COMBINATORS = new Set([' ', '\t', '\n', '\r', '\f', '>', '+', '~'])

const NODE_ELEMENT = 1
const NODE_TEXT = 3
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

export type VectorImageFindingKind = Exclude<VectorImageRemovalKind, 'inert'>

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

type DomAttributeWithPrefix = DomAttribute & { prefix: string | null }

type DomElement = DomNode & {
  localName: string
  namespaceURI: string | null
  attributes: DomAttributeList
  getAttribute(name: string): string | null
  removeAttributeNode(attribute: DomAttribute): unknown
  setAttributeNS(namespace: string, qualifiedName: string, value: string): void
}

type VectorImageFinding = VectorImageRemoval & { kind: VectorImageFindingKind }

const PURIFY_ABORT = Symbol('vector-image-purify-abort')

type PurifyAbort = { [PURIFY_ABORT]: VectorImageFinding }

function isPurifyAbort(error: unknown): error is PurifyAbort {
  return Boolean(error) && typeof error === 'object' && PURIFY_ABORT in (error as object)
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
  addHook(entryPoint: 'beforeSanitizeElements', hook: () => void): void
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

function skipQuotedDoctype(text: string, start: number): { end: number; hasSubset: boolean } {
  let quote: string | null = null
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '[') return { end: index, hasSubset: true }
    else if (character === '>') return { end: index + 1, hasSubset: false }
  }
  return { end: text.length, hasSubset: true }
}

/**
 * Refuses any DTD declaration and any DOCTYPE carrying an internal subset.
 * Markup is scanned the way an XML parser reads it: comments, CDATA sections
 * and processing instructions are skipped as units, so text inside them can
 * neither open a fake DOCTYPE nor hide a real one, and the quoted identifiers
 * of a DOCTYPE are skipped as strings, so a `>` or `[` inside them can neither
 * end it early nor hide its internal subset. An unterminated DOCTYPE counts
 * as having a subset.
 */
export function hasDtdDeclarations(text: string): boolean {
  if (DTD_DECLARATION_PATTERN.test(text)) return true
  let index = 0
  while (index < text.length) {
    const open = text.indexOf('<', index)
    if (open < 0) return false
    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open + 4)
      if (close < 0) return false
      index = close + 3
      continue
    }
    if (text.startsWith('<![CDATA[', open)) {
      const close = text.indexOf(']]>', open + 9)
      if (close < 0) return false
      index = close + 3
      continue
    }
    if (text.startsWith('<?', open)) {
      const close = text.indexOf('?>', open + 2)
      if (close < 0) return false
      index = close + 2
      continue
    }
    if (text.slice(open, open + 9).toUpperCase() === '<!DOCTYPE') {
      const doctype = skipQuotedDoctype(text, open + 9)
      if (doctype.hasSubset) return true
      index = doctype.end
      continue
    }
    index = open + 1
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

/**
 * jsdom's `NamedNodeMap` is a proxy, so every property read on it goes
 * through a trap; reading `length` and `item` once per element keeps the
 * cost at one trap per element instead of one per attribute.
 */
function attributesOf(element: DomElement): DomAttribute[] {
  const list = element.attributes
  const count = list.length
  const item = list.item
  const attributes: DomAttribute[] = []
  for (let index = 0; index < count; index += 1) {
    const attribute = item.call(list, index)
    if (attribute) attributes.push(attribute)
  }
  return attributes
}

/**
 * Bounds the work every later pass can be made to do. Every node counts, not
 * only elements: parsing, the passes, DOMPurify and serialisation all cost per
 * node, and text, comments, processing instructions and CDATA cost as much as
 * elements. Element count and depth bound every traversal; attributes are
 * bounded per element as well as in total because jsdom removes and re-sets
 * an attribute in time linear in the element's attribute count.
 */
function exceedsComplexityBounds(document: DomDocument): boolean {
  let nodes = 0
  let elements = 0
  let attributes = 0
  let exceeded = false
  walk(document, (node, level) => {
    if (exceeded) return false
    if (node === document) return true
    nodes += 1
    if (nodes > VECTOR_IMAGE_MAX_NODES) {
      exceeded = true
      return false
    }
    if (!isElement(node)) return false
    elements += 1
    const own = node.attributes.length
    attributes += own
    exceeded = elements > VECTOR_IMAGE_MAX_ELEMENTS
      || level > VECTOR_IMAGE_MAX_DEPTH
      || own > VECTOR_IMAGE_MAX_ATTRIBUTES_PER_ELEMENT
      || attributes > VECTOR_IMAGE_MAX_ATTRIBUTES
    return !exceeded
  })
  return exceeded
}

function normaliseUrlValue(value: string): string {
  let normalised = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code > 0x20 && code !== 0x7f) normalised += character
  }
  return normalised
}

/**
 * The URL parser strips leading and trailing C0 controls and spaces from an
 * attribute URL, and nothing else: a non-ASCII space such as U+3000 stays part
 * of the URL and makes `#id` a relative URL.
 */
function trimUrlBoundary(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1
  return value.slice(start, end)
}

function trimCssWhitespace(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && isCssWhitespace(value[start])) start += 1
  while (end > start && isCssWhitespace(value[end - 1])) end -= 1
  return value.slice(start, end)
}

function hasRasterSignature(mimeType: string, base64: string): boolean {
  const bytes = Buffer.from(base64.replace(/[\t\n\f\r ]+/g, ''), 'base64')
  return detectAttachmentMimeType(bytes, null, null) === mimeType.toLowerCase()
}

function isAllowedRasterDataUri(value: string): boolean {
  const match = RASTER_DATA_URI_PATTERN.exec(value)
  if (!match) return false
  return hasRasterSignature(match[1]!, match[2]!)
}

/**
 * Classifies a reference exactly as given: callers strip only what their own
 * syntax strips (C0 controls and spaces for an attribute URL, ASCII whitespace
 * for an unquoted CSS `url(`, nothing inside a quoted CSS string).
 */
function classifyReference(value: string, allowRasterData: boolean): VectorImageFindingKind | null {
  if (/^#[^\s#]+$/.test(value)) return null
  if (allowRasterData && isAllowedRasterDataUri(value)) return null
  if (ACTIVE_SCHEME_PATTERN.test(normaliseUrlValue(value))) return 'active_content'
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
export function inspectVectorImageCss(css: string): VectorImageFindingKind | null {
  return scanCss(css, null, null)
}

/**
 * The tokenizer behind `inspectVectorImageCss`. It also reports every allowed
 * `url()` target (a fragment or a raster `data:` URI) with the property it
 * was found in: the declaration's name, or `property` for an attribute value.
 */
function scanCss(
  css: string,
  property: string | null,
  onUrl: ((target: string, property: string | null) => void) | null,
): VectorImageFindingKind | null {
  let verdict: VectorImageFindingKind | null = null
  let urlStringExpected = false
  let currentProperty = property
  let pendingName: string | null = null
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
        const target = css.slice(index + 1, end)
        const kind = classifyReference(target, true)
        if (kind === 'active_content') return kind
        if (kind === null) onUrl?.(target, currentProperty)
        verdict = verdict ?? kind
        urlStringExpected = false
      }
      pendingName = null
      index = end + 1
      continue
    }
    if (isCssWhitespace(character)) {
      index += 1
      continue
    }
    urlStringExpected = false
    if (character === ':') {
      currentProperty = pendingName ?? currentProperty
      pendingName = null
      index += 1
      continue
    }
    if (character === ';' || character === '{' || character === '}') {
      currentProperty = character === ';' ? property : null
      pendingName = null
      index += 1
      continue
    }
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
        pendingName = name
        index = end
        continue
      }
      pendingName = null
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
        const target = trimCssWhitespace(css.slice(start, close))
        if (/[\t\n\f\r ]/.test(target)) return 'active_content'
        const kind = classifyReference(target, true)
        if (kind === 'active_content') return kind
        if (kind === null) onUrl?.(target, currentProperty)
        verdict = verdict ?? kind
        index = close + 1
        continue
      }
      if (CSS_ACTIVE_FUNCTIONS.has(functionName)) return 'active_content'
      if (CSS_STRING_URL_FUNCTIONS.has(functionName)) verdict = verdict ?? 'external_reference'
      index = end + 1
      continue
    }
    pendingName = null
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
 * Browsers build a `<style>` element's stylesheet from the concatenation of
 * its direct Text children only; nested elements, comments and processing
 * instructions are skipped. Allowing any of them would let the stylesheet a
 * browser applies differ from the text this module inspects, so a `<style>`
 * may hold only Text nodes (and CDATA, which is text).
 */
function hasOnlyTextChildren(style: DomNode): boolean {
  for (let child = style.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== NODE_TEXT && child.nodeType !== NODE_CDATA_SECTION) return false
  }
  return true
}

function styleSheetText(style: DomNode): string {
  let text = ''
  for (let child = style.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === NODE_TEXT || child.nodeType === NODE_CDATA_SECTION) text += child.textContent ?? ''
  }
  return text
}

/**
 * Replaces a node's children with `kept`. Removing a node in jsdom costs time
 * linear in its preceding siblings, so removing scattered children one by one
 * is quadratic in a wide parent; removing every child from the front (always
 * index 0) and appending the kept ones back is linear.
 */
function replaceChildren(parent: DomNode, kept: DomNode[]): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild)
  for (const child of kept) parent.appendChild(child)
}

type ChildVerdict = 'keep' | VectorImageRemoval

function classifyChild(node: DomNode): ChildVerdict {
  if (node.nodeType === NODE_COMMENT) return { kind: 'inert', target: 'comment' }
  if (node.nodeType === NODE_DOCUMENT_TYPE) return { kind: 'inert', target: 'doctype' }
  if (node.nodeType === NODE_PROCESSING_INSTRUCTION) {
    const isStylesheet = node.nodeName.toLowerCase() === 'xml-stylesheet'
    return { kind: isStylesheet ? 'external_reference' : 'inert', target: `processing-instruction:${node.nodeName}` }
  }
  if (!isElement(node)) return 'keep'
  const namespace = node.namespaceURI ?? ''
  if (namespace !== SVG_NAMESPACE && RENDERING_ELEMENT_NAMESPACES.has(namespace)) {
    return { kind: 'active_content', target: describeElement(node) }
  }
  const isForeign = !RENDERING_ELEMENT_NAMESPACES.has(namespace)
  const isMetadata = namespace === SVG_NAMESPACE && node.localName === 'metadata'
  if (isForeign || isMetadata) {
    return { kind: containsRenderingElement(node) ? 'active_content' : 'inert', target: describeElement(node) }
  }
  if (isStyleElement(node) && !hasOnlyTextChildren(node)) return { kind: 'active_content', target: describeElement(node) }
  return 'keep'
}

function isReferenceBearing(attribute: DomAttribute): boolean {
  if (isHrefAttribute(attribute)) return true
  if (attribute.namespaceURI !== null) return false
  return CSS_PARSED_ATTRIBUTES.has(attribute.localName.toLowerCase()) || /url\s*\(/i.test(attribute.value)
}

/**
 * DOMPurify re-sets every attribute value through JavaScript `trim()`. For a
 * reference that matters where the trim differs from the URL parser's; for an
 * `id` any change does (the stored id would not be the uploaded one); for a
 * `class` only non-ASCII whitespace does, since class lists split on ASCII
 * whitespace anyway.
 */
function changedByPurifyTrim(attribute: DomAttribute): boolean {
  const value = attribute.value
  const trimmed = value.trim()
  if (trimmed === value) return false
  if (isReferenceBearing(attribute)) return trimmed !== trimUrlBoundary(value)
  if (attribute.namespaceURI !== null) return false
  const name = attribute.localName.toLowerCase()
  if (name === 'id') return true
  return name === 'class' && trimmed !== trimCssWhitespace(value)
}

function isKeptNamespaceDeclaration(attribute: DomAttribute): boolean {
  if (attribute.name === 'xmlns') return attribute.value === SVG_NAMESPACE
  return attribute.name === 'xmlns:xlink' && attribute.value === XLINK_NAMESPACE
}

/**
 * Normalises one element's attributes before DOMPurify and returns the first
 * attribute that refuses the document, if any.
 *
 * - Foreign-namespace attributes (editor data) are removed, and so is every
 *   namespace declaration except the default SVG one and `xmlns:xlink`: the
 *   serialiser re-declares any prefix it needs, and DOMPurify allows no other
 *   declaration (Inkscape writes `xmlns:svg`).
 * - XLink attributes written with another prefix (`xmlns:x` + `x:href`) are
 *   rewritten as `xlink:`, the only XLink spelling DOMPurify allows.
 * - DOMPurify rewrites every attribute value with JavaScript `trim()`, which
 *   also strips non-ASCII spaces that a browser keeps (`href="\u3000#a"` is a
 *   relative URL to a browser and `#a` after DOMPurify). A reference-bearing
 *   attribute (`href`, a CSS-parsed attribute, any value with `url(`), an `id`
 *   or a `class` whose meaning that trim would change is refused rather than
 *   silently rewritten (`changedByPurifyTrim`); elsewhere the trim changes
 *   nothing that renders, fetches or is referenced.
 */
function normaliseAttributes(
  element: DomElement,
  removals: VectorImageRemoval[],
): { finding: VectorImageFinding | null; rewroteXlink: boolean } {
  let rewroteXlink = false
  for (const attribute of attributesOf(element)) {
    const attributeNamespace = attribute.namespaceURI
    if (changedByPurifyTrim(attribute)) {
      const kind = isHrefAttribute(attribute) ? 'external_reference' : 'active_content'
      return { finding: { kind, target: describeAttribute(attribute, element) }, rewroteXlink }
    }
    if (attributeNamespace === null || attributeNamespace === XML_NAMESPACE) continue
    if (attributeNamespace === XLINK_NAMESPACE) {
      if ((attribute as DomAttributeWithPrefix).prefix === 'xlink') continue
      element.removeAttributeNode(attribute)
      element.setAttributeNS(XLINK_NAMESPACE, `xlink:${attribute.localName}`, attribute.value)
      rewroteXlink = true
      continue
    }
    if (attributeNamespace === XMLNS_NAMESPACE) {
      if (isKeptNamespaceDeclaration(attribute)) continue
    } else {
      removals.push({ kind: 'inert', target: describeAttribute(attribute, element) })
    }
    element.removeAttributeNode(attribute)
  }
  return { finding: null, rewroteXlink }
}

/**
 * Removes what never renders — comments, processing instructions other than
 * `xml-stylesheet`, `<metadata>`, foreign-namespace editor elements and
 * attributes — and turns CDATA sections into the text they hold (design tools
 * wrap stylesheets in CDATA; the CSS policy still inspects that text). A
 * parent with removals is rebuilt, which keeps the pass linear. Nodes outside
 * the root element (the DOCTYPE, prolog comments and PIs) are classified but
 * left in place: only the root is serialised, and removing a Document's child
 * makes jsdom rescan the Document's children.
 *
 * Stops at the first node that is not inert and returns it: an XHTML or MathML
 * element (only meaningful inside a `foreignObject`, which DOMPurify refuses),
 * a foreign wrapper hiding a rendering element, a stylesheet PI, or a
 * `<style>` holding anything but text. Such a document is refused, so there is
 * no point removing anything else.
 */
function prepareForPurify(document: DomDocument, removals: VectorImageRemoval[]): VectorImageFinding | null {
  const parents: DomNode[] = [document]
  let rewroteXlink = false
  while (parents.length) {
    const parent = parents.pop()!
    const kept: DomNode[] = []
    let changed = false
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === NODE_CDATA_SECTION) {
        kept.push(document.createTextNode(child.textContent ?? ''))
        changed = true
        continue
      }
      const verdict = classifyChild(child)
      if (verdict === 'keep') {
        kept.push(child)
        continue
      }
      if (verdict.kind !== 'inert') return verdict as VectorImageFinding
      removals.push(verdict)
      changed = true
    }
    if (changed && parent !== document) replaceChildren(parent, kept)
    for (const child of kept) {
      if (!isElement(child)) continue
      const normalised = normaliseAttributes(child, removals)
      if (normalised.finding) return normalised.finding
      rewroteXlink = rewroteXlink || normalised.rewroteXlink
      parents.push(child)
    }
  }
  const root = document.documentElement
  if (rewroteXlink && root && root.getAttribute('xmlns:xlink') !== XLINK_NAMESPACE) {
    root.setAttributeNS(XMLNS_NAMESPACE, 'xmlns:xlink', XLINK_NAMESPACE)
  }
  return null
}

function isHrefAttribute(attribute: DomAttribute): boolean {
  if (attribute.localName.toLowerCase() !== 'href') return false
  return attribute.namespaceURI === null || attribute.namespaceURI === XLINK_NAMESPACE
}

/**
 * The reference a browser follows: SVG 2 `href` wins over `xlink:href` when
 * both are present. Callers never see a disagreement — elements carrying two
 * different values are refused by the reference policy.
 */
function effectiveHref(element: DomElement): string | null {
  let xlink: string | null = null
  for (const attribute of attributesOf(element)) {
    if (!isHrefAttribute(attribute)) continue
    if (attribute.namespaceURI === null) return attribute.value
    xlink = attribute.value
  }
  return xlink
}

function hasConflictingHrefs(attributes: DomAttribute[]): boolean {
  let plain: string | null = null
  let xlink: string | null = null
  for (const attribute of attributes) {
    if (!isHrefAttribute(attribute)) continue
    if (attribute.namespaceURI === null) plain = trimUrlBoundary(attribute.value)
    else xlink = trimUrlBoundary(attribute.value)
  }
  return plain !== null && xlink !== null && plain !== xlink
}

function looksLikeReference(value: string): boolean {
  return /url\s*\(|:/i.test(value)
}

/**
 * A DOMPurify removal is inert only for an attribute it does not know that
 * nothing can depend on: not a namespace declaration's target, not an event
 * handler, link, style or URL-bearing value, and not an attribute other
 * content references or that drives animation (`id`, `name`, `class`,
 * `attributeName` — DOMPurify drops an `attributeName` naming `href`).
 */
function classifyPurifyRemoval(entry: PurifyRemovedEntry): VectorImageRemoval {
  if (entry.attribute) {
    const target = describeAttribute(entry.attribute, entry.from)
    if (entry.attribute.namespaceURI === XMLNS_NAMESPACE) return { kind: 'inert', target }
    const name = entry.attribute.name.toLowerCase()
    const isHandler = /^on/.test(entry.attribute.localName.toLowerCase())
    const isLink = name.endsWith('href') || name === 'src' || name === 'style'
    const isReferenced = REFERENCED_ATTRIBUTES.has(entry.attribute.localName.toLowerCase())
    const inert = !isHandler && !isLink && !isReferenced && !looksLikeReference(entry.attribute.value ?? '')
    return { kind: inert ? 'inert' : 'active_content', target }
  }
  return { kind: 'active_content', target: entry.element ? describeElement(entry.element) : 'element' }
}

function inspectAttribute(tag: string, attribute: DomAttribute): VectorImageFindingKind | null {
  if (isHrefAttribute(attribute)) return classifyReference(trimUrlBoundary(attribute.value), RASTER_DATA_URI_ELEMENTS.has(tag))
  if (attribute.namespaceURI !== null) return null
  const name = attribute.localName.toLowerCase()
  if (CSS_PARSED_ATTRIBUTES.has(name) || /url\s*\(/i.test(attribute.value)) {
    return inspectVectorImageCss(attribute.value)
  }
  return null
}

/**
 * Applies the reference and CSS policy to what DOMPurify kept and returns the
 * first violation, if any. Nothing is removed: a violation refuses the whole
 * document.
 */
function findReferenceViolation(root: DomElement): VectorImageFinding | null {
  let finding: VectorImageFinding | null = null
  walk(root, (node) => {
    if (finding || !isElement(node)) return false
    const tag = node.localName.toLowerCase()
    const attributes = attributesOf(node)
    if (hasConflictingHrefs(attributes)) {
      finding = { kind: 'active_content', target: `${describeElement(node)}@href` }
      return false
    }
    if (tag === 'style') {
      const verdict = hasOnlyTextChildren(node) ? inspectVectorImageCss(styleSheetText(node)) : 'active_content'
      if (verdict) finding = { kind: verdict, target: describeElement(node) }
      return false
    }
    for (const attribute of attributes) {
      const verdict = inspectAttribute(tag, attribute)
      if (!verdict) continue
      finding = { kind: verdict, target: describeAttribute(attribute, node) }
      return false
    }
    return true
  })
  return finding
}

function referencedId(element: DomElement): string | null {
  const value = trimUrlBoundary(effectiveHref(element) ?? '')
  return value.startsWith('#') ? value.slice(1) : null
}

type ReferenceMultiplier = 'once' | 'painted' | 'markables' | 'vertices'

type FragmentReference = { id: string; multiplier: ReferenceMultiplier }

type SelectorSubject = { key: 'id' | 'class' | 'type'; value: string } | null

/**
 * The references every element a selector could match picks up from the
 * stylesheets, deduplicated by target and multiplier. A bucket is one node of
 * the rendered-size graph, so an element costs one edge per bucket it falls
 * into, however many rules feed that bucket.
 */
type ReferenceBucket = { references: Map<string, FragmentReference> }

type StylesheetReferenceIndex = {
  any: ReferenceBucket
  byId: Map<string, ReferenceBucket>
  byClass: Map<string, ReferenceBucket>
  byType: Map<string, ReferenceBucket>
}

/**
 * How many times one element renders what a property references: once for
 * `clip-path`, `mask` and `filter`, which do not inherit; once per painted
 * element it reaches for an inherited paint (`fill`, `stroke`, or a property
 * the policy does not know); once per markable element for `marker-start` and
 * `marker-end`; once per vertex for `marker-mid` and the `marker` shorthand.
 */
function referenceMultiplier(property: string | null): ReferenceMultiplier {
  const name = (property ?? '').toLowerCase()
  if (name === 'marker' || name === 'marker-mid') return 'vertices'
  if (name === 'marker-start' || name === 'marker-end') return 'markables'
  if (NON_INHERITED_REFERENCE_PROPERTIES.has(name)) return 'once'
  return 'painted'
}

function collectFragmentReferences(css: string, property: string | null, into: FragmentReference[]): void {
  scanCss(css, property, (target, targetProperty) => {
    if (target.startsWith('#')) into.push({ id: target.slice(1), multiplier: referenceMultiplier(targetProperty) })
  })
}

/** Index just past a comment or quoted string starting at `index`, or `index`. */
function skipCssCommentOrString(css: string, index: number): number {
  if (css[index] === '/' && css[index + 1] === '*') {
    const end = css.indexOf('*/', index + 2)
    return end < 0 ? css.length : end + 2
  }
  const quote = css[index]
  if (quote !== '"' && quote !== "'") return index
  const end = css.indexOf(quote, index + 1)
  return end < 0 ? css.length : end + 1
}

function matchingBrace(css: string, open: number, limit: number): number {
  let depth = 0
  let index = open
  while (index < limit) {
    const skipped = skipCssCommentOrString(css, index)
    if (skipped !== index) {
      index = skipped
      continue
    }
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
    index += 1
  }
  return limit
}

/**
 * The subject compound of one selector, reduced to the single most selective
 * constraint it carries (an id, else a class, else a type), or null when it
 * could match any element. Dropping every other constraint — combinators,
 * further classes, attributes, pseudo-classes — only widens the match, which
 * keeps the rendered-size estimate an upper bound.
 */
function selectorSubject(selector: string): SelectorSubject {
  let depth = 0
  let compoundStart = 0
  let index = 0
  while (index < selector.length) {
    const skipped = skipCssCommentOrString(selector, index)
    if (skipped !== index) {
      if (depth === 0) compoundStart = skipped
      index = skipped
      continue
    }
    const character = selector[index]!
    if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0 && SELECTOR_COMBINATORS.has(character)) compoundStart = index + 1
    index += 1
  }
  const compound = selector.slice(compoundStart)
  let id: string | null = null
  let className: string | null = null
  let type: string | null = null
  depth = 0
  index = 0
  while (index < compound.length) {
    const skipped = skipCssCommentOrString(compound, index)
    if (skipped !== index) {
      index = skipped
      continue
    }
    const character = compound[index]!
    if (character === '(' || character === '[') {
      depth += 1
      index += 1
      continue
    }
    if (character === ')' || character === ']') {
      depth = Math.max(0, depth - 1)
      index += 1
      continue
    }
    if (depth > 0) {
      index += 1
      continue
    }
    if (character === '#' || character === '.' || character === ':') {
      const end = readCssName(compound, index + 1)
      const name = compound.slice(index + 1, end).toLowerCase()
      if (character === '#' && name) id = id ?? name
      if (character === '.' && name) className = className ?? name
      index = Math.max(end, index + 1)
      continue
    }
    if (isCssNameCharacter(compound.charCodeAt(index))) {
      const end = readCssName(compound, index)
      const name = compound.slice(index, end).toLowerCase()
      if (compound[end] === '|') {
        index = end + 1
        continue
      }
      type = type ?? name
      index = end
      continue
    }
    index += 1
  }
  if (id) return { key: 'id', value: id }
  if (className) return { key: 'class', value: className }
  if (type) return { key: 'type', value: type }
  return null
}

function selectorSubjects(selectorList: string): SelectorSubject[] {
  const subjects: SelectorSubject[] = []
  let depth = 0
  let start = 0
  let index = 0
  while (index <= selectorList.length) {
    const skipped = index < selectorList.length ? skipCssCommentOrString(selectorList, index) : index
    if (skipped !== index) {
      index = skipped
      continue
    }
    const character = selectorList[index]
    if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1)
    else if (index === selectorList.length || (character === ',' && depth === 0)) {
      subjects.push(selectorSubject(selectorList.slice(start, index).trim()))
      start = index + 1
    }
    index += 1
  }
  return subjects
}

function addToBucket(buckets: Map<string, ReferenceBucket>, key: string, reference: FragmentReference): void {
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { references: new Map() }
    buckets.set(key, bucket)
  }
  bucket.references.set(`${reference.multiplier}|${reference.id}`, reference)
}

/**
 * Indexes every in-document `url()` a stylesheet holds under the selectors
 * that could apply it. Grouping at-rules (`@media`, `@supports`, …) are
 * entered; anything else with a block (`@keyframes`, nested rules) applies to
 * any element.
 */
function indexStylesheetReferences(stylesheets: string[]): StylesheetReferenceIndex {
  const index: StylesheetReferenceIndex = { any: { references: new Map() }, byId: new Map(), byClass: new Map(), byType: new Map() }
  for (const css of stylesheets) {
    const ranges: Array<[number, number]> = [[0, css.length]]
    while (ranges.length) {
      const [rangeStart, rangeEnd] = ranges.pop()!
      let preludeStart = rangeStart
      let position = rangeStart
      while (position < rangeEnd) {
        const skipped = skipCssCommentOrString(css, position)
        if (skipped !== position) {
          position = skipped
          continue
        }
        const character = css[position]
        if (character === ';' || character === '}') {
          position += 1
          preludeStart = position
          continue
        }
        if (character !== '{') {
          position += 1
          continue
        }
        const close = matchingBrace(css, position, rangeEnd)
        const prelude = css.slice(preludeStart, position).trim()
        const body = css.slice(position + 1, close)
        if (prelude.startsWith('@') && STYLESHEET_GROUPING_RULES.has(prelude.slice(1, readCssName(prelude, 1)).toLowerCase())) {
          ranges.push([position + 1, close])
        } else {
          const references: FragmentReference[] = []
          collectFragmentReferences(body, null, references)
          const subjects = prelude.startsWith('@') || body.includes('{') ? [null] : selectorSubjects(prelude)
          for (const reference of references) {
            for (const subject of subjects) {
              if (!subject) index.any.references.set(`${reference.multiplier}|${reference.id}`, reference)
              else if (subject.key === 'id') addToBucket(index.byId, subject.value, reference)
              else if (subject.key === 'class') addToBucket(index.byClass, subject.value, reference)
              else addToBucket(index.byType, subject.value, reference)
            }
          }
        }
        position = close + 1
        preludeStart = position
      }
    }
  }
  return index
}

function bucketsFor(element: DomElement, tag: string, index: StylesheetReferenceIndex): ReferenceBucket[] {
  const buckets: ReferenceBucket[] = []
  const add = (bucket: ReferenceBucket | undefined) => {
    if (bucket && bucket.references.size) buckets.push(bucket)
  }
  add(index.any)
  add(index.byType.get(tag))
  const id = element.getAttribute('id')
  if (id) add(index.byId.get(id.toLowerCase()))
  const classes = element.getAttribute('class')
  if (classes) {
    for (const className of classes.toLowerCase().split(/[\t\n\f\r ]+/)) {
      if (className) add(index.byClass.get(className))
    }
  }
  return buckets
}

function vertexBound(element: DomElement, tag: string): number {
  if (tag === 'line') return 2
  if (tag === 'path') return (element.getAttribute('d') ?? '').length
  if (tag === 'polyline' || tag === 'polygon') return (element.getAttribute('points') ?? '').length
  return 0
}

/**
 * Bounds what the document renders, not what it contains. Every element
 * counts once where it appears, and every in-document reference renders its
 * target again, recursively, so nested reuse multiplies:
 * - a `<use>` renders its target as an instance that inherits from it, like a
 *   child;
 * - any other `href` (`feImage`, `textPath`, a paint server inheriting a
 *   template) renders its target once; a link (`<a>`) renders nothing;
 * - a `url(#…)` in an attribute, a `style` attribute or a stylesheet rule that
 *   could apply to the element renders its target as many times as
 *   `referenceMultiplier` says: inherited paint reaches every painted element
 *   below (`<use>` instances included), and a `marker-mid` every vertex.
 *
 * One iterative post-order pass over that graph computes, once per node, how
 * many painted elements, markable elements and vertices inherit from an
 * element and how many elements it renders. An element's tree and `<use>`
 * edges come first, so those counts are complete when its references multiply
 * by them. Stylesheet buckets are nodes too: a bucket sums its targets'
 * rendered sizes per multiplier once, and an element applies those sums. A
 * reference cycle is unbounded. Over-counting (a selector matching more
 * elements than it does, a cascade overriding a paint) only ever refuses; the
 * estimate never falls below what a browser renders.
 */
function exceedsRenderedSize(root: DomElement): boolean {
  const byId = new Map<string, DomElement>()
  const stylesheets: string[] = []
  walk(root, (node) => {
    if (!isElement(node)) return false
    const id = node.getAttribute('id')
    if (id && !byId.has(id)) byId.set(id, node)
    if (isStyleElement(node)) stylesheets.push(styleSheetText(node))
    return true
  })
  const stylesheetIndex = indexStylesheetReferences(stylesheets)
  type RenderNode = DomElement | ReferenceBucket
  type Edge =
    | { kind: 'tree'; target: DomElement }
    | { kind: 'reference'; target: DomElement; multiplier: ReferenceMultiplier }
    | { kind: 'bucket'; target: ReferenceBucket }
  /**
   * For an element: what inherits from it and what it renders. For a bucket:
   * the summed rendered size of its targets per multiplier, `rendered` for
   * `once`.
   */
  type Totals = { painted: number; markables: number; vertices: number; rendered: number }
  const isBucket = (node: RenderNode): node is ReferenceBucket => 'references' in node
  const edgesOf = (node: RenderNode): Edge[] => {
    const edges: Edge[] = []
    if (isBucket(node)) {
      for (const reference of node.references.values()) {
        const target = byId.get(reference.id)
        if (target) edges.push({ kind: 'reference', target, multiplier: reference.multiplier })
      }
      return edges
    }
    const tag = node.localName.toLowerCase()
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (isElement(child)) edges.push({ kind: 'tree', target: child })
    }
    const hrefTarget = referencedId(node)
    const linked = hrefTarget ? byId.get(hrefTarget) : undefined
    if (linked && tag === 'use') edges.push({ kind: 'tree', target: linked })
    if (linked && tag !== 'use' && tag !== 'a') edges.push({ kind: 'reference', target: linked, multiplier: 'once' })
    const references: FragmentReference[] = []
    for (const attribute of attributesOf(node)) {
      if (attribute.namespaceURI !== null || isHrefAttribute(attribute) || !/url\s*\(/i.test(attribute.value)) continue
      const name = attribute.localName.toLowerCase()
      collectFragmentReferences(attribute.value, name === 'style' ? null : name, references)
    }
    for (const reference of references) {
      const target = byId.get(reference.id)
      if (target) edges.push({ kind: 'reference', target, multiplier: reference.multiplier })
    }
    for (const bucket of bucketsFor(node, tag, stylesheetIndex)) edges.push({ kind: 'bucket', target: bucket })
    return edges
  }
  const ownTotals = (node: RenderNode): Totals => {
    if (isBucket(node)) return { painted: 0, markables: 0, vertices: 0, rendered: 0 }
    const tag = node.localName.toLowerCase()
    return {
      painted: PAINTED_ELEMENTS.has(tag) ? 1 : 0,
      markables: MARKABLE_ELEMENTS.has(tag) ? 1 : 0,
      vertices: vertexBound(node, tag),
      rendered: 1,
    }
  }
  const times = (totals: Totals, multiplier: ReferenceMultiplier): number => {
    if (multiplier === 'once') return 1
    if (multiplier === 'painted') return totals.painted
    return multiplier === 'markables' ? totals.markables : totals.vertices
  }
  const absorb = (node: RenderNode, totals: Totals, edge: Edge, dependency: Totals): boolean => {
    if (edge.kind === 'tree') {
      totals.painted += dependency.painted
      totals.markables += dependency.markables
      totals.vertices += dependency.vertices
      totals.rendered += dependency.rendered
    } else if (edge.kind === 'bucket') {
      totals.rendered += dependency.rendered
        + dependency.painted * totals.painted
        + dependency.markables * totals.markables
        + dependency.vertices * totals.vertices
    } else if (isBucket(node)) {
      if (edge.multiplier === 'once') totals.rendered += dependency.rendered
      else totals[edge.multiplier] += dependency.rendered
      return false
    } else {
      totals.rendered += times(totals, edge.multiplier) * dependency.rendered
    }
    return totals.rendered > VECTOR_IMAGE_MAX_RENDERED_ELEMENTS
  }
  type Frame = { node: RenderNode; edges: Edge[]; next: number; totals: Totals }
  const open = (node: RenderNode): Frame => ({ node, edges: edgesOf(node), next: 0, totals: ownTotals(node) })
  const finished = new Map<RenderNode, Totals>()
  const inProgress = new Set<RenderNode>([root])
  const stack: Frame[] = [open(root)]
  while (stack.length) {
    const frame = stack[stack.length - 1]!
    if (frame.next < frame.edges.length) {
      const edge = frame.edges[frame.next]!
      frame.next += 1
      const known = finished.get(edge.target)
      if (known !== undefined) {
        if (absorb(frame.node, frame.totals, edge, known)) return true
        continue
      }
      if (inProgress.has(edge.target)) return true
      inProgress.add(edge.target)
      stack.push(open(edge.target))
      continue
    }
    stack.pop()
    inProgress.delete(frame.node)
    finished.set(frame.node, frame.totals)
    const parent = stack[stack.length - 1]
    if (parent && absorb(parent.node, parent.totals, parent.edges[parent.next - 1]!, frame.totals)) return true
  }
  return false
}

function parseError(document: DomDocument): boolean {
  return document.getElementsByTagName('parsererror').length > 0
}

function countMarkup(text: string): number {
  let count = 0
  for (let index = text.indexOf('<'); index >= 0; index = text.indexOf('<', index + 1)) count += 1
  return count
}

function rejectionFor(finding: VectorImageFinding): VectorImageRejectionCode {
  return finding.kind === 'active_content' ? 'vector_image_unsafe_content' : 'vector_image_external_reference'
}

/**
 * In `RETURN_DOM` mode DOMPurify imports the document into its own HTML
 * `<body>` and walks from there; the SVG profile does not allow `body`, so it
 * always records removing its own container. That entry is not content.
 */
function isPurifyContainer(entry: PurifyRemovedEntry): boolean {
  const element = entry.element as DomElement | undefined
  return Boolean(element) && element!.nodeName === 'BODY' && element!.namespaceURI === XHTML_NAMESPACE
}

/**
 * Runs DOMPurify on an imported copy of the document (`RETURN_DOM`), not in
 * place, and stops at its first removal that is not inert. Stopping means
 * throwing from a hook; on the in-place path DOMPurify then strips the root
 * through a live child list, which jsdom re-materialises on every removal, so
 * the copy keeps the abort linear.
 */
function runPurify(
  purify: PurifyInstance,
  root: DomElement,
  removals: VectorImageRemoval[],
): { sanitised: DomElement | null; finding: VectorImageFinding | null } {
  let inspected = 0
  const collectRemovals = () => {
    for (; inspected < purify.removed.length; inspected += 1) {
      const entry = purify.removed[inspected]!
      if (isPurifyContainer(entry)) continue
      const removal = classifyPurifyRemoval(entry)
      if (removal.kind !== 'inert') {
        const abort: PurifyAbort = { [PURIFY_ABORT]: removal as VectorImageFinding }
        throw abort
      }
      removals.push(removal)
    }
  }
  purify.addHook('beforeSanitizeElements', collectRemovals)
  try {
    const body = purify.sanitize(root, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['use'],
      ADD_DATA_URI_TAGS: ['feimage'],
      ADD_ATTR: ['role'],
      KEEP_CONTENT: false,
      SANITIZE_DOM: false,
      RETURN_DOM: true,
    }) as DomNode | null
    collectRemovals()
    let sanitised: DomElement | null = null
    for (let child = body?.firstChild ?? null; child; child = child.nextSibling) {
      if (isElement(child)) {
        sanitised = child
        break
      }
    }
    return { sanitised, finding: null }
  } catch (error) {
    if (isPurifyAbort(error)) return { sanitised: null, finding: error[PURIFY_ABORT] }
    throw error
  }
}

/**
 * Sanitises an SVG document: bounds its size and structure, removes what
 * never renders, runs DOMPurify's SVG profile on a fresh jsdom window and
 * applies the reference and CSS policy. The first finding that is not inert —
 * active content or an external reference — refuses the document at once
 * (and is the last entry of `removals`): such a document is never stored, so
 * nothing more is removed, and every pass stays linear however much hostile
 * content the input carries.
 */
export async function sanitizeVectorImage(buffer: Buffer): Promise<VectorImageSanitizeResult> {
  const removals: VectorImageRemoval[] = []
  const refuse = (finding: VectorImageFinding): VectorImageSanitizeResult => {
    removals.push(finding)
    return { ok: false, code: rejectionFor(finding), removals }
  }
  if (buffer.length > VECTOR_IMAGE_MAX_BYTES) return { ok: false, code: 'vector_image_too_large', removals }
  const text = decodeUtf8(buffer)
  if (text === null) return { ok: false, code: 'vector_image_malformed', removals }
  if (hasDtdDeclarations(text)) return { ok: false, code: 'vector_image_entity_declaration', removals }
  if (countMarkup(text) > VECTOR_IMAGE_MAX_MARKUP) return { ok: false, code: 'vector_image_too_complex', removals }

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
    if (exceedsComplexityBounds(document)) return { ok: false, code: 'vector_image_too_complex', removals }

    const preparationFinding = prepareForPurify(document, removals)
    if (preparationFinding) return refuse(preparationFinding)

    const purify = runtime.createPurify(window)
    const purified = runPurify(purify, root, removals)
    if (purified.finding) return refuse(purified.finding)
    const sanitised = purified.sanitised
    if (!sanitised || sanitised.namespaceURI !== SVG_NAMESPACE || sanitised.localName !== 'svg') {
      return { ok: false, code: 'vector_image_malformed', removals }
    }

    const referenceFinding = findReferenceViolation(sanitised)
    if (referenceFinding) return refuse(referenceFinding)

    if (exceedsRenderedSize(sanitised)) return { ok: false, code: 'vector_image_too_complex', removals }

    const serialised = Buffer.from(new window.XMLSerializer().serializeToString(sanitised), 'utf8')
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
