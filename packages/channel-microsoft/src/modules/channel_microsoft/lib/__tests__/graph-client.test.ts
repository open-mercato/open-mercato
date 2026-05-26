import { GraphApiError } from '../graph-client'

describe('GraphApiError', () => {
  it('captures status + detail for the adapter classification logic', () => {
    const error = new GraphApiError('Graph DELETE failed', 401, 'invalid_grant')
    expect(error.name).toBe('GraphApiError')
    expect(error.status).toBe(401)
    expect(error.detail).toBe('invalid_grant')
  })
})
