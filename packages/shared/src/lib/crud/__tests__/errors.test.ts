import { CrudHttpError, isCrudHttpError, assertFound, notFound } from '../errors'

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

describe('notFound', () => {
  it('builds the standardized 404 body', () => {
    const err = notFound('Deal not found')
    expect(err.status).toBe(404)
    expect(err.body).toEqual({ error: 'Deal not found' })
    expect(isCrudHttpError(err)).toBe(true)
  })

  it('falls back to a generic message', () => {
    expect(notFound().body).toEqual({ error: 'Not found' })
  })
})

describe('assertFound', () => {
  it('returns the value when present', () => {
    const deal = { id: 'deal-1' }
    expect(assertFound(deal, 'Deal not found')).toBe(deal)
  })

  it('narrows away null and undefined', () => {
    const lookup = (): { id: string } | null => ({ id: 'deal-1' })
    const deal: { id: string } = assertFound(lookup(), 'Deal not found')
    expect(deal.id).toBe('deal-1')
  })

  it.each([[null], [undefined]])('throws the standardized 404 for %p', (missing) => {
    expect(() => assertFound(missing, 'Deal not found')).toThrow(CrudHttpError)
    try {
      assertFound(missing, 'Deal not found')
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect((err as CrudHttpError).status).toBe(404)
      expect((err as CrudHttpError).body).toEqual({ error: 'Deal not found' })
    }
  })

  it('passes the message through verbatim so translated copy survives', () => {
    const translated = 'Umowa nie została znaleziona'
    try {
      assertFound(null, translated)
    } catch (err) {
      expect((err as CrudHttpError).body).toEqual({ error: translated })
    }
  })
})
