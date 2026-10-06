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
export const VECTOR_IMAGE_MAX_ELEMENTS = 3_000
export const VECTOR_IMAGE_MAX_ATTRIBUTES_PER_ELEMENT = 64
export const VECTOR_IMAGE_MAX_ATTRIBUTES = 15_000
export const VECTOR_IMAGE_MAX_DEPTH = 64
export const VECTOR_IMAGE_MAX_NODES = 6_000
export const VECTOR_IMAGE_MAX_MARKUP = 6_000
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
const VENDOR_PREFIX_PATTERN = /^-[a-z0-9]+-/

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

type DomElement = DomNode & {
  localName: string
  namespaceURI: string | null
  attributes: DomAttributeList
  getAttribute(name: string): string | null
  removeAttributeNode(attribute: DomAttribute): unknown
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

function hasRasterSignature(mimeType: string, base64: string): boolean {
  const bytes = Buffer.from(base64.replace(/\s+/g, ''), 'base64')
  return detectAttachmentMimeType(bytes, null, null) === mimeType.toLowerCase()
}

function isAllowedRasterDataUri(value: string): boolean {
  const match = RASTER_DATA_URI_PATTERN.exec(value.trim())
  if (!match) return false
  return hasRasterSignature(match[1]!, match[2]!)
}

function classifyReference(value: string, allowRasterData: boolean): VectorImageFindingKind | null {
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
export function inspectVectorImageCss(css: string): VectorImageFindingKind | null {
  let verdict: VectorImageFindingKind | null = null
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

function stripForeignAttributes(element: DomElement, removals: VectorImageRemoval[]): void {
  for (const attribute of attributesOf(element)) {
    const attributeNamespace = attribute.namespaceURI
    if (attributeNamespace === null || KEPT_ATTRIBUTE_NAMESPACES.has(attributeNamespace)) continue
    if (attributeNamespace === XMLNS_NAMESPACE) {
      if (KEPT_NAMESPACE_DECLARATIONS.has(attribute.value)) continue
    } else {
      removals.push({ kind: 'inert', target: describeAttribute(attribute, element) })
    }
    element.removeAttributeNode(attribute)
  }
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
      stripForeignAttributes(child, removals)
      parents.push(child)
    }
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
    if (attribute.namespaceURI === null) plain = attribute.value.trim()
    else xlink = attribute.value.trim()
  }
  return plain !== null && xlink !== null && plain !== xlink
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

function inspectAttribute(tag: string, attribute: DomAttribute): VectorImageFindingKind | null {
  if (isHrefAttribute(attribute)) return classifyReference(attribute.value, RASTER_DATA_URI_ELEMENTS.has(tag))
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
    if (ANIMATION_ELEMENTS.has(tag)) {
      const target = (node.getAttribute('attributeName') ?? '').trim().toLowerCase()
      if (target === 'href' || target.endsWith(':href')) {
        finding = { kind: 'active_content', target: describeElement(node) }
        return false
      }
    }
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
  const value = effectiveHref(element)?.trim() ?? ''
  return value.startsWith('#') ? value.slice(1) : null
}

/**
 * Bounds what the document renders, not what it contains: every element
 * counts once where it appears, and a `<use>` counts its referenced subtree
 * again — recursively, so nested reuse multiplies. One iterative post-order
 * pass over the element graph (tree children plus each `<use>` target)
 * computes each element's rendered size once, so the check is linear in the
 * document. A reference cycle is unbounded.
 */
function exceedsRenderedSize(root: DomElement): boolean {
  const byId = new Map<string, DomElement>()
  walk(root, (node) => {
    if (!isElement(node)) return false
    const id = node.getAttribute('id')
    if (id && !byId.has(id)) byId.set(id, node)
    return true
  })
  const dependenciesOf = (element: DomElement): DomElement[] => {
    const dependencies: DomElement[] = []
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (isElement(child)) dependencies.push(child)
    }
    if (element.localName === 'use') {
      const targetId = referencedId(element)
      const target = targetId ? byId.get(targetId) : undefined
      if (target) dependencies.push(target)
    }
    return dependencies
  }
  type Frame = { element: DomElement; dependencies: DomElement[]; next: number; size: number }
  const finished = new Map<DomElement, number>()
  const inProgress = new Set<DomElement>([root])
  const stack: Frame[] = [{ element: root, dependencies: dependenciesOf(root), next: 0, size: 1 }]
  while (stack.length) {
    const frame = stack[stack.length - 1]!
    if (frame.next < frame.dependencies.length) {
      const dependency = frame.dependencies[frame.next]!
      frame.next += 1
      const known = finished.get(dependency)
      if (known !== undefined) {
        frame.size += known
        if (frame.size > VECTOR_IMAGE_MAX_RENDERED_ELEMENTS) return true
        continue
      }
      if (inProgress.has(dependency)) return true
      inProgress.add(dependency)
      stack.push({ element: dependency, dependencies: dependenciesOf(dependency), next: 0, size: 1 })
      continue
    }
    stack.pop()
    inProgress.delete(frame.element)
    finished.set(frame.element, frame.size)
    const parent = stack[stack.length - 1]
    if (parent) {
      parent.size += frame.size
      if (parent.size > VECTOR_IMAGE_MAX_RENDERED_ELEMENTS) return true
    }
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
      KEEP_CONTENT: false,
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
