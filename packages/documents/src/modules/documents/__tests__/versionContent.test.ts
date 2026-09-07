import * as Y from 'yjs'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { htmlToYDoc } from '../lib/collabMaterializer'
import {
  materializeDocumentVersion,
  materializeDocumentVersionPreview,
  sanitizeDocumentPreviewHtml,
} from '../lib/versionContent'

type JsdomModule = typeof import('jsdom')
type JsdomInstance = InstanceType<JsdomModule['JSDOM']>

jest.mock('happy-dom', () => {
  const { JSDOM } = jest.requireActual<JsdomModule>('jsdom')
  class Window {
    readonly document: Document
    readonly DOMParser: typeof globalThis.DOMParser
    readonly happyDOM = { abort: () => undefined, close: () => undefined }
    private readonly dom: JsdomInstance

    constructor() {
      this.dom = new JSDOM('<!doctype html><html><body></body></html>')
      this.document = this.dom.window.document
      this.DOMParser = this.dom.window.DOMParser
    }
  }
  return { Window }
})

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const ATTACHMENT_ID = '22222222-2222-4222-8222-222222222222'
const INTERNAL_IMAGE = `/api/documents/${DOCUMENT_ID}/attachments/${ATTACHMENT_ID}`

describe('document version materialization and preview safety', () => {
  afterEach(() => jest.restoreAllMocks())

  it('rebuilds legacy zero-length snapshots and derives non-empty text', () => {
    const result = materializeDocumentVersion({
      yjsSnapshot: Buffer.alloc(0),
      contentHtml: '<h1>Historical title</h1><p>Restored body</p>',
    })
    expect(result.yjsState.length).toBeGreaterThan(0)
    expect(result.contentHtml).toContain('Historical title')
    expect(result.contentText).toContain('Restored body')
  })

  it('rejects a corrupt non-empty Yjs snapshot', () => {
    expect(() => materializeDocumentVersion({
      yjsSnapshot: Buffer.from([1, 2, 3, 4]),
      contentHtml: '<p>must not be used as fallback</p>',
    })).toThrow(CrudHttpError)
  })

  it('materializes a valid non-empty snapshot through the shared schema', () => {
    const ydoc = htmlToYDoc('<p>Snapshot body</p>')
    const result = materializeDocumentVersion({
      yjsSnapshot: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
      contentHtml: '<p>stale fallback</p>',
    })
    expect(result.contentHtml).toContain('Snapshot body')
    expect(result.contentText).toBe('Snapshot body')
  })

  it('removes executable markup and all non-document image sources', () => {
    const preview = sanitizeDocumentPreviewHtml([
      '<script>alert(1)</script>',
      '<iframe src="https://evil.example"></iframe>',
      '<p onclick="alert(1)"><a href="javascript:alert(1)">Safe text</a></p>',
      `<img src="${INTERNAL_IMAGE}" alt="kept">`,
      '<img src="//evil.example/a.png">',
      '<img src="https://evil.example/a.png">',
      `/api/documents/${DOCUMENT_ID}/attachments/${ATTACHMENT_ID}`,
    ].join(''), DOCUMENT_ID)

    expect(preview).toContain(INTERNAL_IMAGE)
    expect(preview).not.toContain('script')
    expect(preview).not.toContain('iframe')
    expect(preview).not.toContain('onclick')
    expect(preview).not.toContain('javascript:')
    expect(preview).not.toContain('evil.example')
  })

  it('sanitizes legacy HTML before normalizing it for version preview', () => {
    const preview = materializeDocumentVersionPreview({
      documentId: DOCUMENT_ID,
      yjsSnapshot: Buffer.alloc(0),
      contentHtml: '<p>Legacy</p><img src="https://evil.example/pixel.png">',
    })
    expect(preview).toContain('Legacy')
    expect(preview).not.toContain('evil.example')
  })

  it('normalizes legacy entity refs before generic sanitization can expose UUID text', () => {
    const preview = materializeDocumentVersionPreview({
      documentId: DOCUMENT_ID,
      yjsSnapshot: Buffer.alloc(0),
      entityRefFallbackLabel: 'Restricted record',
      contentHtml: `<p><span data-entity-ref data-entity-type="product" data-entity-id="${ATTACHMENT_ID}" data-label="Customer ${ATTACHMENT_ID}" data-href="/backend/catalog/products/${ATTACHMENT_ID}">${ATTACHMENT_ID}</span></p>`,
    })

    expect(preview).toContain('Restricted record')
    expect(preview).not.toContain(ATTACHMENT_ID)
  })

  it('localizes the neutral label for an unsafe entity ref in a Yjs snapshot', () => {
    const ydoc = htmlToYDoc(`<p><span data-entity-ref data-entity-type="product" data-entity-id="${ATTACHMENT_ID}" data-label="Product ${ATTACHMENT_ID}" data-href="/backend/catalog/products/${ATTACHMENT_ID}">${ATTACHMENT_ID}</span></p>`)
    const preview = materializeDocumentVersionPreview({
      documentId: DOCUMENT_ID,
      yjsSnapshot: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
      contentHtml: null,
      entityRefFallbackLabel: 'Restricted record',
    })

    expect(preview).toContain('Restricted record')
    expect(preview).not.toContain(ATTACHMENT_ID)
  })

  it('treats malformed document ids as data and never as regular expressions', () => {
    const preview = sanitizeDocumentPreviewHtml(
      `<p>Safe</p><img src="${INTERNAL_IMAGE}">`,
      '.*',
    )
    expect(preview).toContain('Safe')
    expect(preview).not.toContain('<img')
  })
})
