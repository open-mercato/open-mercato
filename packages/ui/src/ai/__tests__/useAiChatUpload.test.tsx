/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render } from '@testing-library/react'
import { useAiChatUpload, type UseAiChatUploadState } from '../useAiChatUpload'

function jsonResponse(status: number, body: unknown): Response {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(payload, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeFile(name: string, content = 'hello', type = 'text/plain'): File {
  return new File([content], name, { type })
}

interface HarnessProps {
  fetchImpl: typeof fetch
  signal?: AbortSignal
  onState?: (state: UseAiChatUploadState) => void
}

function HookHarness({ fetchImpl, signal, onState }: HarnessProps) {
  const state = useAiChatUpload({ fetchImpl, signal })
  React.useEffect(() => {
    onState?.(state)
  })
  return null
}

describe('useAiChatUpload', () => {
  it('toggles busy and writes per-file done status on success', async () => {
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      const file = form.get('file') as File
      return jsonResponse(200, {
        ok: true,
        item: {
          id: `att_${file.name}`,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'text/plain',
        },
      })
    }) as unknown as typeof fetch

    const snapshots: UseAiChatUploadState[] = []
    render(<HookHarness fetchImpl={fetchImpl} onState={(s) => snapshots.push(s)} />)
    const latest = () => snapshots[snapshots.length - 1]

    await act(async () => {
      await latest().upload([makeFile('a.txt'), makeFile('b.txt')])
    })

    const final = latest()
    expect(final.busy).toBe(false)
    expect(final.files).toHaveLength(2)
    expect(final.files.every((entry) => entry.status === 'done')).toBe(true)
    expect(final.files.map((entry) => entry.attachmentId)).toEqual(['att_a.txt', 'att_b.txt'])
    expect(final.overallProgress).toBe(1)
  })

  it('averages overallProgress across files', async () => {
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      const file = form.get('file') as File
      if (file.name === 'fail.txt') {
        return jsonResponse(413, { error: 'Attachment exceeds the maximum upload size.' })
      }
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

    const snapshots: UseAiChatUploadState[] = []
    render(<HookHarness fetchImpl={fetchImpl} onState={(s) => snapshots.push(s)} />)
    const latest = () => snapshots[snapshots.length - 1]

    await act(async () => {
      await latest().upload([makeFile('ok.txt'), makeFile('fail.txt')])
    })

    const final = latest()
    // One done at 1.0, one error at 0.0 → average 0.5.
    expect(final.overallProgress).toBeCloseTo(0.5, 5)
    expect(final.files[0].status).toBe('done')
    expect(final.files[1].status).toBe('error')
    expect(final.files[1].reason).toBe('size_exceeded')
  })

  it('reset() clears state', async () => {
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
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

    const snapshots: UseAiChatUploadState[] = []
    render(<HookHarness fetchImpl={fetchImpl} onState={(s) => snapshots.push(s)} />)
    const latest = () => snapshots[snapshots.length - 1]

    await act(async () => {
      await latest().upload([makeFile('a.txt')])
    })
    expect(latest().files).toHaveLength(1)

    act(() => {
      latest().reset()
    })

    const final = latest()
    expect(final.files).toEqual([])
    expect(final.busy).toBe(false)
    expect(final.overallProgress).toBe(0)
  })

  it('propagates AbortSignal into per-file aborted status', async () => {
    const controller = new AbortController()
    const fetchImpl = jest.fn(async () => {
      controller.abort()
      const error = new Error('aborted') as Error & { name: string }
      error.name = 'AbortError'
      throw error
    }) as unknown as typeof fetch

    const snapshots: UseAiChatUploadState[] = []
    render(
      <HookHarness
        fetchImpl={fetchImpl}
        signal={controller.signal}
        onState={(s) => snapshots.push(s)}
      />,
    )
    const latest = () => snapshots[snapshots.length - 1]

    await act(async () => {
      await latest().upload([makeFile('a.txt'), makeFile('b.txt')])
    })

    const final = latest()
    expect(final.busy).toBe(false)
    expect(final.files.every((entry) => entry.status === 'error')).toBe(true)
    expect(final.files.every((entry) => entry.reason === 'aborted')).toBe(true)
  })
})
