import { CrudHttpError, isCrudHttpError } from '../errors'

describe('CrudHttpError', () => {
  it('builds from string body', () => {
    const err = new CrudHttpError(400, 'Bad thing')
    expect(err.status).toBe(400)
    expect(err.body).toEqual({ error: 'Bad thing' })
    expect(err.message).toBe('Bad thing')
    expect(isCrudHttpError(err)).toBe(true)
  })

  it('builds from object body', () => {
    const err = new CrudHttpError(422, { error: 'nope', field: 'x' })
    expect(err.body).toEqual({ error: 'nope', field: 'x' })
    expect(err.message).toBe('nope')
  })

  it('forwards cause to Error constructor', () => {
    const upstream = new Error('upstream boom')
    const err = new CrudHttpError(502, { error: 'Upstream API error' }, { cause: upstream })
    expect(err.cause).toBe(upstream)
    expect(err.status).toBe(502)
    expect(err.body).toEqual({ error: 'Upstream API error' })
  })

  it('accepts cause with string body', () => {
    const upstream = new Error('root')
    const err = new CrudHttpError(500, 'Failed', { cause: upstream })
    expect(err.cause).toBe(upstream)
  })

  it('cause defaults to undefined when options omitted', () => {
    const err = new CrudHttpError(400, 'x')
    expect(err.cause).toBeUndefined()
  })
})
