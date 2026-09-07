import { getForeignKeyViolationConstraint, isForeignKeyViolation, isTransientDbError, isUniqueViolation } from '../pg-errors'

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

  it('is false for bare socket errors with no Postgres signal (avoids false positives)', () => {
    // Generic socket failures can come from any outbound connection (HTTP, cache,
    // queue), so they must NOT be attributed to the database.
    expect(isTransientDbError({ code: 'ECONNREFUSED' })).toBe(false)
    expect(isTransientDbError({ code: 'ETIMEDOUT' })).toBe(false)
    expect(isTransientDbError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(false)
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

describe('isForeignKeyViolation', () => {
  it('is true for the foreign_key_violation SQLSTATE', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true)
  })

  it('is true for ORM-wrapped messages that drop the SQLSTATE', () => {
    expect(
      isForeignKeyViolation(
        new Error('update or delete on table "users" violates foreign key constraint "sidebar_variants_user_id_foreign" on table "sidebar_variants"'),
      ),
    ).toBe(true)
  })

  it('looks through MikroORM wrapper chains (cause / previous)', () => {
    expect(isForeignKeyViolation({ message: 'wrapped', cause: { code: '23503' } })).toBe(true)
    expect(isForeignKeyViolation({ message: 'wrapped', previous: { code: '23503' } })).toBe(true)
  })

  it('is false for unique violations, transient errors and non-DB errors', () => {
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false)
    expect(isForeignKeyViolation({ code: '53300' })).toBe(false)
    expect(isForeignKeyViolation(new Error('something unrelated broke'))).toBe(false)
    expect(isForeignKeyViolation(null)).toBe(false)
  })
})

describe('getForeignKeyViolationConstraint', () => {
  const driverMessage = 'update or delete on table "users" violates foreign key constraint "sidebar_variants_user_id_foreign" on table "sidebar_variants"'

  it('reads the pg constraint field from the top-level error', () => {
    expect(getForeignKeyViolationConstraint({ code: '23503', constraint: 'user_roles_user_id_foreign' })).toBe('user_roles_user_id_foreign')
  })

  it('reads the constraint from a wrapped driver error', () => {
    expect(getForeignKeyViolationConstraint({ message: 'wrapped', previous: { code: '23503', constraint: 'sessions_user_id_foreign' } })).toBe('sessions_user_id_foreign')
    expect(getForeignKeyViolationConstraint({ message: 'wrapped', cause: { code: '23503', constraint: 'user_acls_user_id_foreign' } })).toBe('user_acls_user_id_foreign')
  })

  it('falls back to the quoted constraint in the driver message', () => {
    expect(getForeignKeyViolationConstraint(new Error(driverMessage))).toBe('sidebar_variants_user_id_foreign')
  })

  it('is null when nothing identifies the constraint', () => {
    expect(getForeignKeyViolationConstraint({ code: '23503' })).toBeNull()
    expect(getForeignKeyViolationConstraint(new Error('something unrelated broke'))).toBeNull()
    expect(getForeignKeyViolationConstraint(null)).toBeNull()
  })
})
