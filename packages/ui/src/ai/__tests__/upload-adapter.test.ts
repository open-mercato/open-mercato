/**
 * @jest-environment jsdom
 */

import {
  uploadAttachmentsForChat,
  type UploadAttachmentsForChatOptions,
} from '../upload-adapter'

function makeFile(name: string, content = 'hello', type = 'text/plain'): File {
  return new File([content], name, { type })
}

function jsonResponse(status: number, body: unknown): Response {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(payload, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('uploadAttachmentsForChat', () => {
  it('returns empty result for empty file list without calling fetch', async () => {
    const fetchImpl = jest.fn()
    const result = await uploadAttachmentsForChat([], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.items).toEqual([])
    expect(result.failed).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uploads multiple files, preserves order, and uses defaults', async () => {
    let counter = 0
    const seenUrls: string[] = []
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      seenUrls.push(String(input))
      const id = `att_${counter++}`
      return jsonResponse(200, {
        ok: true,
        item: { id, fileName: `f-${counter}.txt`, fileSize: 5, mimeType: 'text/plain' },
      })
    }) as unknown as typeof fetch

    const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')]
    const result = await uploadAttachmentsForChat(files, {
      fetchImpl,
    })

    expect(seenUrls).toHaveLength(3)
    expect(seenUrls.every((u) => u === '/api/attachments')).toBe(true)
    expect(result.items).toHaveLength(3)
    expect(result.failed).toEqual([])
    // Items preserve input order via index-aware parsing.
    expect(result.items.map((item) => item.attachmentId)).toEqual(['att_0', 'att_1', 'att_2'])
  })

  it('captures server rejections in failed[] with a normalized reason', async () => {
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      const file = form.get('file') as File
      if (file.name === 'big.bin') {
        return jsonResponse(413, { error: 'Attachment exceeds the maximum upload size.' })
      }
      if (file.name === 'bad.exe') {
        return jsonResponse(400, { error: 'File type not allowed' })
      }
      return jsonResponse(200, {
        ok: true,
        item: { id: 'att_ok', fileName: file.name, fileSize: file.size, mimeType: file.type },
      })
    }) as unknown as typeof fetch

    const files = [makeFile('ok.txt'), makeFile('big.bin'), makeFile('bad.exe')]
    const result = await uploadAttachmentsForChat(files, { fetchImpl })

    expect(result.items.map((item) => item.fileName)).toEqual(['ok.txt'])
    expect(result.failed).toEqual([
      expect.objectContaining({ fileName: 'big.bin', reason: 'size_exceeded' }),
      expect.objectContaining({ fileName: 'bad.exe', reason: 'mime_rejected' }),
    ])
  })

  it('maps network errors to reason=network', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('socket closed')
    }) as unknown as typeof fetch

    const result = await uploadAttachmentsForChat([makeFile('a.txt')], { fetchImpl })
    expect(result.items).toEqual([])
    expect(result.failed).toEqual([
      expect.objectContaining({ fileName: 'a.txt', reason: 'network' }),
    ])
  })

  it('honours AbortSignal by flagging remaining files as aborted', async () => {
    const controller = new AbortController()
    let started = 0
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      started += 1
      if (started === 1) {
        controller.abort()
        const error = new Error('aborted') as Error & { name: string }
        error.name = 'AbortError'
        throw error
      }
      // Should not reach here for the remaining files.
      return jsonResponse(200, {
        ok: true,
        item: {
          id: 'att',
          fileName: 'ignored',
          fileSize: 1,
          mimeType: 'text/plain',
        },
      })
    }) as unknown as typeof fetch

    const files = [makeFile('first.txt'), makeFile('second.txt'), makeFile('third.txt')]
    const result = await uploadAttachmentsForChat(files, {
      fetchImpl,
      signal: controller.signal,
      concurrency: 1,
    })

    expect(result.items).toEqual([])
    expect(result.failed.every((failure) => failure.reason === 'aborted')).toBe(true)
    expect(result.failed.map((failure) => failure.fileName)).toEqual(
      expect.arrayContaining(['first.txt', 'second.txt', 'third.txt']),
    )
  })

  it('caps in-flight uploads at concurrency (default 3)', async () => {
    let inFlight = 0
    let peak = 0
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      inFlight += 1
      if (inFlight > peak) peak = inFlight
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      const form = init?.body as FormData
      const file = form.get('file') as File
      return jsonResponse(200, {
        ok: true,
        item: {
          id: `att_${file.name}`,
          fileName: file.name,
          fileSize: file.size,
          mimeType: 'text/plain',
        },
      })
    }) as unknown as typeof fetch

    const files = Array.from({ length: 8 }, (_, index) => makeFile(`f-${index}.txt`))
    const result = await uploadAttachmentsForChat(files, { fetchImpl })

    expect(result.items).toHaveLength(8)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('forwards entityType, recordId, and partitionCode to the multipart payload', async () => {
    const captured: FormData[] = []
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(init?.body as FormData)
      return jsonResponse(200, {
        ok: true,
        item: {
          id: 'att_fwd',
          fileName: 'x.txt',
          fileSize: 5,
          mimeType: 'text/plain',
        },
      })
    }) as unknown as typeof fetch

    const options: UploadAttachmentsForChatOptions = {
      fetchImpl,
      entityType: 'ai-chat-draft',
      recordId: 'chat-abc-123',
      partitionCode: 'attachments',
    }

    await uploadAttachmentsForChat([makeFile('x.txt')], options)
    const form = captured[0]
    expect(form.get('entityId')).toBe('ai-chat-draft')
    expect(form.get('recordId')).toBe('chat-abc-123')
    expect(form.get('partitionCode')).toBe('attachments')
  })

  it('falls back to a generated recordId when none is supplied and shares it across the batch', async () => {
    const seenRecordIds = new Set<string>()
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      seenRecordIds.add(String(form.get('recordId')))
      const file = form.get('file') as File
      return jsonResponse(200, {
        ok: true,
        item: {
          id: `att_${file.name}`,
          fileName: file.name,
          fileSize: file.size,
          mimeType: 'text/plain',
        },
      })
    }) as unknown as typeof fetch

    await uploadAttachmentsForChat([makeFile('a.txt'), makeFile('b.txt')], { fetchImpl })
    expect(seenRecordIds.size).toBe(1)
    const onlyId = [...seenRecordIds][0]
    expect(typeof onlyId).toBe('string')
    expect((onlyId as string).length).toBeGreaterThan(0)
  })
})
