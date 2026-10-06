import { createHash } from 'node:crypto'
import { detectAttachmentMimeType, getAttachmentExtension } from './security'

export const VECTOR_IMAGE_MIME_TYPE = 'image/svg+xml'
export const VECTOR_IMAGE_MAX_BYTES = 1024 * 1024
export const VECTOR_IMAGE_MAX_ELEMENTS = 10_000
export const VECTOR_IMAGE_MAX_DEPTH = 64
export const VECTOR_IMAGE_MAX_USE_INSTANCES = 10_000
export const VECTOR_IMAGE_SANITIZER = 'dompurify'
export const VECTOR_IMAGE_POLICY_VERSION = 1
export const VECTOR_IMAGE_METADATA_KEY = 'vectorImage'
export const VECTOR_IMAGE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
export const DEFAULT_ATTACHMENT_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox"

const TRUSTED_POLICY_VERSIONS = new Set([VECTOR_IMAGE_POLICY_VERSION])

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
const RASTER_DATA_URI_PATTERN = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i
const ACTIVE_SCHEME_PATTERN = /^(?:javascript|vbscript|data):/i
const UNSAFE_CSS_PATTERN = /\\|expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/
const STRING_URL_CSS_FUNCTION_PATTERN = /(?:^|[^a-z0-9_-])(?:-[a-z]+-)?(?:image-set|image|cross-fade|element|src|attr)\s*\(/
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi
const CSS_URL_OPENING_PATTERN = /url\(/gi

const NODE_ELEMENT = 1
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

export type VectorImageRecord = {
  sanitizer: string
  sanitizerVersion: string
  policyVersion: number
  sha256: string
  sanitizedAt: string
}

export type PreparedVectorImage =
  | { ok: true; buffer: Buffer; record: VectorImageRecord; removals: VectorImageRemoval[] }
  | { ok: false; code: VectorImageRejectionCode; removals: VectorImageRemoval[] }

type DomNode = {
  isConnected: boolean
  nodeType: number
  nodeName: string
  parentNode: DomNode | null
  childNodes: ArrayLike<DomNode>
  textContent: string | null
}

type DomAttribute = {
  name: string
  localName: string
  namespaceURI: string | null
  value: string
}

type DomElement = DomNode & {
  localName: string
  namespaceURI: string | null
  attributes: ArrayLike<DomAttribute>
  children: ArrayLike<DomElement>
  getAttribute(name: string): string | null
  removeAttributeNode(attribute: DomAttribute): unknown
  remove(): void
}

type DomDocument = DomNode & {
  documentElement: DomElement | null
  getElementsByTagName(name: string): ArrayLike<DomElement>
  getElementsByTagNameNS(namespace: string, name: string): ArrayLike<DomElement>
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

function hasEntityDeclaration(text: string): boolean {
  if (/<!ENTITY/i.test(text)) return true
  return /<!DOCTYPE[^>[]*\[/i.test(text)
}

function isElement(node: DomNode): node is DomElement {
  return node.nodeType === NODE_ELEMENT
}

function childElements(element: DomElement): DomElement[] {
  return Array.from(element.children)
}

function measureTree(root: DomElement): { elements: number; depth: number } {
  let elements = 0
  let depth = 0
  const stack: Array<{ element: DomElement; level: number }> = [{ element: root, level: 1 }]
  while (stack.length) {
    const { element, level } = stack.pop()!
    elements += 1
    if (level > depth) depth = level
    if (elements > VECTOR_IMAGE_MAX_ELEMENTS || depth > VECTOR_IMAGE_MAX_DEPTH) break
    for (const child of childElements(element)) stack.push({ element: child, level: level + 1 })
  }
  return { elements, depth }
}

function collectNodes(root: DomNode): DomNode[] {
  const nodes: DomNode[] = []
  const stack: DomNode[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    nodes.push(node)
    const children = Array.from(node.childNodes)
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]!)
  }
  return nodes
}

function collectElements(root: DomElement): DomElement[] {
  return collectNodes(root).filter(isElement)
}

function removeNode(node: DomNode): void {
  const parent = node.parentNode as (DomNode & { removeChild(child: DomNode): unknown }) | null
  parent?.removeChild(node)
}

function normaliseUrlValue(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 0x20 && code !== 0x7f
    })
    .join('')
}

function hasRasterSignature(mimeType: string, base64: string): boolean {
  const bytes = Buffer.from(base64.replace(/\s+/g, ''), 'base64')
  const normalised = mimeType.toLowerCase()
  return detectAttachmentMimeType(bytes, null, null) === normalised
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

export function inspectVectorImageCss(css: string): VectorImageRemovalKind | null {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const lower = stripped.toLowerCase()
  if (UNSAFE_CSS_PATTERN.test(lower)) return 'active_content'
  if (lower.includes('@import')) return 'external_reference'
  if (STRING_URL_CSS_FUNCTION_PATTERN.test(lower)) return 'external_reference'
  const openings = stripped.match(CSS_URL_OPENING_PATTERN)?.length ?? 0
  let parsed = 0
  let verdict: VectorImageRemovalKind | null = null
  for (const match of stripped.matchAll(CSS_URL_PATTERN)) {
    parsed += 1
    const target = match[1] ?? match[2] ?? match[3] ?? ''
    const kind = classifyReference(target, true)
    if (kind === 'active_content') return kind
    if (kind) verdict = kind
  }
  if (parsed !== openings) return 'external_reference'
  return verdict
}

function describeElement(node: DomNode): string {
  return `element:${node.nodeName}`
}

function describeAttribute(attribute: DomAttribute, owner?: DomNode | null): string {
  return owner ? `attribute:${owner.nodeName}@${attribute.name}` : `attribute:${attribute.name}`
}

function containsRenderingElement(element: DomElement): boolean {
  return collectElements(element).some(
    (candidate) => candidate !== element && RENDERING_ELEMENT_NAMESPACES.has(candidate.namespaceURI ?? ''),
  )
}

function removeInertNodes(root: DomDocument, removals: VectorImageRemoval[]): void {
  for (const node of collectNodes(root)) {
    if (node === root || !node.isConnected) continue
    if (node.nodeType === NODE_COMMENT || node.nodeType === NODE_DOCUMENT_TYPE) {
      removals.push({ kind: 'inert', target: node.nodeType === NODE_COMMENT ? 'comment' : 'doctype' })
      removeNode(node)
      continue
    }
    if (node.nodeType === NODE_PROCESSING_INSTRUCTION) {
      const isStylesheet = node.nodeName.toLowerCase() === 'xml-stylesheet'
      removals.push({
        kind: isStylesheet ? 'external_reference' : 'inert',
        target: `processing-instruction:${node.nodeName}`,
      })
      removeNode(node)
      continue
    }
    if (!isElement(node) || !node.isConnected) continue
    const namespace = node.namespaceURI ?? ''
    const isForeign = !RENDERING_ELEMENT_NAMESPACES.has(namespace)
    const isMetadata = namespace === SVG_NAMESPACE && node.localName === 'metadata'
    if (isForeign || isMetadata) {
      removals.push({
        kind: containsRenderingElement(node) ? 'active_content' : 'inert',
        target: describeElement(node),
      })
      removeNode(node)
      continue
    }
    for (const attribute of Array.from(node.attributes)) {
      const attributeNamespace = attribute.namespaceURI
      if (attributeNamespace === null || KEPT_ATTRIBUTE_NAMESPACES.has(attributeNamespace)) continue
      if (attributeNamespace === XMLNS_NAMESPACE) {
        if (KEPT_NAMESPACE_DECLARATIONS.has(attribute.value)) continue
      } else {
        removals.push({ kind: 'inert', target: describeAttribute(attribute, node) })
      }
      node.removeAttributeNode(attribute)
    }
  }
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

function applyReferencePolicy(root: DomElement, removals: VectorImageRemoval[]): void {
  for (const element of collectElements(root)) {
    if (!element.isConnected) continue
    const tag = element.localName.toLowerCase()
    if (ANIMATION_ELEMENTS.has(tag)) {
      const target = (element.getAttribute('attributeName') ?? '').trim().toLowerCase()
      if (target === 'href' || target.endsWith(':href')) {
        removals.push({ kind: 'active_content', target: describeElement(element) })
        element.remove()
        continue
      }
    }
    if (tag === 'style') {
      const verdict = inspectVectorImageCss(element.textContent ?? '')
      if (verdict) {
        removals.push({ kind: verdict, target: describeElement(element) })
        element.remove()
        continue
      }
    }
    for (const attribute of Array.from(element.attributes)) {
      let verdict: VectorImageRemovalKind | null = null
      if (isHrefAttribute(attribute)) {
        verdict = classifyReference(attribute.value, RASTER_DATA_URI_ELEMENTS.has(tag))
      } else if (attribute.localName.toLowerCase() === 'style' || /url\s*\(/i.test(attribute.value)) {
        verdict = inspectVectorImageCss(attribute.value)
      }
      if (!verdict) continue
      removals.push({ kind: verdict, target: describeAttribute(attribute, element) })
      element.removeAttributeNode(attribute)
    }
  }
}

function referencedId(element: DomElement): string | null {
  for (const attribute of Array.from(element.attributes)) {
    if (!isHrefAttribute(attribute)) continue
    const value = attribute.value.trim()
    if (value.startsWith('#')) return value.slice(1)
  }
  return null
}

function exceedsUseExpansion(root: DomElement): boolean {
  const elements = collectElements(root)
  const byId = new Map<string, DomElement>()
  for (const element of elements) {
    const id = element.getAttribute('id')
    if (id && !byId.has(id)) byId.set(id, element)
  }
  const memo = new Map<DomElement, number>()
  const visiting = new Set<DomElement>()
  const expand = (element: DomElement): number => {
    const cached = memo.get(element)
    if (cached !== undefined) return cached
    if (visiting.has(element)) return Number.POSITIVE_INFINITY
    visiting.add(element)
    let total = 0
    for (const candidate of collectElements(element)) {
      if (candidate.localName !== 'use') continue
      const targetId = referencedId(candidate)
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
  if (hasEntityDeclaration(text)) return { ok: false, code: 'vector_image_entity_declaration', removals }

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
    const { elements, depth } = measureTree(root)
    if (elements > VECTOR_IMAGE_MAX_ELEMENTS || depth > VECTOR_IMAGE_MAX_DEPTH) {
      return { ok: false, code: 'vector_image_too_complex', removals }
    }

    removeInertNodes(document, removals)

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

    const serialised = new window.XMLSerializer().serializeToString(root)
    return { ok: true, buffer: Buffer.from(serialised, 'utf8'), removals, sanitizerVersion: purify.version }
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

function readVectorImageRecord(storageMetadata: unknown): VectorImageRecord | null {
  if (!storageMetadata || typeof storageMetadata !== 'object' || Array.isArray(storageMetadata)) return null
  const record = (storageMetadata as Record<string, unknown>)[VECTOR_IMAGE_METADATA_KEY]
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const candidate = record as Record<string, unknown>
  if (candidate.sanitizer !== VECTOR_IMAGE_SANITIZER) return null
  if (typeof candidate.policyVersion !== 'number' || !TRUSTED_POLICY_VERSIONS.has(candidate.policyVersion)) return null
  if (typeof candidate.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.sha256)) return null
  return {
    sanitizer: candidate.sanitizer,
    sanitizerVersion: typeof candidate.sanitizerVersion === 'string' ? candidate.sanitizerVersion : '',
    policyVersion: candidate.policyVersion,
    sha256: candidate.sha256,
    sanitizedAt: typeof candidate.sanitizedAt === 'string' ? candidate.sanitizedAt : '',
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
