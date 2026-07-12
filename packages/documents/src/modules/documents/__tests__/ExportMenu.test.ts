/** @jest-environment jsdom */

import { buildDocxPaginationSnapshot, downloadDocumentExport } from '../backend/documents/[id]/ExportMenu'
import type { Editor } from '@tiptap/core'

describe('document export download', () => {
  const originalFetch = global.fetch
  const originalCreateObjectUrl = URL.createObjectURL
  const originalRevokeObjectUrl = URL.revokeObjectURL

  afterEach(() => {
    global.fetch = originalFetch
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
    jest.restoreAllMocks()
  })

  it('captures presentation page breaks without collaboration decorations', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Before</p><div data-document-page-break><span>gutter</span></div><span class="collaboration-carets__caret">Alice</span><p>After</p>'
    const editor = { isDestroyed: false, view: { dom: root } } as unknown as Editor

    const snapshot = buildDocxPaginationSnapshot(editor)

    expect(snapshot?.contentHtml).toContain(`<p>${snapshot?.pageBreakMarker}</p>`)
    expect(snapshot?.contentHtml).not.toContain('gutter')
    expect(snapshot?.contentHtml).not.toContain('Alice')
  })

  it('downloads a verified DOCX response with the server filename', async () => {
    const blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])])
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': 'attachment; filename="Quarterly plan.docx"',
      }),
      blob: async () => blob,
    })) as typeof fetch
    URL.createObjectURL = jest.fn(() => 'blob:document-export')
    URL.revokeObjectURL = jest.fn()
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await downloadDocumentExport('doc/id', 'docx')

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/documents/doc%2Fid/export?format=docx',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(click).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:document-export')
  })

  it('surfaces a JSON export failure instead of downloading it', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: 'The export service is temporarily unavailable.' }),
    })) as typeof fetch
    URL.createObjectURL = jest.fn(() => 'blob:should-not-exist')
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await expect(downloadDocumentExport('document-id', 'docx')).rejects.toThrow(
      'The export service is temporarily unavailable.',
    )
    expect(click).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
