import { CommandInterceptorError, isCommandInterceptorError } from '../errors'

describe('CommandInterceptorError', () => {
  it('has the correct name', () => {
    const error = new CommandInterceptorError('test message')
    expect(error.name).toBe('CommandInterceptorError')
  })

  it('has the correct message', () => {
    const error = new CommandInterceptorError('Blocked by audit interceptor')
    expect(error.message).toBe('Blocked by audit interceptor')
  })

  it('is an instance of Error', () => {
    const error = new CommandInterceptorError('test')
    expect(error).toBeInstanceOf(Error)
  })

  it('carries no transport information when constructed with a message alone', () => {
    const error = new CommandInterceptorError('test')
    expect(error.status).toBeUndefined()
    expect(error.body).toBeUndefined()
  })

  it('carries the status and derives the body from the message', () => {
    const error = new CommandInterceptorError('Missing required fields: VAT id', { status: 422 })
    expect(error.status).toBe(422)
    expect(error.body).toEqual({ error: 'Missing required fields: VAT id' })
  })

  it('keeps an explicit body verbatim', () => {
    const body = { error: 'Blocked', missingFields: ['vatId'] }
    const error = new CommandInterceptorError('Blocked', { status: 422, body })
    expect(error.body).toEqual(body)
  })

  it('ignores a body supplied without a status, so status and body move together', () => {
    const error = new CommandInterceptorError('Blocked', { body: { error: 'Blocked' } })
    expect(error.status).toBeUndefined()
    expect(error.body).toBeUndefined()
  })

  it('preserves the cause when one is supplied', () => {
    const cause = new Error('underlying')
    const error = new CommandInterceptorError('Blocked', { cause })
    expect(error.cause).toBe(cause)
  })

  it('is detected by isCommandInterceptorError across module boundaries', () => {
    expect(isCommandInterceptorError(new CommandInterceptorError('test'))).toBe(true)
    // A structurally identical error from a duplicated bundle carries the same registered symbol.
    const duplicated = Object.assign(new Error('test'), {
      [Symbol.for('@open-mercato/CommandInterceptorError')]: true,
    })
    expect(isCommandInterceptorError(duplicated)).toBe(true)
  })

  it('does not treat unrelated values as interceptor errors', () => {
    expect(isCommandInterceptorError(new Error('plain'))).toBe(false)
    expect(isCommandInterceptorError(null)).toBe(false)
    expect(isCommandInterceptorError('CommandInterceptorError')).toBe(false)
  })
})
