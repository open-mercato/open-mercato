import { CommandInterceptorError } from '../errors'

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
})
