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
export const VECTOR_IMAGE_MAX_RENDER_WORK = 10_000
export const VECTOR_IMAGE_RENDER_CHARACTERS_PER_UNIT = 128
export const VECTOR_IMAGE_MAX_FILTER_PRIMITIVES = 32
export const VECTOR_IMAGE_MAX_BLURS = 8
export const VECTOR_IMAGE_MAX_BLUR_DEVIATION_RATIO = 0.1
export const VECTOR_IMAGE_MAX_RASTER_SIDE = 4_096
export const VECTOR_IMAGE_MAX_STYLE_RULES = 2_000
export const VECTOR_IMAGE_MAX_SELECTORS_PER_RULE = 32
export const VECTOR_IMAGE_MAX_REFERENCES_PER_RULE = 16
export const VECTOR_IMAGE_MAX_STYLE_WORK = 20_000
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
const CSS_ACTIVE_FUNCTIONS = new Set(['expression', 'var', 'if'])
const URL_PROPERTIES = new Set([
  'fill',
  'stroke',
  'clip-path',
  'mask',
  'filter',
  'marker',
  'marker-start',
  'marker-mid',
  'marker-end',
  'shape-inside',
  'shape-subtract',
])
/**
 * Work per filter primitive application, in the units of `elementWork`,
 * measured in Chrome on CPU canvas as ten primitives over an 800 px region
 * (ms per primitive in brackets) and rounded up: blur (8–9 over the canvas,
 * up to 118 in a chain of eight over a region ten times the canvas at the
 * largest allowed deviation, so 640),
 * arithmetic composite (23), blend and composite (11), turbulence at ten
 * octaves (9.5), merge (5), colour matrix and component transfer (3), offset,
 * flood and tile (under 1.5). Anything else counts as 600. Primitives whose
 * cost grows with a user-unit size — `feMorphology`, the lighting primitives,
 * `feConvolveMatrix` — and the ones no exporter writes whose cost grows with
 * the device region (`feDisplacementMap`, `feDropShadow`) are refused
 * (`exceedsFilterLimits`).
 */
const FILTER_PRIMITIVE_WORK: Record<string, number> = {
  feturbulence: 300,
  fecomposite: 125,
  fegaussianblur: 640,
  feblend: 75,
  femerge: 50,
  fecolormatrix: 25,
  fecomponenttransfer: 25,
  feimage: 25,
  feoffset: 10,
  feflood: 10,
  fetile: 10,
}
const DEFAULT_FILTER_PRIMITIVE_WORK = 600
/**
 * A gradient stop costs twice an element: a full-canvas fill with a 30-stop
 * radial gradient measured 6–11 ms in Chrome, against 31 units at one per stop.
 */
const GRADIENT_STOP_WORK = 2
/**
 * Every rendered element is costed as translucent: a translucent fill
 * measured about 1.8 times an opaque one in Chrome, and opacity can come from
 * attributes, `style`, stylesheets, `rgba()`/`hsla()` colours or gradient
 * stops, which the bound does not resolve.
 */
const TRANSLUCENT_WORK_FACTOR = 2
const REFERENCE_ONLY_ELEMENTS = new Set([
  'defs',
  'symbol',
  'filter',
  'lineargradient',
  'radialgradient',
  'pattern',
  'marker',
  'mask',
  'clippath',
])
const USER_UNIT_SCALED_PRIMITIVES = new Set([
  'femorphology',
  'fespecularlighting',
  'fediffuselighting',
  'feconvolvematrix',
  'fedisplacementmap',
  'fedropshadow',
])
const CSS_ALLOWED_FUNCTIONS = new Set(['url', 'rgb', 'rgba', 'hsl', 'hsla'])
const SMIL_ELEMENTS = new Set(['animate', 'animatecolor', 'animatemotion', 'animatetransform', 'set', 'mpath', 'discard'])
const CSS_ACTIVE_IDENTIFIERS = new Set(['behavior', '-moz-binding', 'javascript', 'vbscript'])
const RASTER_DATA_URI_PATTERN = /^data:(image\/(?:png|jpeg));base64,([a-z0-9+/=\t\n\f\r ]+)$/i
const ACTIVE_SCHEME_PATTERN = /^(?:javascript|vbscript|data):/i
const DTD_DECLARATION_PATTERN = /<!(?:ENTITY|ATTLIST|ELEMENT|NOTATION)/i
const VENDOR_PREFIX_PATTERN = /^-[a-z0-9]+-/
const PAINTED_ELEMENTS = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'textpath'])
const MARKABLE_ELEMENTS = new Set(['path', 'line', 'polyline', 'polygon'])
const NON_INHERITED_REFERENCE_PROPERTIES = new Set(['clip-path', 'mask', 'filter', 'shape-inside', 'shape-subtract'])
const SIMPLE_SELECTOR_NAME = '-?[_a-zA-Z\\u0080-\\uffff][-_a-zA-Z0-9\\u0080-\\uffff]*'
const CSS_IDENTIFIER_PATTERN = new RegExp(`^${SIMPLE_SELECTOR_NAME}$`)
const PLAIN_ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/
const NON_RENDERING_PROPERTY_SOURCES = new Set(['lineargradient', 'radialgradient', 'stop', 'filter'])

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

/**
 * The pixel size of an embedded PNG: its chunks are walked to the end, the
 * first must be the only `IHDR`, and an animated PNG (`acTL`, `fcTL`) is
 * refused, so no later chunk can declare a larger image.
 */
function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  let size: { width: number; height: number } | null = null
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    if (type === 'IHDR') {
      if (size || offset !== 8 || length !== 13 || offset + 16 > bytes.length) return null
      size = { width: bytes.readUInt32BE(offset + 8), height: bytes.readUInt32BE(offset + 12) }
    } else if (!size || type === 'acTL' || type === 'fcTL') {
      return null
    }
    if (type === 'IEND') return size
    offset += 12 + length
  }
  return size
}

/**
 * The pixel size of an embedded JPEG: its markers are walked up to the first
 * scan, skipping `0xFF` fill bytes as decoders do, and exactly one baseline,
 * extended or progressive start-of-frame (`SOF0`–`SOF2`) is allowed.
 * Hierarchical (`DHP`), lossless and arithmetic frames, and the parameterless
 * markers (`TEM`, `RST0`–`RST7`, a second `SOI`, `EOI`) before the scan, are
 * refused — reading a fill byte as a marker let a comment hide a decoy frame.
 */
function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  let size: { width: number; height: number } | null = null
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset]!
    offset += 1
    if (marker === 0xda) return size
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) return null
    if (offset + 2 > bytes.length) return null
    const length = bytes.readUInt16BE(offset)
    if (length < 2) return null
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (size || offset + 7 > bytes.length) return null
      size = { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    } else if ((marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) || marker === 0xde) {
      return null
    }
    offset += length
  }
  return null
}

/**
 * True when the decoded bytes carry the declared raster signature and a
 * single frame no larger than `VECTOR_IMAGE_MAX_RASTER_SIDE` on either side.
 * Only PNG and JPEG are accepted — the only formats logo exporters embed — so
 * every frame and descriptor of each format is checked. A small file can
 * declare a huge image that every viewer then decodes.
 */
function hasRasterSignature(mimeType: string, base64: string): boolean {
  const bytes = Buffer.from(base64.replace(/[\t\n\f\r ]+/g, ''), 'base64')
  const type = mimeType.toLowerCase()
  if (detectAttachmentMimeType(bytes, null, null) !== type) return false
  const size = type === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes)
  return Boolean(size)
    && size!.width > 0 && size!.height > 0
    && size!.width <= VECTOR_IMAGE_MAX_RASTER_SIDE && size!.height <= VECTOR_IMAGE_MAX_RASTER_SIDE
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
 *
 * A fragment is allowed only as `#` and a plain id (`PLAIN_ID_PATTERN`). A
 * browser percent-decodes a fragment (`#%61` names `id="a"`); a plain fragment
 * has no encoding for the sanitiser and a browser to read differently, and
 * lookups use the id verbatim. An element whose `id` is not plain stays, but
 * no allowed fragment can name it.
 */
function classifyReference(value: string, allowRasterData: boolean): VectorImageFindingKind | null {
  if (value.startsWith('#')) return PLAIN_ID_PATTERN.test(value.slice(1)) ? null : 'active_content'
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

type CssTokenType = 'ident' | 'function' | 'at' | 'hash' | 'string' | 'url' | 'whitespace' | 'delim'

type CssToken = { type: CssTokenType; value: string }

/**
 * The sanitiser's one CSS tokenizer, after CSS Syntax Level 3. Comments,
 * strings, `url(` tokens, functions, at-keywords and hashes are recognised
 * here, once: the CSS policy, the stylesheet rules and the references of each
 * declaration all consume these tokens, so no two readers can split the text
 * differently. A comment opener inside a string or inside an unquoted `url(`
 * is part of that token, as in a browser.
 *
 * Returns null — refused as active content — for what could make it disagree
 * with a browser and logos never need: an escape (`\`), a string ended by a
 * newline or by the end of the text, an unterminated comment or `url(`, a
 * malformed unquoted URL (quote, `(` or inner whitespace), and a
 * vendor-prefixed `url(` (a plain function to a browser, in which `/*` opens a
 * comment). CDO and CDC (`<!--`, `-->`) tokenise here as a `--` identifier,
 * which the policy refuses as a custom property.
 */
function tokenizeCss(css: string): CssToken[] | null {
  const tokens: CssToken[] = []
  let index = 0
  while (index < css.length) {
    const character = css[index]!
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2)
      if (end < 0) return null
      index = end + 2
      continue
    }
    if (character === '\\') return null
    if (character === '"' || character === "'") {
      let end = index + 1
      while (end < css.length && css[end] !== character) {
        const inner = css[end]
        if (inner === '\\' || inner === '\n' || inner === '\r' || inner === '\f') return null
        end += 1
      }
      if (end >= css.length) return null
      tokens.push({ type: 'string', value: css.slice(index + 1, end) })
      index = end + 1
      continue
    }
    if (isCssWhitespace(character)) {
      let end = index + 1
      while (isCssWhitespace(css[end])) end += 1
      tokens.push({ type: 'whitespace', value: ' ' })
      index = end
      continue
    }
    if (character === '@' || character === '#') {
      const end = readCssName(css, index + 1)
      if (end > index + 1) {
        tokens.push({ type: character === '@' ? 'at' : 'hash', value: css.slice(index + 1, end) })
        index = end
        continue
      }
    }
    if (isCssNameCharacter(css.charCodeAt(index))) {
      const end = readCssName(css, index)
      const name = css.slice(index, end)
      if (css[end] !== '(') {
        tokens.push({ type: 'ident', value: name })
        index = end
        continue
      }
      const lower = name.toLowerCase()
      let start = end + 1
      while (isCssWhitespace(css[start])) start += 1
      if (lower !== 'url' || css[start] === '"' || css[start] === "'") {
        if (lower !== 'url' && lower.replace(VENDOR_PREFIX_PATTERN, '') === 'url') return null
        tokens.push({ type: 'function', value: name })
        index = end + 1
        continue
      }
      let close = start
      while (close < css.length && css[close] !== ')') {
        const inner = css[close]!
        if (inner === '"' || inner === "'" || inner === '(' || inner === '\\') return null
        close += 1
      }
      if (close >= css.length) return null
      const target = trimCssWhitespace(css.slice(start, close))
      if (/[\t\n\f\r ]/.test(target)) return null
      tokens.push({ type: 'url', value: target })
      index = close + 1
      continue
    }
    tokens.push({ type: 'delim', value: character })
    index += 1
  }
  return tokens
}

/**
 * The CSS policy over a token stream: the only functions are `url()` and the
 * colour functions `rgb()`, `rgba()`, `hsl()`, `hsla()` — no gradients,
 * image functions, `path()` or filter functions; a `filter` is one `url()` or
 * `none` (`isSingleFilterReference`); `url()` targets must be fragments or
 * allowed raster `data:` URIs, and may appear only in `URL_PROPERTIES` (paint,
 * clip, mask, filter and marker); `@import`, string-URL functions and external
 * `url()`s are external references; `expression()`, `var()`, `if()`, custom
 * properties (`--*`), the CSS `d` property and the identifiers `behavior`,
 * `-moz-binding`, `javascript`, `vbscript` are active content. A declaration's
 * property changes only at function depth 0, so `;`, `:` or `else:` inside a
 * function cannot move a `url()` to another property. Every allowed target is
 * reported to `onUrl` with the property it was found in: the declaration's
 * name, or `property` for an attribute value.
 */
function inspectCssTokens(
  tokens: CssToken[],
  property: string | null,
  onUrl: ((target: string, property: string | null) => void) | null,
): VectorImageFindingKind | null {
  let verdict: VectorImageFindingKind | null = null
  let currentProperty = property
  let pendingName: string | null = null
  let depth = 0
  let valueStart = property === null ? -1 : 0
  const filterValueRefused = (end: number): boolean => currentProperty === 'filter' && !isSingleFilterReference(tokens.slice(valueStart, end))
  const reference = (target: string): VectorImageFindingKind | null => {
    const kind = classifyReference(target, true)
    if (kind !== null) return kind
    if (!URL_PROPERTIES.has(currentProperty ?? '')) return 'active_content'
    onUrl?.(target, currentProperty)
    return null
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token.type === 'whitespace') continue
    if (token.type === 'ident' || token.type === 'function') {
      const name = token.value.toLowerCase()
      if (name.startsWith('--')) return 'active_content'
      if (token.type === 'ident') {
        if (CSS_ACTIVE_IDENTIFIERS.has(name)) return 'active_content'
        pendingName = name
        continue
      }
      pendingName = null
      depth += 1
      if (name === 'url') {
        let next = index + 1
        while (tokens[next]?.type === 'whitespace') next += 1
        const argument = tokens[next]
        if (argument?.type !== 'string') return 'active_content'
        const kind = reference(argument.value)
        if (kind === 'active_content') return kind
        verdict = verdict ?? kind
        index = next
        continue
      }
      const functionName = name.replace(VENDOR_PREFIX_PATTERN, '')
      if (CSS_ACTIVE_FUNCTIONS.has(functionName)) return 'active_content'
      if (CSS_STRING_URL_FUNCTIONS.has(functionName)) verdict = verdict ?? 'external_reference'
      else if (!CSS_ALLOWED_FUNCTIONS.has(name)) return 'active_content'
      continue
    }
    if (token.type === 'url') {
      const kind = reference(token.value)
      if (kind === 'active_content') return kind
      verdict = verdict ?? kind
    } else if (token.type === 'at') {
      if (token.value.toLowerCase() === 'import') verdict = verdict ?? 'external_reference'
    } else if (token.type === 'delim') {
      if (token.value === '(') {
        depth += 1
      } else if (token.value === ')') {
        depth = Math.max(0, depth - 1)
      } else if (token.value === '{' || token.value === '}') {
        if (filterValueRefused(index)) return 'active_content'
        currentProperty = null
        depth = 0
      } else if (depth === 0 && token.value === ':') {
        currentProperty = pendingName ?? currentProperty
        valueStart = index + 1
        if (currentProperty === 'd') return 'active_content'
      } else if (depth === 0 && token.value === ';') {
        if (filterValueRefused(index)) return 'active_content'
        currentProperty = property
        valueStart = index + 1
      }
    }
    pendingName = null
  }
  if (filterValueRefused(tokens.length)) return 'active_content'
  return verdict
}

/**
 * A `filter` value may only be `none` or one `url()` to an SVG filter, which
 * the render-work bound counts; CSS filter functions (`blur()`,
 * `drop-shadow()`, …) and chains are refused. `!important` may follow.
 */
function isSingleFilterReference(value: CssToken[]): boolean {
  const significant = value.filter((token) => token.type !== 'whitespace')
  const last = significant.length
  const important = last >= 2
    && significant[last - 2]!.type === 'delim' && significant[last - 2]!.value === '!'
    && significant[last - 1]!.type === 'ident' && significant[last - 1]!.value.toLowerCase() === 'important'
  const core = important ? significant.slice(0, -2) : significant
  if (core.length === 1) return core[0]!.type === 'url' || (core[0]!.type === 'ident' && core[0]!.value.toLowerCase() === 'none')
  return core.length === 3
    && core[0]!.type === 'function' && core[0]!.value.toLowerCase() === 'url'
    && core[1]!.type === 'string'
    && core[2]!.type === 'delim' && core[2]!.value === ')'
}

/**
 * Classifies a stylesheet or a CSS-parsed attribute value: `tokenizeCss`, then
 * `inspectCssTokens`. Deliberately stricter than a browser, because each
 * refusal is a way to make two parsers disagree and logos need none.
 */
export function inspectVectorImageCss(css: string): VectorImageFindingKind | null {
  return scanCss(css, null, null)
}

function scanCss(
  css: string,
  property: string | null,
  onUrl: ((target: string, property: string | null) => void) | null,
): VectorImageFindingKind | null {
  const tokens = tokenizeCss(css)
  return tokens ? inspectCssTokens(tokens, property, onUrl) : 'active_content'
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
 * wrap stylesheets in CDATA; the CSS policy still inspects that text). Carriage
 * returns in character data (`&#xD;`) become line feeds first: the serialiser
 * writes a raw CR, which re-parses as LF, so the checked DOM would otherwise
 * differ from what the stored bytes parse to. A
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
      const text = child.textContent ?? ''
      if (child.nodeType === NODE_CDATA_SECTION || (child.nodeType === NODE_TEXT && text.includes('\r'))) {
        kept.push(document.createTextNode(text.replace(/\r\n?/g, '\n')))
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
  if (isHrefAttribute(attribute)) {
    const target = trimUrlBoundary(attribute.value)
    if (tag === 'image' && target.startsWith('#')) return 'active_content'
    return classifyReference(target, RASTER_DATA_URI_ELEMENTS.has(tag))
  }
  if (attribute.namespaceURI !== null) return null
  const name = attribute.localName.toLowerCase()
  if (!name.startsWith('aria-') && /var\s*\(/i.test(attribute.value)) return 'active_content'
  if (CSS_PARSED_ATTRIBUTES.has(name) || /url\s*\(/i.test(attribute.value)) {
    return scanCss(attribute.value, name === 'style' ? null : name, null)
  }
  return null
}

/**
 * Applies the reference and CSS policy to what DOMPurify kept and returns the
 * first violation, if any. Nothing is removed: a violation refuses the whole
 * document.
 */
function findReferenceViolation(
  root: DomElement,
  readSheet: (css: string) => StylesheetReading,
  rules: StyleRule[],
): VectorImageFinding | null {
  let finding: VectorImageFinding | null = null
  walk(root, (node) => {
    if (finding || !isElement(node)) return false
    const tag = node.localName.toLowerCase()
    const attributes = attributesOf(node)
    if (SMIL_ELEMENTS.has(tag)) {
      finding = { kind: 'active_content', target: describeElement(node) }
      return false
    }
    if (attributes.some((attribute) => attribute.namespaceURI === XML_NAMESPACE && attribute.localName === 'id')) {
      finding = { kind: 'active_content', target: `${describeElement(node)}@xml:id` }
      return false
    }
    if (hasConflictingHrefs(attributes)) {
      finding = { kind: 'active_content', target: `${describeElement(node)}@href` }
      return false
    }
    if (tag === 'style') {
      const reading: StylesheetReading = hasOnlyTextChildren(node)
        ? readSheet(styleSheetText(node))
        : { kind: 'active_content' }
      if ('kind' in reading) finding = { kind: reading.kind, target: describeElement(node) }
      else for (const rule of reading.rules) rules.push(rule)
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

type StyleRule = { selectors: string[]; references: FragmentReference[] }

type StylesheetReading = { rules: StyleRule[] } | { kind: VectorImageFindingKind }

/**
 * One selector of a rule, from its tokens, when it is simple: a type or `*`,
 * then any `.class` and `#id`, with no whitespace inside (a combinator).
 * Returns null for anything else.
 */
function simpleSelector(tokens: CssToken[]): string | null {
  let start = 0
  let end = tokens.length
  while (start < end && tokens[start]!.type === 'whitespace') start += 1
  while (end > start && tokens[end - 1]!.type === 'whitespace') end -= 1
  if (start === end) return null
  let text = ''
  for (let index = start; index < end; index += 1) {
    const token = tokens[index]!
    if (index === start && token.type === 'ident' && CSS_IDENTIFIER_PATTERN.test(token.value)) {
      text += token.value
    } else if (index === start && token.type === 'delim' && token.value === '*') {
      text += '*'
    } else if (token.type === 'hash' && CSS_IDENTIFIER_PATTERN.test(token.value)) {
      text += `#${token.value}`
    } else if (token.type === 'delim' && token.value === '.' && tokens[index + 1]?.type === 'ident' && CSS_IDENTIFIER_PATTERN.test(tokens[index + 1]!.value)) {
      index += 1
      text += `.${tokens[index]!.value}`
    } else {
      return null
    }
  }
  return text
}

/**
 * The rules of a stylesheet, from its tokens: flat rules whose selectors are
 * simple (`simpleSelector`), in a comma list — the subset logo exporters write
 * (`.st0{…}`, `path.st1, #a{…}`). Anything else returns null: an at-rule, a
 * selector that is not simple, a nested or unclosed block, unbalanced
 * brackets, a stray `}` or `;`. Each rule keeps the in-document references its
 * declarations make, read from the same tokens.
 */
function parseStyleRules(tokens: CssToken[]): StyleRule[] | null {
  const rules: StyleRule[] = []
  let prelude: CssToken[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]!
    if (token.type === 'at') return null
    if (token.type !== 'delim' || (token.value !== '{' && token.value !== '}' && token.value !== ';')) {
      prelude.push(token)
      index += 1
      continue
    }
    if (token.value !== '{') return null
    const selectors: string[] = []
    let selectorStart = 0
    for (let position = 0; position <= prelude.length; position += 1) {
      const separator = prelude[position]
      if (position < prelude.length && !(separator!.type === 'delim' && separator!.value === ',')) continue
      const selector = simpleSelector(prelude.slice(selectorStart, position))
      if (!selector) return null
      selectors.push(selector)
      selectorStart = position + 1
    }
    const closers: string[] = []
    let end = index + 1
    for (; end < tokens.length; end += 1) {
      const inner = tokens[end]!
      if (inner.type === 'at') return null
      if (inner.type === 'function') closers.push(')')
      if (inner.type !== 'delim') continue
      if (inner.value === '(') closers.push(')')
      else if (inner.value === '[') closers.push(']')
      else if (inner.value === ')' || inner.value === ']') {
        if (closers.pop() !== inner.value) return null
      } else if (inner.value === '{') {
        return null
      } else if (inner.value === '}') {
        if (closers.length) return null
        break
      }
    }
    if (end >= tokens.length) return null
    const references: FragmentReference[] = []
    inspectCssTokens(tokens.slice(index + 1, end), null, (target, property) => {
      if (target.startsWith('#')) references.push({ id: target.slice(1), multiplier: referenceMultiplier(property) })
    })
    rules.push({ selectors, references })
    prelude = []
    index = end + 1
  }
  if (prelude.some((token) => token.type !== 'whitespace')) return null
  return rules
}

/**
 * Reads one `<style>` once: one tokenization, then the CSS policy and the
 * rules over the same tokens. jsdom's CSSOM (rrweb-cssom) is never used on
 * untrusted CSS: it is quadratic on `@`, `!` and `(` and reads `url(/*` as a
 * comment, unlike browsers.
 */
function readStylesheet(css: string): StylesheetReading {
  const tokens = tokenizeCss(css)
  if (!tokens) return { kind: 'active_content' }
  const verdict = inspectCssTokens(tokens, null, null)
  if (verdict) return { kind: verdict }
  const rules = parseStyleRules(tokens)
  return rules ? { rules } : { kind: 'active_content' }
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
 * The single key a simple selector is indexed under: its id, else its first
 * class, else its type, else null for `*` (any element). Further classes only
 * narrow the match, so dropping them keeps the estimate an upper bound.
 */
function selectorKey(selector: string): { key: 'id' | 'class' | 'type'; value: string } | null {
  const lower = selector.toLowerCase()
  const id = /#([^.#]+)/.exec(lower)
  if (id) return { key: 'id', value: id[1]! }
  const className = /\.([^.#]+)/.exec(lower)
  if (className) return { key: 'class', value: className[1]! }
  const type = /^[^.#*]+/.exec(lower)
  return type ? { key: 'type', value: type[0] } : null
}

/**
 * Indexes every in-document `url()` the stylesheets hold under the selectors
 * that could apply it, or returns null when the stylesheets exceed the rule,
 * selector, reference or work caps. The work cap bounds Σ selectors ×
 * references, which is exactly the number of index writes, before any is made.
 */
function indexStylesheetReferences(rules: StyleRule[]): StylesheetReferenceIndex | null {
  const index: StylesheetReferenceIndex = { any: { references: new Map() }, byId: new Map(), byClass: new Map(), byType: new Map() }
  if (rules.length > VECTOR_IMAGE_MAX_STYLE_RULES) return null
  let work = 0
  for (const rule of rules) {
    work += rule.selectors.length * rule.references.length
    if (
      rule.selectors.length > VECTOR_IMAGE_MAX_SELECTORS_PER_RULE
      || rule.references.length > VECTOR_IMAGE_MAX_REFERENCES_PER_RULE
      || work > VECTOR_IMAGE_MAX_STYLE_WORK
    ) {
      return null
    }
  }
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      const subject = selectorKey(selector)
      for (const reference of rule.references) {
        if (!subject) index.any.references.set(`${reference.multiplier}|${reference.id}`, reference)
        else if (subject.key === 'id') addToBucket(index.byId, subject.value, reference)
        else if (subject.key === 'class') addToBucket(index.byClass, subject.value, reference)
        else addToBucket(index.byType, subject.value, reference)
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

function directTextLength(element: DomElement): number {
  let length = 0
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === NODE_TEXT) length += (child.textContent ?? '').length
  }
  return length
}

/**
 * The drawing work of one rendered element, in units of about one 800 px
 * full-canvas fill (0.19 ms on CPU canvas in Chrome): one, plus one per
 * `VECTOR_IMAGE_RENDER_CHARACTERS_PER_UNIT` characters of path data, points
 * or text, or `FILTER_PRIMITIVE_WORK` for a filter primitive, which runs over
 * the whole filter region each time the filter is applied.
 */
function elementWork(element: DomElement, tag: string): number {
  if ((element.parentNode as DomElement | null)?.localName?.toLowerCase() === 'filter') {
    return FILTER_PRIMITIVE_WORK[tag] ?? DEFAULT_FILTER_PRIMITIVE_WORK
  }
  if (tag === 'stop') return GRADIENT_STOP_WORK
  let length = 0
  if (tag === 'path') length = (element.getAttribute('d') ?? '').length
  else if (tag === 'polyline' || tag === 'polygon') length = (element.getAttribute('points') ?? '').length
  else if (tag === 'text' || tag === 'tspan' || tag === 'textpath') length = directTextLength(element)
  return TRANSLUCENT_WORK_FACTOR * (1 + Math.ceil(length / VECTOR_IMAGE_RENDER_CHARACTERS_PER_UNIT))
}

/**
 * Filter limits checked before the estimate: at most
 * `VECTOR_IMAGE_MAX_FILTER_PRIMITIVES` primitives in the document; no
 * primitive whose cost grows with a size in user units, which a small
 * `viewBox` or `primitiveUnits="objectBoundingBox"` turns into thousands of
 * device pixels (`feMorphology`, the lighting primitives, `feConvolveMatrix`),
 * nor `feDisplacementMap` or `feDropShadow`; no
 * `primitiveUnits="objectBoundingBox"`; at most `VECTOR_IMAGE_MAX_BLURS`
 * blurs, each with a deviation no larger than
 * `VECTOR_IMAGE_MAX_BLUR_DEVIATION_RATIO` of the root viewport's smaller side;
 * and no blur in a document that can scale content up — a `transform` or
 * `patternTransform` stretching by more than 1, or a `viewBox` below the root.
 * Measured in Chrome, a blur's cost grows with its deviation and region in
 * device pixels: eight chained blurs over a region ten times the canvas took
 * 0.95 s at a deviation of 10% of the viewport, 3.3 s at 50%, and 3.4 s at
 * 4% under `scale(10)`. No corpus file or logo exporter needs more (the
 * largest deviation seen is 3.3%, the most blurs five).
 */
function exceedsFilterLimits(root: DomElement): boolean {
  let primitives = 0
  let blurs = 0
  let scalesUp = false
  let exceeded = false
  const maxDeviation = rootViewportSize(root) * VECTOR_IMAGE_MAX_BLUR_DEVIATION_RATIO
  walk(root, (node) => {
    if (exceeded || !isElement(node)) return false
    const parent = node.parentNode as DomElement | null
    if (parent?.localName?.toLowerCase() === 'filter') primitives += 1
    const tag = node.localName.toLowerCase()
    if (USER_UNIT_SCALED_PRIMITIVES.has(tag)) exceeded = true
    if (tag === 'fegaussianblur') {
      blurs += 1
      const deviations = (node.getAttribute('stdDeviation') ?? '0').trim().split(/[\s,]+/).map(Number)
      if (blurs > VECTOR_IMAGE_MAX_BLURS || deviations.some((value) => !(value >= 0 && value <= maxDeviation))) exceeded = true
    }
    if (node !== root && node.getAttribute('viewBox') !== null) scalesUp = true
    for (const name of ['transform', 'patternTransform']) {
      const transform = node.getAttribute(name)
      if (transform !== null && transformScale(transform) > 1 + 1e-9) scalesUp = true
    }
    if (tag === 'filter' && (node.getAttribute('primitiveUnits') ?? '').trim() === 'objectBoundingBox') exceeded = true
    exceeded = exceeded || primitives > VECTOR_IMAGE_MAX_FILTER_PRIMITIVES
    return !exceeded
  })
  return exceeded || (blurs > 0 && scalesUp)
}

/**
 * The smaller side of the root's `viewBox`, or of its `width`/`height` when it
 * has none: the user-unit size a blur deviation is measured against. NaN when
 * neither can be read, which refuses any blur.
 */
function rootViewportSize(root: DomElement): number {
  const viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (viewBox.length === 4 && viewBox.every(Number.isFinite)) return Math.min(viewBox[2]!, viewBox[3]!)
  const width = Number.parseFloat(root.getAttribute('width') ?? '')
  const height = Number.parseFloat(root.getAttribute('height') ?? '')
  return Math.min(width, height)
}

/**
 * The largest factor by which a transform list can stretch a length: the
 * largest singular value of its linear part, composed over the list.
 * Anything it cannot parse counts as infinite.
 */
function transformScale(transform: string): number {
  let [scaleX, skewY, skewX, scaleY] = [1, 0, 0, 1]
  const pattern = /\s*,?\s*([a-zA-Z]+)\s*\(([^)]*)\)/y
  let rest = transform.trim()
  while (rest) {
    pattern.lastIndex = 0
    const match = pattern.exec(rest)
    if (!match) return Infinity
    rest = rest.slice(match[0].length).trim()
    const values = match[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number)
    if (values.some((value) => !Number.isFinite(value))) return Infinity
    const name = match[1]!.toLowerCase()
    let next: [number, number, number, number]
    if (name === 'matrix' && values.length === 6) next = [values[0]!, values[1]!, values[2]!, values[3]!]
    else if (name === 'scale' && (values.length === 1 || values.length === 2)) next = [values[0]!, 0, 0, values[1] ?? values[0]!]
    else if (name === 'translate' && (values.length === 1 || values.length === 2)) next = [1, 0, 0, 1]
    else if (name === 'rotate' && (values.length === 1 || values.length === 3)) next = [1, 0, 0, 1]
    else if (name === 'skewx' && values.length === 1) next = [1, 0, Math.tan((values[0]! * Math.PI) / 180), 1]
    else if (name === 'skewy' && values.length === 1) next = [1, Math.tan((values[0]! * Math.PI) / 180), 0, 1]
    else return Infinity
    ;[scaleX, skewY, skewX, scaleY] = [
      scaleX * next[0] + skewX * next[1],
      skewY * next[0] + scaleY * next[1],
      scaleX * next[2] + skewX * next[3],
      skewY * next[2] + scaleY * next[3],
    ]
  }
  const sum = scaleX * scaleX + skewY * skewY + skewX * skewX + scaleY * scaleY
  const determinant = scaleX * scaleY - skewY * skewX
  return Math.sqrt((sum + Math.sqrt(Math.max(0, sum * sum - 4 * determinant * determinant))) / 2)
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
 * Elements that render only through a reference (`defs`, `symbol`, filters,
 * paint servers, markers, masks, clip paths) add nothing where they are
 * defined, only where they are referenced, so a definition is not counted
 * twice. Each rendered element counts its drawing work (`elementWork`).
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
function exceedsRenderedSize(root: DomElement, stylesheetRules: StyleRule[]): boolean {
  if (exceedsFilterLimits(root)) return true
  const byId = new Map<string, DomElement>()
  walk(root, (node) => {
    if (!isElement(node)) return false
    const id = node.getAttribute('id')
    if (id && !byId.has(id)) byId.set(id, node)
    return true
  })
  const stylesheetIndex = indexStylesheetReferences(stylesheetRules)
  if (!stylesheetIndex) return true
  type RenderNode = DomElement | ReferenceBucket
  type Edge =
    | { kind: 'tree'; target: DomElement }
    | { kind: 'instance'; target: DomElement }
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
    if (linked && tag === 'use') edges.push({ kind: 'instance', target: linked })
    if (linked && tag !== 'use' && tag !== 'a') edges.push({ kind: 'reference', target: linked, multiplier: 'once' })
    if (NON_RENDERING_PROPERTY_SOURCES.has(tag) || tag.startsWith('fe')) return edges
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
      rendered: elementWork(node, tag),
    }
  }
  const times = (totals: Totals, multiplier: ReferenceMultiplier): number => {
    if (multiplier === 'once') return 1
    if (multiplier === 'painted') return totals.painted
    return multiplier === 'markables' ? totals.markables : totals.vertices
  }
  const absorb = (node: RenderNode, totals: Totals, edge: Edge, dependency: Totals): boolean => {
    if (edge.kind === 'tree' || edge.kind === 'instance') {
      totals.painted += dependency.painted
      totals.markables += dependency.markables
      totals.vertices += dependency.vertices
      if (edge.kind === 'instance' || !REFERENCE_ONLY_ELEMENTS.has(edge.target.localName.toLowerCase())) {
        totals.rendered += dependency.rendered
      }
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
    return totals.rendered > VECTOR_IMAGE_MAX_RENDER_WORK
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

    const stylesheetRules: StyleRule[] = []
    const referenceFinding = findReferenceViolation(
      sanitised,
      readStylesheet,
      stylesheetRules,
    )
    if (referenceFinding) return refuse(referenceFinding)

    if (exceedsRenderedSize(sanitised, stylesheetRules)) return { ok: false, code: 'vector_image_too_complex', removals }

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
