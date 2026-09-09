import { runSpan } from '../provider/run-span'
import type { Span } from '../types'

function fakeSpan() {
  const calls = { exceptions: [] as unknown[], status: '' as string, ended: 0 }
  const span: Span = {
    setAttribute() {},
    setAttributes() {},
    recordException: (e) => calls.exceptions.push(e),
    setStatus: (s) => {
      calls.status = s
    },
    end: () => {
      calls.ended += 1
    },
  }
  return { span, calls }
}

describe('runSpan (sync + async lifecycle)', () => {
  it('ends the span and returns the value for a sync function', () => {
    const { span, calls } = fakeSpan()
    expect(runSpan(span, () => 5)).toBe(5)
    expect(calls.ended).toBe(1)
    expect(calls.status).toBe('')
  })

  it('records the exception, ends, and rethrows on a sync throw', () => {
    const { span, calls } = fakeSpan()
    const err = new Error('sync')
    expect(() => runSpan(span, () => { throw err })).toThrow('sync')
    expect(calls.exceptions).toEqual([err])
    expect(calls.status).toBe('error')
    expect(calls.ended).toBe(1)
  })

  it('ends the span only after an async function resolves', async () => {
    const { span, calls } = fakeSpan()
    const p = runSpan(span, async () => {
      expect(calls.ended).toBe(0)
      return 'ok'
    })
    expect(calls.ended).toBe(0) // not ended synchronously
    await expect(p).resolves.toBe('ok')
    expect(calls.ended).toBe(1)
  })

  it('records the exception, ends, and rejects on an async rejection', async () => {
    const { span, calls } = fakeSpan()
    const err = new Error('async')
    await expect(runSpan(span, async () => { throw err })).rejects.toThrow('async')
    expect(calls.exceptions).toEqual([err])
    expect(calls.status).toBe('error')
    expect(calls.ended).toBe(1)
  })
})
