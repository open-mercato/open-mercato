/** @jest-environment node */

import { NextResponse } from 'next/server'
import {
  parseUploadBody,
  SANDBOXED_DOWNLOAD_HEADERS,
} from '../api/attachment-helpers'

describe('Forms attachment HTTP guards', () => {
  it('rejects a declared oversized multipart body before reading it', async () => {
    const request = new Request('http://test/api/forms/public/submissions/sub-1/attachments', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=test',
        'content-length': String(64 * 1024 + 11),
      },
      body: '--test--',
    })
    const readerSpy = jest.spyOn(request.body!, 'getReader')

    const response = await parseUploadBody(request, 10)

    expect(response).toBeInstanceOf(NextResponse)
    expect((response as NextResponse).status).toBe(413)
    expect(readerSpy).not.toHaveBeenCalled()
  })

  it('enforces the file ceiling before materializing the File array buffer', async () => {
    const form = new FormData()
    form.set('field_key', 'document')
    form.set('file', new File([Buffer.alloc(11)], 'document.bin', { type: 'application/octet-stream' }))
    const request = new Request('http://test/api/forms/public/submissions/sub-1/attachments', {
      method: 'POST',
      body: form,
    })

    const response = await parseUploadBody(request, 10)

    expect(response).toBeInstanceOf(NextResponse)
    expect((response as NextResponse).status).toBe(413)
  })

  it('defines the sandbox and nosniff download policy', () => {
    expect(SANDBOXED_DOWNLOAD_HEADERS).toEqual({
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    })
  })
})
