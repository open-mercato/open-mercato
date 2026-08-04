import { isTransientDbError, isUniqueViolation } from '../pg-errors'

describe('isTransientDbError', () => {
  it('is true for the max_connections SQLSTATE', () => {
    expect(isTransientDbError({ code: '53300' })).toBe(true)
  })

  it('is true for connection-family SQLSTATEs', () => {
    for (const code of ['53400', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08006']) {
      expect(isTransientDbError({ code })).toBe(true)
    }
  })

  it('is true for driver/ORM-wrapped connection messages that drop the SQLSTATE', () => {
    expect(isTransientDbError(new Error('sorry, too many clients already'))).toBe(true)
    expect(isTransientDbError(new Error('Knex: Timeout acquiring a connection. The pool is probably full.'))).toBe(true)
    expect(isTransientDbError(new Error('Unable to acquire a connection'))).toBe(true)
    expect(isTransientDbError(new Error('Connection terminated unexpectedly'))).toBe(true)
    expect(isTransientDbError(new Error('the database system is starting up'))).toBe(true)
  })

  it('is true for socket-level error codes', () => {
    expect(isTransientDbError({ code: 'ECONNREFUSED' })).toBe(true)
    expect(isTransientDbError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true)
  })

  it('is false for a unique violation and other query-level errors', () => {
    expect(isTransientDbError({ code: '23505' })).toBe(false)
    expect(isTransientDbError({ code: '40P01' })).toBe(false) // deadlock — not a connection failure
    expect(isTransientDbError({ code: '40001' })).toBe(false) // serialization — not a connection failure
  })

  it('is false for non-DB and empty errors', () => {
    expect(isTransientDbError(new Error('something unrelated broke'))).toBe(false)
    expect(isTransientDbError(null)).toBe(false)
    expect(isTransientDbError(undefined)).toBe(false)
    expect(isTransientDbError('a string')).toBe(false)
  })

  it('does not overlap with isUniqueViolation', () => {
    const uniqueErr = { code: '23505', message: 'duplicate key value violates unique constraint' }
    expect(isUniqueViolation(uniqueErr)).toBe(true)
    expect(isTransientDbError(uniqueErr)).toBe(false)
  })
})
