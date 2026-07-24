import { serializeError } from '../facade/serialize'

describe('serializeError (PII-safe)', () => {
  it('keeps name, message, and stack for an Error', () => {
    const err = new TypeError('bad thing')
    const out = serializeError(err)
    expect(out.name).toBe('TypeError')
    expect(out.message).toBe('bad thing')
    expect(out.stack).toContain('bad thing')
  })

  it('folds the cause chain into the message (names/messages only)', () => {
    const root = new Error('db down')
    const wrapped = new Error('save failed', { cause: root })
    const out = serializeError(wrapped)
    expect(out.message).toBe('save failed — caused by Error: db down')
  })

  it('does not leak arbitrary error properties (e.g. request bodies)', () => {
    const err = Object.assign(new Error('boom'), { requestBody: { secret: 'SECRET' } })
    const out = serializeError(err)
    expect(JSON.stringify(out)).not.toContain('SECRET')
    expect(out).not.toHaveProperty('requestBody')
  })

  it('handles circular causes without infinite recursion', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    const b = new Error('b', { cause: a })
    a.cause = b
    expect(() => serializeError(b)).not.toThrow()
  })

  it('handles non-Error values', () => {
    expect(serializeError('plain string')).toMatchObject({ name: 'NonError', message: 'plain string' })
    expect(serializeError({ password: 'SECRET', body: { email: 'person@example.com' } })).toEqual({
      name: 'NonError',
      message: '[non-error object]',
    })
  })

  it('redacts a leaked email from message and stack (Privacy backstop)', () => {
    const err = new Error('no account for jan.kowalski@example.com')
    const out = serializeError(err)
    expect(out.message).toBe('no account for [redacted-email]')
    expect(out.stack).not.toContain('jan.kowalski@example.com')
  })
})
