import { relativePositionToAbsolutePosition } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import type { EntityManager } from '@mikro-orm/postgresql'
import { htmlToYDoc, materializeDocumentContentReplacement } from '../lib/collabMaterializer'
import { createFindingAnchorer } from '../lib/findingAnchors'
import { reanchorOpenFindings } from '../lib/findingReanchoring'
import { parseReviewDocument } from '../lib/reviewContent'

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

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333'

const CONTRACT_HTML = [
  '<h1>Mutual Non-Disclosure Agreement</h1>',
  '<h2>2. Obligations</h2>',
  '<p>The Recipient shall keep all information secret for five years.</p>',
  '<h2>3. Governing Law</h2>',
  '<p>This agreement follows the laws of the disclosing party.</p>',
].join('')

const WITHOUT_LAW_HTML = [
  '<h1>Mutual Non-Disclosure Agreement</h1>',
  '<h2>2. Obligations</h2>',
  '<p>The Recipient shall keep all information secret for five years.</p>',
].join('')

type StoredAnchor = { version: 2; relativeFrom: string; relativeTo: string }

type FindingRow = {
  id: string
  quote: string
  occurrence: number
  sectionLabel: string | null
  anchor: StoredAnchor | null
  anchorStatus: 'located' | 'unlocated'
  updatedAt: Date
}

function encodeState(html: string): Buffer {
  const ydoc = htmlToYDoc(html)
  const state = Buffer.from(Y.encodeStateAsUpdate(ydoc))
  ydoc.destroy()
  return state
}

function anchorIn(state: Buffer, quote: string, sectionLabel: string | null): StoredAnchor {
  const anchorer = createFindingAnchorer(state)
  try {
    const located = anchorer.locate({ quote, sectionLabel })
    if (located.anchorStatus !== 'located') throw new Error('[internal] expected a located quote')
    return located.anchor
  } finally {
    anchorer.dispose()
  }
}

function resolveText(state: Buffer, anchor: StoredAnchor): string | null {
  const parsed = parseReviewDocument(state)
  if (!parsed) throw new Error('[internal] expected parsed document')
  try {
    const decode = (encoded: string) => relativePositionToAbsolutePosition(
      parsed.ydoc,
      parsed.fragment,
      Y.decodeRelativePosition(Buffer.from(encoded, 'base64')),
      parsed.mapping,
    )
    const from = decode(anchor.relativeFrom)
    const to = decode(anchor.relativeTo)
    if (from === null || to === null || from >= to) return null
    return parsed.doc.textBetween(from, to, ' ')
  } finally {
    parsed.ydoc.destroy()
  }
}

function findingRow(id: string, quote: string, sectionLabel: string | null, state: Buffer): FindingRow {
  return {
    id,
    quote,
    occurrence: 1,
    sectionLabel,
    anchor: anchorIn(state, quote, sectionLabel),
    anchorStatus: 'located',
    updatedAt: new Date('2026-11-12T08:43:14.509Z'),
  }
}

function createEm() {
  const nativeUpdate = jest.fn(async () => 1)
  return { em: { nativeUpdate } as unknown as EntityManager, nativeUpdate }
}

describe('reanchorOpenFindings', () => {
  beforeEach(() => {
    mockFindWithDecryption.mockReset()
  })

  it('re-anchors open findings after the state is rebuilt from the same HTML', async () => {
    const original = encodeState(CONTRACT_HTML)
    const term = findingRow('44444444-4444-4444-8444-444444444441', 'secret for five years', '2. Obligations', original)
    const law = findingRow('44444444-4444-4444-8444-444444444442', 'laws of the disclosing party', '3. Governing Law', original)
    const replacement = materializeDocumentContentReplacement(original, CONTRACT_HTML)
    if (!replacement) throw new Error('[internal] replacement failed')
    expect(resolveText(replacement.yjsState, term.anchor!)).toBeNull()

    mockFindWithDecryption.mockResolvedValue([term, law])
    const { em, nativeUpdate } = createEm()
    const result = await reanchorOpenFindings(em, DOCUMENT_ID, SCOPE, replacement.yjsState)

    expect(result).toEqual({ checked: 2, changed: 2, located: 2, unlocated: 0 })
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      expect.anything(),
      expect.objectContaining({ documentId: DOCUMENT_ID, ...SCOPE, status: 'open', deletedAt: null }),
      expect.anything(),
      SCOPE,
    )
    expect(nativeUpdate).toHaveBeenCalledTimes(2)
    const updates = nativeUpdate.mock.calls as unknown as Array<[unknown, Record<string, unknown>, Record<string, unknown>]>
    for (const [, where, data] of updates) {
      expect(where).toMatchObject({ documentId: DOCUMENT_ID, ...SCOPE, status: 'open', deletedAt: null })
      expect(data).not.toHaveProperty('updatedAt')
      expect(data.anchorStatus).toBe('located')
    }
    const termUpdate = updates.find(([, where]) => where.id === term.id)
    expect(resolveText(replacement.yjsState, termUpdate![2].anchor as StoredAnchor)).toBe('secret for five years')
    const lawUpdate = updates.find(([, where]) => where.id === law.id)
    expect(resolveText(replacement.yjsState, lawUpdate![2].anchor as StoredAnchor)).toBe('laws of the disclosing party')
  })

  it('marks a finding unlocated when its passage was removed', async () => {
    const original = encodeState(CONTRACT_HTML)
    const law = findingRow('44444444-4444-4444-8444-444444444442', 'laws of the disclosing party', '3. Governing Law', original)
    const replacement = materializeDocumentContentReplacement(original, WITHOUT_LAW_HTML)
    if (!replacement) throw new Error('[internal] replacement failed')

    mockFindWithDecryption.mockResolvedValue([law])
    const { em, nativeUpdate } = createEm()
    const result = await reanchorOpenFindings(em, DOCUMENT_ID, SCOPE, replacement.yjsState)

    expect(result).toEqual({ checked: 1, changed: 1, located: 0, unlocated: 1 })
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: law.id }),
      { anchor: null, anchorStatus: 'unlocated' },
    )
  })

  it('leaves findings whose anchor is unchanged untouched', async () => {
    const original = encodeState(CONTRACT_HTML)
    const term = findingRow('44444444-4444-4444-8444-444444444441', 'secret for five years', '2. Obligations', original)
    mockFindWithDecryption.mockResolvedValue([term])
    const { em, nativeUpdate } = createEm()

    const result = await reanchorOpenFindings(em, DOCUMENT_ID, SCOPE, original)

    expect(result).toEqual({ checked: 1, changed: 0, located: 1, unlocated: 0 })
    expect(nativeUpdate).not.toHaveBeenCalled()
  })

  it('locates previously unlocated findings once a state exists', async () => {
    const state = encodeState(CONTRACT_HTML)
    const pending: FindingRow = {
      ...findingRow('44444444-4444-4444-8444-444444444441', 'secret for five years', '2. Obligations', state),
      anchor: null,
      anchorStatus: 'unlocated',
    }
    mockFindWithDecryption.mockResolvedValue([pending])
    const { em, nativeUpdate } = createEm()

    const result = await reanchorOpenFindings(em, DOCUMENT_ID, SCOPE, state)

    expect(result).toMatchObject({ changed: 1, located: 1 })
    const [[, , data]] = nativeUpdate.mock.calls as unknown as Array<[unknown, unknown, Record<string, unknown>]>
    expect(resolveText(state, data.anchor as StoredAnchor)).toBe('secret for five years')
  })

  it('does nothing when the document has no open findings', async () => {
    mockFindWithDecryption.mockResolvedValue([])
    const { em, nativeUpdate } = createEm()
    await expect(reanchorOpenFindings(em, DOCUMENT_ID, SCOPE, encodeState(CONTRACT_HTML)))
      .resolves.toEqual({ checked: 0, changed: 0, located: 0, unlocated: 0 })
    expect(nativeUpdate).not.toHaveBeenCalled()
  })
})
