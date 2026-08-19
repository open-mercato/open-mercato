import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { Worker } from 'node:worker_threads'

export const DOCX_RENDER_MAX_CONCURRENCY = 2
export const DOCX_RENDER_MAX_QUEUE = 4
export const DOCX_RENDER_ACQUIRE_TIMEOUT_MS = 2_000
export const DOCX_RENDER_TIMEOUT_MS = 20_000
export const DOCX_MAX_OUTPUT_BYTES = 25 * 1024 * 1024
export const DOCX_WORKER_CHUNK_BYTES = 64 * 1024
export const DOCX_WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 4,
})
const DOCX_OVERLOADED_MARKER = Symbol.for('open-mercato.documents.docxRenderer.overloaded')
const DOCX_TIMEOUT_MARKER = Symbol.for('open-mercato.documents.docxRenderer.timeout')
const DOCX_OUTPUT_TOO_LARGE_MARKER = Symbol.for('open-mercato.documents.docxRenderer.outputTooLarge')
const DOCX_FAILED_MARKER = Symbol.for('open-mercato.documents.docxRenderer.failed')

export class DocxRenderOverloadedError extends Error {
  readonly [DOCX_OVERLOADED_MARKER] = true
  constructor() {
    super('DOCX renderer is at capacity')
    this.name = 'DocxRenderOverloadedError'
  }
}

export class DocxRenderTimeoutError extends Error {
  readonly [DOCX_TIMEOUT_MARKER] = true
  constructor() {
    super('DOCX renderer timed out')
    this.name = 'DocxRenderTimeoutError'
  }
}

export class DocxRenderOutputTooLargeError extends Error {
  readonly [DOCX_OUTPUT_TOO_LARGE_MARKER] = true
  constructor() {
    super('DOCX renderer output exceeded its byte limit')
    this.name = 'DocxRenderOutputTooLargeError'
  }
}

export class DocxRenderFailedError extends Error {
  readonly [DOCX_FAILED_MARKER] = true
  constructor(options: { cause?: unknown } = {}) {
    super('DOCX renderer failed', options)
    this.name = 'DocxRenderFailedError'
  }
}

function hasErrorMarker(error: unknown, marker: symbol): boolean {
  return Boolean(error && typeof error === 'object' && (error as Record<symbol, unknown>)[marker] === true)
}

export const isDocxRenderOverloadedError = (error: unknown): boolean => (
  error instanceof DocxRenderOverloadedError || hasErrorMarker(error, DOCX_OVERLOADED_MARKER)
)
export const isDocxRenderTimeoutError = (error: unknown): boolean => (
  error instanceof DocxRenderTimeoutError || hasErrorMarker(error, DOCX_TIMEOUT_MARKER)
)
export const isDocxRenderOutputTooLargeError = (error: unknown): boolean => (
  error instanceof DocxRenderOutputTooLargeError || hasErrorMarker(error, DOCX_OUTPUT_TOO_LARGE_MARKER)
)
export const isDocxRenderFailedError = (error: unknown): boolean => (
  error instanceof DocxRenderFailedError || hasErrorMarker(error, DOCX_FAILED_MARKER)
)

type DocxRendererOptions = {
  maxConcurrency?: number
  maxQueue?: number
  acquireTimeoutMs?: number
  renderTimeoutMs?: number
  maxOutputBytes?: number
}

export interface DocxWorker {
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
}

export type DocxWorkerFactoryInput = {
  html: string
  modulePath: string | null
  moduleSpecifier: string
  requireFrom: string
  maxOutputBytes: number
  chunkBytes: number
}

export type DocxWorkerFactory = (input: DocxWorkerFactoryInput) => DocxWorker

type DocxRendererDeps = {
  workerFactory?: DocxWorkerFactory
  modulePath?: string | null
  allocateOutput?: (byteLength: number) => Uint8Array
}

const DOCX_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input'])

function attributes(source) {
  const result = {}
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return result
}

function parseHtml(html) {
  const root = { tag: 'root', attrs: {}, children: [] }
  const stack = [root]
  const tokens = String(html).match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+/g) || []
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<!')) continue
    if (!token.startsWith('<')) {
      stack[stack.length - 1].children.push(token)
      continue
    }
    const closing = /^<\/\s*([A-Za-z0-9-]+)/.exec(token)
    if (closing) {
      const tag = closing[1].toLowerCase()
      while (stack.length > 1) {
        const node = stack.pop()
        if (node.tag === tag) break
      }
      continue
    }
    const opening = /^<\s*([A-Za-z0-9-]+)([\s\S]*?)\/?\s*>$/.exec(token)
    if (!opening) continue
    const tag = opening[1].toLowerCase()
    const node = { tag, attrs: attributes(opening[2]), children: [] }
    stack[stack.length - 1].children.push(node)
    if (!VOID_TAGS.has(tag) && !/\/\s*>$/.test(token)) stack.push(node)
  }
  return root
}

function decode(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_match, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name])
}

function inlineNodes(nodes, marks) {
  const result = []
  for (const child of Array.isArray(nodes) ? nodes : []) {
    if (typeof child === 'string') {
      const text = decode(child)
      if (text) result.push({ type: 'text', text, marks })
      continue
    }
    if (!child || typeof child !== 'object') continue
    if (child.tag === 'br') {
      result.push({ type: 'hardBreak' })
      continue
    }
    if (child.tag === 'img') {
      result.push({ type: 'image', attrs: { src: child.attrs.src || '' } })
      continue
    }
    const markType = ({ strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline', s: 'strike', strike: 'strike', code: 'code' })[child.tag]
    result.push(...inlineNodes(child.children, markType ? [...marks, { type: markType }] : marks))
  }
  return result
}

function blockNodes(nodes) {
  const result = []
  for (const child of Array.isArray(nodes) ? nodes : []) {
    if (typeof child === 'string') {
      if (decode(child).trim()) result.push({ type: 'paragraph', content: inlineNodes([child], []) })
      continue
    }
    if (!child || typeof child !== 'object') continue
    const align = /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)/i.exec(child.attrs.style || '')
    if (child.tag === 'div' && String(child.attrs.class || '').split(/\s+/).includes('page-break')) {
      result.push({ type: 'pageBreak' })
    } else if (child.tag === 'p' || child.tag === 'div') {
      result.push({ type: 'paragraph', attrs: { textAlign: align && align[1].toLowerCase() }, content: inlineNodes(child.children, []) })
    } else if (/^h[1-6]$/.test(child.tag)) {
      result.push({ type: 'heading', attrs: { level: Number(child.tag.slice(1)), textAlign: align && align[1].toLowerCase() }, content: inlineNodes(child.children, []) })
    } else if (child.tag === 'ul' || child.tag === 'ol') {
      result.push({
        type: child.tag === 'ol' ? 'orderedList' : 'bulletList',
        content: child.children.filter((item) => item && typeof item === 'object' && item.tag === 'li').map((item) => ({
          type: 'listItem',
          content: blockNodes(item.children).length ? blockNodes(item.children) : [{ type: 'paragraph', content: inlineNodes(item.children, []) }],
        })),
      })
    } else if (child.tag === 'blockquote') {
      result.push({ type: 'blockquote', content: inlineNodes(child.children, []) })
    } else if (child.tag === 'pre') {
      result.push({ type: 'codeBlock', content: inlineNodes(child.children, [{ type: 'code' }]) })
    } else if (child.tag === 'hr') {
      result.push({ type: 'horizontalRule' })
    } else if (child.tag === 'img') {
      result.push({ type: 'image', attrs: { src: child.attrs.src || '' } })
    } else if (child.tag === 'table') {
      const rows = []
      const visitRows = (entries) => {
        for (const entry of Array.isArray(entries) ? entries : []) {
          if (!entry || typeof entry !== 'object') continue
          if (entry.tag === 'tr') {
            rows.push({
              type: 'tableRow',
              content: entry.children.filter((cell) => cell && typeof cell === 'object' && ['td', 'th'].includes(cell.tag)).map((cell) => ({
                type: cell.tag === 'th' ? 'tableHeader' : 'tableCell',
                content: blockNodes(cell.children).length ? blockNodes(cell.children) : [{ type: 'paragraph', content: inlineNodes(cell.children, []) }],
              })),
            })
          } else visitRows(entry.children)
        }
      }
      visitRows(child.children)
      result.push({ type: 'table', content: rows })
    } else {
      const nested = blockNodes(child.children)
      if (nested.length) result.push(...nested)
      else if (inlineNodes(child.children, []).length) result.push({ type: 'paragraph', content: inlineNodes(child.children, []) })
    }
  }
  return result
}

function htmlToDocumentJson(html) {
  return { type: 'doc', content: blockNodes(parseHtml(html).children) }
}

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function markProperties(marks) {
  const names = new Set((Array.isArray(marks) ? marks : []).map((mark) => mark && mark.type))
  return [
    names.has('bold') ? '<w:b/>' : '',
    names.has('italic') ? '<w:i/>' : '',
    names.has('underline') ? '<w:u w:val="single"/>' : '',
    names.has('strike') ? '<w:strike/>' : '',
    names.has('code') ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : '',
  ].join('')
}

function textRun(node) {
  const text = String(node && node.text || '')
  const properties = markProperties(node && node.marks)
  return '<w:r>' + (properties ? '<w:rPr>' + properties + '</w:rPr>' : '')
    + '<w:t xml:space="preserve">' + xml(text) + '</w:t></w:r>'
}

function inlineContent(nodes, state) {
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    if (!node || typeof node !== 'object') return ''
    if (node.type === 'text') return textRun(node)
    if (node.type === 'hardBreak') return '<w:r><w:br/></w:r>'
    if (node.type === 'entityRef') return textRun({ text: node.attrs && node.attrs.label || '' })
    if (node.type === 'image') return imageRun(node, state)
    return inlineContent(node.content, state)
  }).join('')
}

function paragraphProperties(node, options) {
  const properties = []
  if (options && options.style) properties.push('<w:pStyle w:val="' + xml(options.style) + '"/>')
  if (options && options.numberId) {
    properties.push('<w:numPr><w:ilvl w:val="' + Number(options.level || 0) + '"/><w:numId w:val="' + Number(options.numberId) + '"/></w:numPr>')
  }
  const alignment = node && node.attrs && node.attrs.textAlign
  if (['left', 'center', 'right', 'justify'].includes(alignment)) {
    properties.push('<w:jc w:val="' + alignment + '"/>')
  }
  return properties.length ? '<w:pPr>' + properties.join('') + '</w:pPr>' : ''
}

function paragraph(node, state, options) {
  return '<w:p>' + paragraphProperties(node, options) + inlineContent(node && node.content, state) + '</w:p>'
}

function imageDimensions(bytes, mimeType) {
  if (mimeType === 'image/png' && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (mimeType === 'image/jpeg' && bytes.length >= 4) {
    let offset = 2
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) break
      const marker = bytes[offset + 1]
      offset += 2
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) break
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
      }
      offset += length
    }
  }
  return { width: 640, height: 480 }
}

function imageRun(node, state) {
  const source = node && node.attrs && node.attrs.src
  const match = typeof source === 'string' && /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source)
  if (!match) return ''
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== match[2]) return ''
  const extension = match[1] === 'image/png' ? 'png' : 'jpg'
  const imageId = state.images.length + 1
  const relationshipId = 'rId' + (imageId + 2)
  const dimensions = imageDimensions(bytes, match[1])
  const maxWidth = 5486400
  const scale = Math.min(1, 640 / Math.max(1, dimensions.width))
  const width = Math.max(9525, Math.round(dimensions.width * scale * 9525))
  const height = Math.max(9525, Math.round(dimensions.height * scale * 9525))
  state.images.push({ bytes, extension, relationshipId, imageId })
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
    + '<wp:extent cx="' + Math.min(width, maxWidth) + '" cy="' + Math.round(height * Math.min(1, maxWidth / width)) + '"/>'
    + '<wp:docPr id="' + imageId + '" name="Image ' + imageId + '"/>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + imageId + '" name="image.' + extension + '"/><pic:cNvPicPr/></pic:nvPicPr>'
    + '<pic:blipFill><a:blip r:embed="' + relationshipId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + width + '" cy="' + height + '"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
    + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
}

function renderList(node, state, level, numberId) {
  return (Array.isArray(node.content) ? node.content : []).map((item) => {
    const children = Array.isArray(item && item.content) ? item.content : []
    return children.map((child) => {
      if (child.type === 'paragraph') return paragraph(child, state, { numberId, level })
      if (child.type === 'bulletList') return renderList(child, state, level + 1, 1)
      if (child.type === 'orderedList') return renderList(child, state, level + 1, 2)
      return renderBlock(child, state)
    }).join('')
  }).join('')
}

function renderTable(node, state) {
  const rows = (Array.isArray(node.content) ? node.content : []).map((row) => {
    const cells = (Array.isArray(row && row.content) ? row.content : []).map((cell) => (
      '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'
      + (Array.isArray(cell && cell.content) ? cell.content.map((entry) => renderBlock(entry, state)).join('') : '<w:p/>')
      + '</w:tc>'
    )).join('')
    return '<w:tr>' + cells + '</w:tr>'
  }).join('')
  return '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/>'
    + '<w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/>'
    + '<w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>' + rows + '</w:tbl>'
}

function renderBlock(node, state) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'paragraph') return paragraph(node, state)
  if (node.type === 'heading') return paragraph(node, state, { style: 'Heading' + Math.min(6, Math.max(1, Number(node.attrs && node.attrs.level || 1))) })
  if (node.type === 'bulletList' || node.type === 'taskList') return renderList(node, state, 0, 1)
  if (node.type === 'orderedList') return renderList(node, state, 0, 2)
  if (node.type === 'blockquote') return '<w:p><w:pPr><w:ind w:left="720"/></w:pPr>' + inlineContent(node.content, state) + '</w:p>'
  if (node.type === 'codeBlock') return '<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>' + inlineContent(node.content, state) + '</w:p>'
  if (node.type === 'horizontalRule') return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6"/></w:pBdr></w:pPr></w:p>'
  if (node.type === 'table') return renderTable(node, state)
  if (node.type === 'pageBreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  if (node.type === 'image') return '<w:p>' + imageRun(node, state) + '</w:p>'
  return (Array.isArray(node.content) ? node.content : []).map((child) => renderBlock(child, state)).join('')
}

function documentXml(documentJson, state) {
  const body = (Array.isArray(documentJson && documentJson.content) ? documentJson.content : [])
    .map((node) => renderBlock(node, state)).join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'
}

async function convert(documentJson, JSZip) {
  const zip = new JSZip()
  const state = { images: [] }
  const document = documentXml(documentJson, state)
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
    + '<Default Extension="jpg" ContentType="image/jpeg"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    + '</Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>')
  zip.file('word/document.xml', document)
  zip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?>'
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    + [1,2,3,4,5,6].map((level) => '<w:style w:type="paragraph" w:styleId="Heading' + level + '"><w:name w:val="heading ' + level + '"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="' + (34 - level * 2) + '"/></w:rPr></w:style>').join('')
    + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr></w:style>'
    + '</w:styles>')
  zip.file('word/numbering.xml', '<?xml version="1.0" encoding="UTF-8"?>'
    + '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>'
    + '<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>'
    + '</w:numbering>')
  const relationships = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
  ]
  for (const image of state.images) {
    zip.file('word/media/image' + image.imageId + '.' + image.extension, image.bytes)
    relationships.push('<Relationship Id="' + image.relationshipId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + image.imageId + '.' + image.extension + '"/>')
  }
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + relationships.join('') + '</Relationships>')
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

;(async () => {
  const imported = typeof workerData.modulePath === 'string'
    ? require(workerData.modulePath)
    : require('node:module').createRequire(workerData.requireFrom)(workerData.moduleSpecifier)
  const JSZip = typeof imported === 'function' ? imported : imported && imported.default
  if (typeof JSZip !== 'function') throw new Error('[internal] JSZip export is not callable')
  const bytes = await convert(htmlToDocumentJson(workerData.html), JSZip)
  if (bytes.byteLength > workerData.maxOutputBytes) {
    parentPort.postMessage({ type: 'overflow' })
    parentPort.close()
    return
  }

  parentPort.postMessage({ type: 'start', totalBytes: bytes.byteLength })
  for (let offset = 0; offset < bytes.byteLength; offset += workerData.chunkBytes) {
    const length = Math.min(workerData.chunkBytes, bytes.byteLength - offset)
    const chunk = new Uint8Array(length)
    chunk.set(bytes.subarray(offset, offset + length))
    parentPort.postMessage({ type: 'chunk', chunk }, [chunk.buffer])
  }
  parentPort.postMessage({ type: 'done' })
  parentPort.close()
})().catch((error) => {
  parentPort.postMessage({
    type: 'error',
    message: error && typeof error.message === 'string' ? error.message : 'DOCX conversion failed',
  })
  parentPort.close()
})
`

const requireFromHere = createRequire(import.meta.url)

function defaultWorkerFactory(input: DocxWorkerFactoryInput): DocxWorker {
  return new Worker(DOCX_WORKER_SOURCE, {
    eval: true,
    workerData: input,
    resourceLimits: DOCX_WORKER_RESOURCE_LIMITS,
    // `--input-type=module` is valid only for the parent's eval/stdin entry and
    // would reinterpret this deliberately CommonJS worker source. Preserve all
    // other execArgv entries, including Yarn PnP loaders.
    execArgv: process.execArgv.filter((arg) => !arg.startsWith('--input-type')),
  })
}

function resolveDocxArchiveModuleReference(): Pick<DocxWorkerFactoryInput, 'modulePath' | 'moduleSpecifier' | 'requireFrom'> {
  // createRequire keeps node-modules and Yarn PnP resolution anchored to this
  // package. Turbopack rewrites a statically traced external `require.resolve`
  // to its numeric module id, which Node workers cannot require directly. Keep
  // the static lookup so output tracing includes the dependency, but fall back
  // to runtime resolution inside the unbundled worker when the value is not an
  // absolute Node path.
  const tracedPath: unknown = requireFromHere.resolve('jszip')
  return {
    modulePath: typeof tracedPath === 'string' && isAbsolute(tracedPath) ? tracedPath : null,
    moduleSpecifier: 'jszip',
    requireFrom: import.meta.url,
  }
}

export function createDocxRenderer(
  options: DocxRendererOptions = {},
  deps: DocxRendererDeps = {},
) {
  const maxConcurrency = options.maxConcurrency ?? DOCX_RENDER_MAX_CONCURRENCY
  const maxQueue = options.maxQueue ?? DOCX_RENDER_MAX_QUEUE
  const acquireTimeoutMs = options.acquireTimeoutMs ?? DOCX_RENDER_ACQUIRE_TIMEOUT_MS
  const renderTimeoutMs = options.renderTimeoutMs ?? DOCX_RENDER_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? DOCX_MAX_OUTPUT_BYTES
  const workerFactory = deps.workerFactory ?? defaultWorkerFactory
  const allocateOutput = deps.allocateOutput ?? ((byteLength: number) => new Uint8Array(byteLength))
  let active = 0
  const waiters: Array<{
    resolve: (release: () => void) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  const grant = (): (() => void) => {
    active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      active -= 1
      const waiter = waiters.shift()
      if (!waiter) return
      clearTimeout(waiter.timer)
      waiter.resolve(grant())
    }
  }

  const acquire = async (): Promise<() => void> => {
    if (active < maxConcurrency) return grant()
    if (waiters.length >= maxQueue) throw new DocxRenderOverloadedError()
    return await new Promise<() => void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(new DocxRenderOverloadedError())
        }, acquireTimeoutMs),
      }
      waiters.push(waiter)
    })
  }

  const runWorker = (html: string): Promise<Uint8Array> => new Promise((resolve, reject) => {
    let worker: DocxWorker
    try {
      const moduleReference = deps.modulePath === undefined
        ? resolveDocxArchiveModuleReference()
        : { modulePath: deps.modulePath, moduleSpecifier: 'jszip', requireFrom: import.meta.url }
      worker = workerFactory({
        html,
        ...moduleReference,
        maxOutputBytes,
        chunkBytes: DOCX_WORKER_CHUNK_BYTES,
      })
    } catch (error) {
      reject(new DocxRenderFailedError({ cause: error }))
      return
    }

    let settled = false
    let output: Uint8Array | null = null
    let expectedBytes: number | null = null
    let receivedBytes = 0
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate().catch(() => undefined).then(() => {
        reject(new DocxRenderTimeoutError())
      })
    }, renderTimeoutMs)

    const terminateAndReject = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate().catch(() => undefined).then(() => reject(error))
    }

    const terminateAndResolve = (value: Uint8Array) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate().catch(() => undefined).then(() => resolve(value))
    }

    worker.on('message', (message) => {
      if (settled || !message || typeof message !== 'object') return
      const record = message as Record<string, unknown>
      if (record.type === 'overflow') {
        terminateAndReject(new DocxRenderOutputTooLargeError())
        return
      }
      if (record.type === 'error') {
        const message = typeof record.message === 'string'
          ? record.message
          : 'DOCX worker reported an unknown conversion failure'
        terminateAndReject(new DocxRenderFailedError({ cause: new Error(message) }))
        return
      }
      if (record.type === 'start') {
        const totalBytes = record.totalBytes
        if (
          expectedBytes !== null
          || typeof totalBytes !== 'number'
          || !Number.isSafeInteger(totalBytes)
          || totalBytes < 0
          || totalBytes > maxOutputBytes
        ) {
          terminateAndReject(new DocxRenderOutputTooLargeError())
          return
        }
        try {
          output = allocateOutput(totalBytes)
          if (output.byteLength !== totalBytes) throw new Error('[internal] invalid DOCX output allocation')
          expectedBytes = totalBytes
        } catch (error) {
          terminateAndReject(new DocxRenderFailedError({ cause: error }))
        }
        return
      }
      if (record.type === 'chunk') {
        const chunk = record.chunk
        if (
          expectedBytes === null
          || !output
          || !(chunk instanceof Uint8Array)
          || receivedBytes + chunk.byteLength > expectedBytes
          || receivedBytes + chunk.byteLength > maxOutputBytes
        ) {
          terminateAndReject(new DocxRenderOutputTooLargeError())
          return
        }
        output.set(chunk, receivedBytes)
        receivedBytes += chunk.byteLength
        return
      }
      if (record.type === 'done') {
        if (expectedBytes === null || !output || receivedBytes !== expectedBytes) {
          terminateAndReject(new DocxRenderFailedError())
          return
        }
        terminateAndResolve(output)
      }
    })
    worker.on('error', (error) => terminateAndReject(new DocxRenderFailedError({ cause: error })))
    worker.on('exit', (code) => {
      if (!settled) terminateAndReject(new DocxRenderFailedError({ cause: new Error(`DOCX worker exited with code ${code}`) }))
    })
  })

  const render = async (html: string): Promise<Uint8Array> => {
    const release = await acquire()
    try {
      return await runWorker(html)
    } finally {
      release()
    }
  }

  return { render }
}

const DOCX_RENDERER_KEY = Symbol.for('open-mercato.documents.docxRenderer')
const globalStore = globalThis as typeof globalThis & {
  [DOCX_RENDERER_KEY]?: ReturnType<typeof createDocxRenderer>
}
const processDocxRenderer = globalStore[DOCX_RENDERER_KEY]
  ?? (globalStore[DOCX_RENDERER_KEY] = createDocxRenderer())

export const renderDocxWithCapacity = processDocxRenderer.render
