import { TiptapTransformer } from '@hocuspocus/transformer'
import { htmlToYDoc, yDocToContent } from '../lib/collabMaterializer'

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
})
