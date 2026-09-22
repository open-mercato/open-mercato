import { TiptapTransformer } from '@hocuspocus/transformer'
import * as Y from 'yjs'
import {
  htmlToYDoc,
  materializeDocumentContentReplacement,
  materializeDocumentHtml,
  yDocToContent,
} from '../lib/collabMaterializer'
import { COLLAB_FRAGMENT_FIELD, getDocumentEditorExtensions } from '../lib/editorConfig'

type JsdomModule = typeof import('jsdom')
type JsdomInstance = InstanceType<JsdomModule['JSDOM']>

jest.mock('happy-dom', () => {
  const { JSDOM } = jest.requireActual<JsdomModule>('jsdom')
  class Window {
    readonly document: Document
    readonly DOMParser: typeof globalThis.DOMParser
    readonly happyDOM = {
      abort: () => undefined,
      close: () => undefined,
    }

    private readonly dom: JsdomInstance

    constructor() {
      this.dom = new JSDOM('<!doctype html><html><body></body></html>')
      this.document = this.dom.window.document
      this.DOMParser = this.dom.window.DOMParser
    }
  }

  return { Window }
})

const ENTITY_ID = '00000000-0000-0000-0000-000000000001'

describe('documents collab materializer round-trip', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('preserves entity refs and formatting through htmlToYDoc and yDocToContent', () => {
    const html = `<p style="text-align: center">Hello <span data-entity-ref data-entity-type="deal" data-entity-id="${ENTITY_ID}" data-label="Acme deal" data-href="/backend/customers/deals/${ENTITY_ID}" class="om-entity-ref">Acme deal</span> <mark>hi</mark></p>`

    const ydoc = htmlToYDoc(html)
    const content = yDocToContent(ydoc)

    expect(content).not.toBeNull()
    if (!content) throw new Error('[internal] materializer should return content')
    expect(content.html).toContain('data-entity-ref')
    expect(content.html).toContain(`data-entity-id="${ENTITY_ID}"`)
    expect(content.html).toContain('Acme deal')
    expect(content.html).toContain('text-align: center')
    expect(content.html).toContain('<mark')
  })

  it('returns null when Yjs materialization fails', () => {
    const ydoc = htmlToYDoc('<p>Broken</p>')
    jest.spyOn(TiptapTransformer, 'fromYdoc').mockImplementation(() => {
      throw new Error('[internal] forced materializer failure')
    })

    expect(yDocToContent(ydoc)).toBeNull()
  })

  it('returns the canonical editor HTML alongside the exact Yjs state to persist', () => {
    const authored = `<p><span data-entity-ref data-entity-type="product" data-entity-id="${ENTITY_ID}" data-label="Desk" data-href="/backend/catalog/products/${ENTITY_ID}" class="om-entity-ref">Desk</span></p>`

    const content = materializeDocumentHtml(authored)

    expect(content).not.toBeNull()
    expect(content?.yjsState.length).toBeGreaterThan(0)
    expect(content?.html).toContain('data-entity-ref=""')
    expect(content?.html).toContain('role="link"')
    expect(content?.html).toContain('aria-label="Desk"')
    expect(content?.text).toBe('Desk')
  })

  it('replaces stale REST content without duplicating it when a retained client merges the new state', () => {
    const original = materializeDocumentHtml('<p>Original REST body</p>')
    expect(original).not.toBeNull()
    if (!original) throw new Error('[internal] original content should materialize')
    const replacement = materializeDocumentContentReplacement(
      original.yjsState,
      '<p>Replacement REST body</p>',
    )
    expect(replacement).not.toBeNull()
    if (!replacement) throw new Error('[internal] replacement content should materialize')

    const originalDocument = new Y.Doc()
    const replacementDocument = new Y.Doc()
    Y.applyUpdate(originalDocument, new Uint8Array(original.yjsState))
    Y.applyUpdate(replacementDocument, new Uint8Array(replacement.yjsState))
    const retainedClient = new Y.Doc()
    Y.applyUpdate(retainedClient, new Uint8Array(original.yjsState))
    Y.applyUpdate(retainedClient, new Uint8Array(replacement.yjsState))

    expect(yDocToContent(retainedClient)?.text).toBe('Replacement REST body')
  })

  it('canonicalizes executable REST markup before it can be persisted or exported', () => {
    const replacement = materializeDocumentContentReplacement(
      null,
      '<meta http-equiv="refresh" content="0;url=https://attacker.example">'
        + '<iframe src="https://attacker.example/frame"></iframe>'
        + '<p onclick="alert(1)">Canonical body<img src="https://attacker.example/pixel" onerror="alert(2)"></p>'
        + '<script>location="https://attacker.example/script"</script>',
    )

    expect(replacement).not.toBeNull()
    expect(replacement?.html).not.toMatch(/<(?:script|iframe|meta)\b/i)
    expect(replacement?.html).not.toMatch(/\bon(?:click|error)\s*=/i)
    expect(replacement?.text).toContain('Canonical body')
  })

  it('removes UUID-shaped entity-chip labels from REST and crafted Yjs previews', () => {
    const authored = `<p><span data-entity-ref data-entity-type="product" data-entity-id="${ENTITY_ID}" data-label="${ENTITY_ID}" data-href="/backend/catalog/products/${ENTITY_ID}">${ENTITY_ID}</span></p>`
    const rest = materializeDocumentHtml(authored)

    expect(rest).not.toBeNull()
    expect(rest?.text).toBe('')
    expect(rest?.html).not.toContain('aria-label=')
    expect(rest?.html).not.toContain('data-label=')
    expect(rest?.html).toContain('data-entity-label-invalid')
    expect(rest?.html).not.toContain('>Record<')

    const ydoc = TiptapTransformer.toYdoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'entityRef',
          attrs: {
            entityType: 'product',
            entityId: ENTITY_ID,
            label: `Product ${ENTITY_ID}`,
            href: `/backend/catalog/products/${ENTITY_ID}`,
          },
        }],
      }],
    }, COLLAB_FRAGMENT_FIELD, getDocumentEditorExtensions())
    const preview = yDocToContent(ydoc)

    expect(preview).not.toBeNull()
    expect(preview?.text).toBe('')
    expect(preview?.text).not.toContain(ENTITY_ID)
    expect(preview?.html).not.toContain('aria-label=')
    expect(preview?.html).not.toContain('data-label=')
    expect(preview?.html).toContain('data-entity-label-invalid')
    expect(preview?.html).not.toContain('>Record<')
  })
})
